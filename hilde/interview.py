"""Q interviews people who are leaving (B6): ask, listen, structure, compare, publish.

    start   -> plan questions: colleagues' open questions, gaps only this person can close,
               catalogue questions where the person is the only source, then the rest
    answer  -> redact (IBAN, tax numbers, taxpayer names) -> extract handbook statements (LLM)
               -> compare each with existing knowledge: NEU / BESTÄTIGT / AKTUALISIERT / WIDERSPRUCH
               -> next question (a follow-up if something important was missing)
    publish -> after the person approved the handbook page: index the statements; a contradiction
               marks both sources "conflict" (managers decide), an update keeps the history

Sessions are JSON files in var/interviews/ (runtime data, git-ignored).
"""

import json
import re
import uuid
from collections import Counter
from datetime import date, datetime
from typing import Literal

import yaml
from langchain_core.documents import Document
from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel, ConfigDict, Field
from qdrant_client import models

from hilde import open_questions
from hilde.answer import BS, BS_SAFE
from hilde.config import REPO_ROOT
from hilde.learn import learn
from hilde.llm import get_embeddings, get_llm
from hilde.loaders import load_personas
from hilde.redact import redact, redact_names
from hilde.schemas import LearnRequest
from hilde.vectorstore import dense_search, index_documents, set_status_for_chunk

DIR = REPO_ROOT / "var" / "interviews"

Section = Literal["Kontakte & Vertretung", "Prozesse & Freigaben", "Projekte & Fristen",
                  "Kommunikation", "Ungeschriebene Regeln", "Sonstiges"]
SECTIONS: list[str] = ["Kontakte & Vertretung", "Prozesse & Freigaben", "Projekte & Fristen",
                       "Kommunikation", "Ungeschriebene Regeln", "Sonstiges"]
SECTION_CATEGORY = {"Kontakte & Vertretung": "org", "Prozesse & Freigaben": "process",
                    "Projekte & Fristen": "project", "Kommunikation": "communication",
                    "Ungeschriebene Regeln": "practical", "Sonstiges": "general"}
# bge-m3 cosine, measured: same statement ~0.8+, same subject in another source ~0.70
# (canteen interview vs intranet 0.709), different subject with a similar shape <= 0.65
MATCH_MIN_SCORE = 0.68


def _all_required(schema: dict) -> None:
    schema["required"] = list(schema.get("properties", {}))  # qwen3 skips optional fields


# ---------------------------------------------------------------- models

class PlannedQuestion(BaseModel):
    kind: Literal["open_question", "gap", "catalogue", "follow_up"]
    original: str = Field(description="question as asked by a colleague / in the catalogue")
    text: str = Field(default="", description="what Q actually says (phrased for this person)")
    ref: str | None = Field(default=None, description="open question id or catalogue id")
    asked_by: str | None = None
    gap_id: str | None = None
    demo_answer: str | None = Field(default=None, description="presenter helper for the demo")


class Claim(BaseModel):
    id: str
    section: str
    text: str
    state: str = "NEU"
    matched_source: str | None = None
    matched_chunk: str | None = None
    matched_citation: str | None = None
    matched_text: str | None = None
    matched_status: str | None = None
    reason: str | None = Field(default=None, description="why BESTÄTIGT / AKTUALISIERT / WIDERSPRUCH")


class Turn(BaseModel):
    n: int
    question: PlannedQuestion
    answer: str = Field(description="redacted answer")
    redacted: list[str] = []
    claims: list[Claim] = []
    at: str
    indexed_now: bool = Field(default=False, description="answer to an open question: searchable at once")


class Session(BaseModel):
    id: str
    persona: str
    created: str
    queue: list[PlannedQuestion] = []
    current: PlannedQuestion | None = None
    turns: list[Turn] = []
    published_at: str | None = None
    published_claims: list[str] = []


class OpenQuestionIn(BaseModel):
    id: str
    text: str
    asked_by: str | None = None
    gap_id: str | None = None


# ---------------------------------------------------------------- persistence

def _path(sid: str):
    return DIR / f"{sid}.json"


def save(s: Session) -> None:
    DIR.mkdir(parents=True, exist_ok=True)
    _path(s.id).write_text(s.model_dump_json(indent=1), encoding="utf-8")


def load(sid: str) -> Session:
    return Session.model_validate_json(_path(sid).read_text(encoding="utf-8"))


# ---------------------------------------------------------------- planning

def _data() -> tuple[list[dict], dict, dict]:
    facts_doc = yaml.safe_load((REPO_ROOT / "data" / "facts" / "facts.yaml").read_text(encoding="utf-8"))
    catalogue = yaml.safe_load((REPO_ROOT / "data" / "schema" / "questions.yaml").read_text(encoding="utf-8"))
    return facts_doc["facts"], facts_doc["plants"], {q["id"]: q for q in catalogue["questions"]}


def _first(name: str) -> str:
    return name.replace("Dr. ", "").split()[0]


def plan(pid: str, open_qs: list[OpenQuestionIn]) -> list[PlannedQuestion]:
    """Order: colleagues' open questions > gaps assigned to this person > questions where this
    person is the only (non-leaving) source > other questions this person knows about."""
    people = load_personas()
    facts, plants, catalogue = _data()
    out: list[PlannedQuestion] = []

    gap_demo = {g["id"]: g.get("live_demo_answer_de") for g in plants.get("planted_gaps", [])}
    for oq in open_qs:
        out.append(PlannedQuestion(kind="open_question", original=oq.text, ref=oq.id,
                                   asked_by=oq.asked_by, gap_id=oq.gap_id,
                                   demo_answer=gap_demo.get(oq.gap_id or "")))
    for oq in open_questions.list_open(pid):  # asked in the API, not (yet) known to the UI
        if all(oq["question"].lower() != q.original.lower() for q in out):
            out.append(PlannedQuestion(kind="open_question", original=oq["question"], ref=oq["id"],
                                       asked_by=oq["asked_by"]))

    covered_gaps = {q.gap_id for q in out if q.gap_id}
    gap_ids = {g["id"] for g in plants.get("planted_gaps", [])}
    for g in plants.get("planted_gaps", []):
        if g["who_to_ask"] == pid and g["id"] not in covered_gaps:
            text = g.get("question_de") or catalogue.get(g["id"], {}).get("de", "")
            out.append(PlannedQuestion(kind="gap", original=text, ref=g["id"], gap_id=g["id"],
                                       demo_answer=g.get("live_demo_answer_de")))

    # knowledge map: how much of each catalogue question rests on this person alone
    weight: Counter = Counter()
    mine: dict[str, list[dict]] = {}
    for f in facts:
        holders = [f["owner"], *(f.get("also_known_by") or [])]
        if pid not in holders or f.get("status") == "superseded" or f.get("access") == "restricted":
            continue
        others = [h for h in holders if h != pid and people.get(h, {}).get("status") != "leaving"]
        for qid in f.get("question_ids", []):
            # sources contradict each other: clarify before the person leaves
            weight[qid] += 6 if f.get("status") == "conflict" else (1 if others else 3)
            mine.setdefault(qid, []).append(f)
    for qid, _w in weight.most_common():
        if qid in gap_ids or qid not in catalogue:
            continue
        demo = "Also: " + " Und: ".join(f["de"] for f in mine[qid][:2])
        out.append(PlannedQuestion(kind="catalogue", original=catalogue[qid]["de"], ref=qid,
                                   demo_answer=demo))

    # the redaction demo: a planted taxpayer detail slips into the first catalogue answer
    targets = [t for t in plants.get("redaction_targets", []) if t["inject_into"] == pid]
    for q in out:
        if q.kind == "catalogue" and targets:
            t = targets[0]
            q.demo_answer = f"{q.demo_answer} Das erinnert mich an den Fall damals, {t['context']}: {t['value']}."
            break
    return out[:12]


PHRASE_SYSTEM = """Du bist Q, die KI-Kollegin des Finanzamts Hildesheim, und führst ein Übergabe-Interview
mit {name} ({role}), {leaving}. Interviewstil für diese Person: {strategy}
Was die Person motiviert: {motivation}.
Formuliere die nächste Frage natürlich und freundlich, duze {first}, höchstens 2 Sätze.
Gib nur die Frage aus, ohne Anführungszeichen."""


def phrase(q: PlannedQuestion, pid: str, use_llm: bool = True) -> PlannedQuestion:
    """Turn a planned question into what Q says to this person."""
    people = load_personas()
    p = people[pid]
    first = _first(p["name"])
    if q.kind in ("open_question", "gap") and q.asked_by:
        asker = people.get(q.asked_by, {}).get("name", "Jemand aus dem Team")
        q.text = f"{_first(asker)} hat gefragt: „{q.original}“ – kannst du das erklären, {first}?"
        return q
    if q.kind == "gap":
        q.text = f"{first}, das weiß bisher nur du: {q.original}"
        return q
    if q.kind == "follow_up" or not use_llm:
        q.text = q.text or f"{first}, {q.original[0].lower()}{q.original[1:]}"
        return q
    try:
        system = PHRASE_SYSTEM.format(
            name=p["name"], role=p["role_de"], first=first,
            leaving=f"geht zum {p['leave_date']}" if p.get("leave_date") else "erfahrene Kollegin bzw. erfahrener Kollege",
            strategy=p.get("interview_strategy", "freundlich nachfragen"),
            motivation=", ".join(p.get("motivation", [])) or "Wissen weitergeben")
        text = get_llm().invoke([SystemMessage(system), HumanMessage(f"Katalogfrage: {q.original}")]).content
        q.text = text.strip().strip('"„“') or q.original
    except Exception:  # noqa: BLE001 - fall back to the catalogue wording
        q.text = f"{first}, {q.original[0].lower()}{q.original[1:]}"
    return q


def _next(s: Session, use_llm: bool = True) -> PlannedQuestion | None:
    return phrase(s.queue.pop(0), s.persona, use_llm) if s.queue else None


def start(pid: str, open_qs: list[OpenQuestionIn], use_llm: bool = True) -> Session:
    s = Session(id=uuid.uuid4().hex[:10], persona=pid, created=datetime.now().isoformat(timespec="seconds"),
                queue=plan(pid, open_qs))
    s.current = _next(s, use_llm)
    save(s)
    return s


def skip(s: Session) -> Session:
    s.current = _next(s)
    save(s)
    return s


def focus(s: Session, q: PlannedQuestion) -> Session:
    """Answer a specific question now (e.g. a colleague's question clicked in the UI)."""
    if s.current and s.current.kind != "follow_up":
        s.queue.insert(0, s.current)
    s.queue = [x for x in s.queue if not (q.ref and x.ref == q.ref)]
    s.current = phrase(q, s.persona)
    save(s)
    return s


# ---------------------------------------------------------------- answers

class XClaim(BaseModel):
    model_config = ConfigDict(json_schema_extra=_all_required)
    section: Section
    text: str = Field(description="eine Aussage im Handbuchstil, neutral, ohne 'ich', ohne Steuerfälle")


class Extracted(BaseModel):
    model_config = ConfigDict(json_schema_extra=_all_required)
    claims: list[XClaim] = Field(description="1-4 Aussagen, die eine Nachfolge wissen muss")
    taxpayer_names: list[str] = Field(description="Namen von Steuerpflichtigen/Firmen; KEINE Beschäftigten")
    follow_up: str = Field(description="eine kurze Nachfrage, wenn ein wichtiges Detail fehlt (wer/wann/wo); sonst leer")


EXTRACT_SYSTEM = """Du wertest ein Übergabe-Interview im Finanzamt Hildesheim aus.
Aus der ANTWORT von {name} extrahierst du Wissen für das Übergabe-Handbuch:
- claims: 1-4 Aussagen, die eine Nachfolge wissen muss, je einem Abschnitt zugeordnet
  (Kontakte & Vertretung, Prozesse & Freigaben, Projekte & Fristen, Kommunikation,
  Ungeschriebene Regeln, Sonstiges). Neutraler Handbuchstil, kurz, keine Ich-Form.
  Nur was in der ANTWORT steht, nichts erfinden. Anekdoten ohne Regel weglassen.
- taxpayer_names: alle Namen von Bürgerinnen, Bürgern oder Firmen (Steuerfälle) aus der ANTWORT.
  Beschäftigte des Amts sind KEINE Steuerpflichtigen: {staff}.
  Steuerfälle gehören nie in claims.
- follow_up: eine kurze Nachfrage (duzen), wenn für die Nachfolge ein wichtiges Detail fehlt
  (z. B. wer, bis wann, wo abgelegt). Nie zu Steuerfällen oder Steuerpflichtigen. Sonst leerer Text."""


# Details that make two statements about the same thing contradict each other.
# (A 7B model could not judge SAME/UPDATE/CONFLICT reliably; this is fast and explainable.)
# "11:30", "11.30 Uhr" or "11.30" (but "01.01" is a date: dot-form only if "Uhr" or minutes > 12)
_TIME = re.compile(r"\b(\d{1,2})(?::(\d{2})\b|\.(\d{2})(\s?Uhr)?(?![\d.]))")
_MONEY = re.compile(r"\b(\d{1,3}(?:\.\d{3})*|\d+)(?:,\d{2})?\s?(?:€|Euro)")
_DATE = re.compile(r"\b(\d{1,2})\.\s?(\d{1,2}\.|Januar|Februar|März|April|Mai|Juni|Juli|August|"
                   r"September|Oktober|November|Dezember)", re.IGNORECASE)
_DAYS = ["montag", "dienstag", "mittwoch", "donnerstag", "freitag", "samstag", "sonntag"]


def details(text: str) -> dict[str, set[str]]:
    t = text.lower()
    return {
        "Zeit": {f"{int(h)}:{m1 or m2}" for h, m1, m2, uhr in _TIME.findall(text)
                 if int(h) < 24 and (m1 or uhr or int(m2) > 12)},
        "Betrag": {a.replace(".", "") for a in _MONEY.findall(text)},
        "Datum": {f"{d}.{m.lower()}" for d, m in _DATE.findall(text)},
        "Wochentag": {d for d in _DAYS if d in t},
    }


def relation(new: str, known: str) -> tuple[str, str]:
    """(state, reason) for two statements that are already about the same subject."""
    n, k = details(new), details(known)
    for kind in ("Zeit", "Betrag", "Datum"):
        if n[kind] - k[kind] and k[kind] - n[kind]:
            new_v, old_v = ", ".join(sorted(n[kind] - k[kind])), ", ".join(sorted(k[kind] - n[kind]))
            return "WIDERSPRUCH", f"andere {kind}: {new_v} statt {old_v}"
    if any(n[x] - k[x] for x in n):
        return "AKTUALISIERT", "ergänzt Details"
    return "BESTÄTIGT", "gleicher Inhalt"


def _not_own_learned(pid: str) -> models.Filter:
    """Exclude what this person said earlier in the app (it would 'confirm' itself)."""
    return models.Filter(must_not=[models.Filter(must=[
        models.FieldCondition(key="metadata.owner", match=models.MatchValue(value=pid)),
        models.Filter(must_not=[models.IsEmptyCondition(is_empty=models.PayloadField(key="metadata.learned_via"))]),
    ])])


def _compare(claims: list[Claim], pid: str) -> None:
    """Fill state/matched_* in place: compare each statement with the 3 closest known sources.
    A contradiction with any of them wins (knowledge may already disagree with itself)."""
    rank = {"WIDERSPRUCH": 0, "AKTUALISIERT": 1, "BESTÄTIGT": 2}
    for c in claims:
        hits = dense_search(get_embeddings().embed_query(c.text), _not_own_learned(pid), limit=3,
                            exclude_status=["scheduled"])
        best = None
        for score, payload in hits:
            if score < MATCH_MIN_SCORE:
                continue
            state, reason = relation(c.text, payload["page_content"])
            if best is None or rank[state] < rank[best[0]]:
                best = (state, reason, payload)
        if best is None:
            continue  # NEU
        state, reason, payload = best
        md, text = payload["metadata"], payload["page_content"]
        c.matched_source, c.matched_chunk = md["source_id"], md["chunk_id"]
        c.matched_citation, c.matched_text = md.get("citation"), text[:300]
        c.matched_status = md.get("status")
        c.state, c.reason = state, reason


def answer(s: Session, text: str) -> Turn:
    if s.current is None:
        raise ValueError("interview finished")
    people = load_personas()
    p = people[s.persona]
    staff = ", ".join(x["name"] for x in people.values())
    q = s.current

    # 1) extract on the raw text (local model, nothing stored), 2) redact everything we keep
    try:
        ex: Extracted = get_llm().with_structured_output(Extracted, method="json_schema").invoke([
            SystemMessage(EXTRACT_SYSTEM.format(name=p["name"], staff=staff)),
            # backslash paths break the model's JSON; it sees a look-alike, we turn it back below
            HumanMessage(f"FRAGE: {q.text}\n\nANTWORT: {text}".replace(BS, BS_SAFE)),
        ])
    except Exception:  # noqa: BLE001
        ex = Extracted(claims=[], taxpayer_names=[], follow_up="")
    clean, found = redact(text)
    clean, more = redact_names(clean, ex.taxpayer_names)
    claims = []
    for i, c in enumerate(ex.claims[:4]):
        ctext, hidden = redact(c.text.replace(BS_SAFE, BS))
        ctext, hidden2 = redact_names(ctext, ex.taxpayer_names)
        if hidden or hidden2:
            continue  # a statement about a tax case is not handbook knowledge
        claims.append(Claim(id=f"{len(s.turns) + 1}.{i + 1}", section=c.section, text=ctext))
    _compare(claims, s.persona)

    turn = Turn(n=len(s.turns) + 1, question=q, answer=clean, redacted=found + more, claims=claims,
                at=datetime.now().isoformat(timespec="seconds"))

    # a colleague is waiting: the answer is searchable at once (the handbook follows on publish)
    if q.kind in ("open_question", "gap"):
        learn(LearnRequest(text=clean, user_id=s.persona, via="interview", category="general",
                           label=f"Interview {_first(p['name'])[0]}. {p['name'].split()[-1]} · live",
                           question=q.original))
        turn.indexed_now = True

    s.turns.append(turn)
    follow, hidden = redact_names(redact(ex.follow_up.strip().replace(BS_SAFE, BS))[0], ex.taxpayer_names)
    if hidden or "entfernt]" in follow:
        follow = ""  # never ask about a tax case
    if follow and q.kind != "follow_up" and len(follow) > 8:
        s.current = PlannedQuestion(kind="follow_up", original=follow, text=follow)
    else:
        s.current = _next(s)
    save(s)
    return turn


# ---------------------------------------------------------------- handbook + publish

def handbook(s: Session) -> dict:
    p = load_personas()[s.persona]
    sections = []
    for name in SECTIONS:
        items = [{**c.model_dump(), "turn": t.n, "published": c.id in s.published_claims}
                 for t in s.turns for c in t.claims if c.section == name]
        sections.append({"name": name, "claims": items})
    core = [x for x in sections if x["name"] != "Sonstiges"]
    return {
        "persona": s.persona, "name": p["name"], "title": p["role_de"],
        "sections": sections,
        "covered": sum(1 for x in core if x["claims"]), "total": len(core),
        "turns": len(s.turns), "remaining": len(s.queue) + (1 if s.current else 0),
        "published_at": s.published_at,
        "conflicts": sum(1 for t in s.turns for c in t.claims if c.state == "WIDERSPRUCH"),
    }


STATUS_LOG = REPO_ROOT / "var" / "status_changes.jsonl"


def _log_status_change(chunk_id: str, previous: str) -> None:
    STATUS_LOG.parent.mkdir(exist_ok=True)
    with STATUS_LOG.open("a", encoding="utf-8") as f:
        f.write(json.dumps({"chunk_id": chunk_id, "previous": previous}) + "\n")


def undo_status_changes() -> int:
    """Demo reset: give sources marked by interviews their previous status back."""
    if not STATUS_LOG.exists():
        return 0
    rows = [json.loads(x) for x in STATUS_LOG.read_text(encoding="utf-8").splitlines() if x]
    for r in reversed(rows):
        set_status_for_chunk(r["chunk_id"], r["previous"])
    STATUS_LOG.unlink()
    return len(rows)


def publish(s: Session) -> dict:
    """Index approved statements. Contradictions mark both sides "conflict" for a manager."""
    p = load_personas()[s.persona]
    day = date.today().strftime("%d.%m.%Y")
    docs, conflicts = [], 0
    for t in s.turns:
        if t.indexed_now:
            continue  # already searchable as the raw answer
        for c in t.claims:
            if c.id in s.published_claims:
                continue
            status = "conflict" if c.state == "WIDERSPRUCH" else "current"
            if status == "conflict" and c.matched_chunk:
                set_status_for_chunk(c.matched_chunk, "conflict")
                _log_status_change(c.matched_chunk, c.matched_status or "current")
                conflicts += 1
            docs.append(Document(page_content=f"{c.section}: {c.text}", metadata={
                "chunk_id": f"interview-{s.id}-{c.id}", "source_type": "segment",
                "source_id": f"interview-{s.id}", "title": f"Übergabe-Interview {p['name']}",
                "category": SECTION_CATEGORY.get(c.section, "general"), "department": p["department"],
                "access": "internal", "status": status, "valid_from": date.today().isoformat(),
                "valid_to": None,
                "supersedes": c.matched_source if c.state == "AKTUALISIERT" else None,
                "modality": "interview", "learned_via": "interview", "speaker": p["name"],
                "anchor": {"turn": t.n}, "source_file": None, "owner": s.persona,
                "owner_name": p["name"], "question_ids": [], "fact_ids": [],
                "citation": f"Übergabe-Interview {p['name']} · {day} · Frage {t.n}",
            }))
            s.published_claims.append(c.id)
    if docs:
        index_documents(docs)
    s.published_at = datetime.now().isoformat(timespec="seconds")
    save(s)
    return {"published": len(docs), "conflicts_flagged": conflicts}


def to_dict(s: Session) -> dict:
    return {"id": s.id, "persona": s.persona, "current": s.current.model_dump() if s.current else None,
            "turns": [t.model_dump() for t in s.turns], "handbook": handbook(s)}


def dump(obj) -> str:  # for debugging in a shell
    return json.dumps(obj, ensure_ascii=False, indent=1)
