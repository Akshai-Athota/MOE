#!/usr/bin/env python3
"""Text generators (Person B): write German source texts into data/raw/ + data/manifest.jsonl.

Every generated file states ONLY facts from data/facts/facts.yaml (CLAUDE.md rule 3).

* LLM (spoken style):  interview transcripts, screen-recording voice-overs, email thread.
  Every number/date in the output is checked against the facts it was given; on unknown
  numbers we retry once and record leftovers as `unverified_numbers` in the manifest.
* Templates (no LLM):  internal orders (rules), intranet pages, information sheets, minutes.

Media (audio via Piper, PDF, images, video) are made from these files by Person C's generators.

    uv run python generators/gen_text.py --plan            # show what would be generated
    uv run python generators/gen_text.py                   # templates + all LLM texts
    uv run python generators/gen_text.py --only p05 p11    # LLM texts for these personas only
    uv run python generators/gen_text.py --templates-only
"""

import argparse
import json
import re
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import yaml
from pydantic import BaseModel, Field

DATA = ROOT / "data"
RAW = DATA / "raw"
MANIFEST = DATA / "manifest.jsonl"
TODAY = date(2026, 11, 20).isoformat()  # facts.yaml meta.as_of

FACT_DEFAULTS = {"also_known_by": [], "valid_to": None, "status": "current", "supersedes": None,
                 "rule": None, "plant": None, "question_ids": []}
ACCESS_RANK = {"public": 0, "internal": 1, "restricted": 2}
CATEGORY_DE = {
    "org": "Organisation und Zuständigkeiten", "process": "Prozesse und Abläufe",
    "project": "Projekte", "program": "Landesprogramme und Berichtspflichten",
    "finance": "Haushalt und Beschaffung", "it": "IT und Fachverfahren",
    "oversight": "Aufsicht und Gremien", "communication": "Kommunikation",
    "practical": "Praktisches für die ersten Wochen", "general": "Alltag im Amt",
    "public": "Öffentliche Informationen",
}

# interview_type -> (modality of output, framing for the LLM, target words, max facts per part)
INTERVIEW_TYPES = {
    "long_handover": ("audio", "ein ausführliches Übergabe-Interview vor dem Ruhestand bzw. Wechsel", 1100, 12),
    "short_priorities": ("audio", "ein kurzes Interview über Prioritäten und Entscheidungsbefugnisse", 450, 10),
    "process_walkthrough": ("audio", "ein Interview, in dem Abläufe Schritt für Schritt erklärt werden", 650, 10),
    "tips_and_tricks": ("audio", "ein lockeres Interview mit Tipps und ungeschriebenen Regeln", 550, 10),
    "onboarding_retro": ("audio", "ein Interview: 'Was hätte ich in meinen ersten Wochen gern gewusst?'", 550, 10),
    "checklist_audio": ("audio", "ein kurzes Interview, in dem eine Checkliste durchgegangen wird", 450, 10),
    "screen_recording": ("video", "eine Bildschirmaufnahme mit gesprochener Erklärung (Monolog, 'ich zeige euch ...')", 500, 10),
    "email_thread": ("email", "ein E-Mail-Verlauf (3-4 Mails mit Von/An/Datum/Betreff) mit Kolleginnen und Kollegen", 500, 10),
}
MODALITY_SOURCE = {"audio": "interview", "video": "video", "email": "email"}


# ---------------------------------------------------------------- loading

def load(path: Path):
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def iso(v):
    return v.isoformat() if isinstance(v, date) else v


def de_date(v) -> str:
    return v.strftime("%d.%m.%Y") if isinstance(v, date) else str(v)


def world():
    facts_doc = load(DATA / "facts" / "facts.yaml")
    facts = [{**FACT_DEFAULTS, **f} for f in facts_doc["facts"]]
    personas = {p["id"]: p for p in (load(f) for f in sorted((DATA / "personas").glob("p*.yaml")))}
    rules = load(DATA / "rules" / "rules.yaml")["rules"]
    return facts, facts_doc["plants"], personas, rules, load(DATA / "company" / "company.yaml")


# ---------------------------------------------------------------- manifest

def entry(file: Path, modality: str, persona: str | None, facts: list[dict], access: str,
          department: str, rule_ids=(), transcript: Path | None = None, **extra) -> dict:
    e = {
        "file": file.relative_to(ROOT).as_posix(), "modality": modality, "persona": persona,
        "fact_ids": [f["id"] for f in facts], "rule_ids": list(rule_ids), "access": access,
        "department": department, "created": TODAY, "language": "de",
        "transcript": transcript.relative_to(ROOT).as_posix() if transcript else None,
    }
    e.update(extra)
    return e


def max_access(facts: list[dict]) -> str:
    return max((f["access"] for f in facts), key=ACCESS_RANK.get, default="internal")


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text.strip() + "\n", encoding="utf-8")


# ---------------------------------------------------------------- templates (no LLM)

def gen_rules(rules: list[dict], facts: list[dict], personas: dict) -> list[dict]:
    """Each internal order as a formal document (C renders doc_rule_<id>.pdf from it)."""
    out = []
    for r in rules:
        issuer = personas.get(r["issued_by"], {}).get("name", r["issued_by"])
        valid = f"gültig ab {de_date(r['valid_from'])}"
        if r.get("valid_to"):
            valid += f" bis {de_date(r['valid_to'])}"
        lines = [
            "Finanzamt Hildesheim – Hausverfügung" if r["id"].startswith("HV") else
            "Finanzamt Hildesheim – Dienstvereinbarung",
            f"# {r['id']}: {r['title_de']}",
            f"Erlassen von: {issuer} · {valid}",
        ]
        if r.get("supersedes"):
            lines.append(f"Diese Fassung ersetzt {r['supersedes']}.")
        if r.get("status") == "superseded":
            lines.append("HINWEIS: Diese Fassung ist außer Kraft.")
        lines += ["", "## 1. Zweck", r.get("summary_de", ""), "", "## 2. Regelungen"]
        lines += [f"2.{i} {c}" for i, c in enumerate(r.get("clauses", []), 1)]
        lines += ["", "## 3. Inkrafttreten", f"Diese Regelung ist {valid}."]
        path = RAW / "docs" / f"doc_rule_{r['id']}.md"
        write(path, "\n".join(lines))
        linked = [f for f in facts if f["rule"] == r["id"]]
        out.append(entry(path, "doc", r["issued_by"] if r["issued_by"] in personas else None, linked,
                         r.get("access", "internal"), "ALL", rule_ids=[r["id"]],
                         title=r["title_de"], valid_from=iso(r["valid_from"]),
                         valid_to=iso(r.get("valid_to")), generator="template"))
    return out


def _fact_page(path: Path, title: str, intro: str, facts: list[dict], personas: dict,
               modality: str, generator: str, **extra) -> dict:
    lines = [f"# {title}", intro, ""]
    for i, f in enumerate(facts, 1):
        owner = personas.get(f["owner"], {}).get("name", f["owner"])
        lines += [f"## {i}. {f['topic']}", f["de"],
                  f"(Stand: {de_date(f['valid_from'])} · Ansprechperson: {owner})", ""]
    write(path, "\n".join(lines))
    owners = {f["owner"] for f in facts}
    depts = {f["department"] for f in facts}
    return entry(path, modality, owners.pop() if len(owners) == 1 else None, facts,
                 max_access(facts), depts.pop() if len(depts) == 1 else "ALL",
                 rule_ids=sorted({f["rule"] for f in facts if f["rule"]}), title=title,
                 generator=generator, **extra)


def gen_fact_pages(facts: list[dict], personas: dict) -> list[dict]:
    """Intranet pages, information sheets and minutes, grouped by category and access level.

    Restricted facts go into separate files, so one file never mixes access levels.
    """
    out = []
    groups: dict[tuple, list[dict]] = defaultdict(list)
    for f in facts:
        if f["status"] == "superseded":
            continue  # old versions live in the (superseded) rule documents, not on current pages
        for src in f["sources_planned"]:
            # "doc" facts that belong to a rule are already in that rule's document
            if src in ("intranet", "minutes") or (src == "doc" and not f["rule"]):
                groups[(src, f["category"], f["access"])].append(f)
    for (src, cat, access), fs in sorted(groups.items()):
        suffix = "" if access == "internal" else f"_{access}"
        if src == "intranet":
            out.append(_fact_page(
                RAW / "docs" / f"intranet_{cat}{suffix}.md",
                f"Intranet: {CATEGORY_DE[cat]}", "Intranet Finanzamt Hildesheim · Wissensseite",
                fs, personas, "doc", "template", source_kind="intranet"))
        elif src == "doc":
            label = "VERTRAULICH – " if access == "restricted" else ""
            out.append(_fact_page(
                RAW / "docs" / f"doc_merkblatt_{cat}{suffix}.md",
                f"{label}Merkblatt: {CATEGORY_DE[cat]}",
                "Finanzamt Hildesheim · Merkblatt für Beschäftigte", fs, personas, "doc", "template",
                source_kind="merkblatt"))
        else:  # minutes
            out.append(_fact_page(
                RAW / "docs" / f"minutes_{cat}{suffix}.md",
                f"Protokoll Sachgebietsleiterrunde – {CATEGORY_DE[cat]}",
                "Ergebnisprotokoll. Tagesordnungspunkte und Beschlüsse:", fs, personas, "doc",
                "template", source_kind="minutes"))
    return out


# ---------------------------------------------------------------- LLM texts

NUM = re.compile(r"\d+(?:[.,:/\-]\d+)*")


def numbers(text: str) -> set[str]:
    return {n.rstrip(".,") for n in NUM.findall(text)}


def allowed_numbers(facts: list[dict], persona: dict, extra: list[str]) -> set[str]:
    allowed = set()
    for f in facts:
        allowed |= numbers(f["de"]) | numbers(de_date(f["valid_from"]))
    for k in ("room", "phone_ext", "speaking_style", "tenure_years", "start_date", "leave_date"):
        if persona.get(k) is not None:
            allowed |= numbers(str(persona[k])) | numbers(de_date(persona[k]))
    for e in extra:
        allowed |= numbers(e)
    return allowed


def _facts_block(facts):
    return "\n".join(f"- {f['de']}" for f in facts)


def plan_llm(facts, plants, personas, only=None) -> list[dict]:
    """One job per persona (long handovers split into parts)."""
    jobs = []
    redactions = defaultdict(list)
    for t in plants.get("redaction_targets", []):
        redactions[t["inject_into"]].append(t)
    for pid, p in personas.items():
        kind = p.get("interview_type", "none")
        if kind == "none" or (only and pid not in only):
            continue
        modality, framing, words, per_part = INTERVIEW_TYPES[kind]
        src = MODALITY_SOURCE[modality]
        mine = [f for f in facts if (f["owner"] == pid or pid in f["also_known_by"])
                and f["access"] != "restricted" and f["status"] != "superseded"]
        chosen = [f for f in mine if src in f["sources_planned"]] or \
                 [f for f in mine if "interview" in f["sources_planned"]]
        n_parts = max(1, -(-len(chosen) // per_part))  # ceil
        size = -(-len(chosen) // n_parts) if chosen else 1  # spread evenly, no 1-fact leftovers
        parts = [chosen[i:i + size] for i in range(0, len(chosen), size)] or [[]]
        for n, part in enumerate(parts, 1):
            if not part:
                continue
            jobs.append({"pid": pid, "kind": kind, "modality": modality, "framing": framing,
                         "words": words, "facts": part, "part": n, "parts": len(parts),
                         "redactions": redactions[pid] if n == 1 else []})
    return jobs


TURN_SYSTEM = """Du schreibst Teile realistischer deutscher Quelltexte für eine Simulation im Finanzamt
Hildesheim. Alle Personen sind fiktiv. Harte Regeln:
1. Der Text enthält GENAU den gegebenen FAKT, inhaltlich korrekt, in eigenen Worten.
2. Keine neuen Zahlen, Beträge, Daten, Fristen, Namen, Räume, Systeme oder Regeln.
   Ein kurzer persönlicher Kommentar ohne neue Fakten ist erlaubt.
3. Keine Regieanweisungen in Klammern wie (lacht)."""

TURN_USER = """Person: {name}, {role}. Sprechstil: {style}
{format}

FAKT: {fact}"""

TURN_FORMAT = {
    "audio": ("question = Frage der Interviewer Finn an {first} (1 Satz, duzt {first}), die zu diesem Thema "
              "führt, ohne die Antwort vorwegzunehmen. answer = gesprochene Antwort von {first} an Finn "
              "(Ich-Form, 2-4 Sätze, natürlich mit 'äh', 'also')."),
    "video": ("question = kurzer Titel des Bildschirmschritts. answer = gesprochene Erklärung von {first}, "
              "während {first} es am Bildschirm zeigt ('Hier seht ihr ...'), 2-4 Sätze."),
    "email": ("question = Betreffzeile. answer = kurzer E-Mail-Text von {first} an Kolleginnen und Kollegen, "
              "2-4 Sätze, ohne Anrede und Gruß."),
}

ANECDOTE_USER = """Person: {name}, {role}. Sprechstil: {style}
question = kurze Nachfrage der Interviewer Finn an {name}. answer = {name} (Ich-Form) erwähnt beiläufig und versehentlich einen echten
Steuerfall ({context}) und nennt dabei wörtlich: {value}
Das ist eine Anekdote, kein Fakt. 2-3 Sätze."""


class Turn(BaseModel):
    question: str
    answer: str


def _style(p: dict) -> str:
    return " ".join(str(p["speaking_style"]).split())


class Faithful(BaseModel):
    wrong_or_added: str = Field(description="Aussagen der ANTWORT, die dem FAKT widersprechen oder neue "
                                            "Regeln/Zuständigkeiten hinzufügen; leer, wenn keine")
    faithful: bool


FAITHFUL_SYSTEM = """Du prüfst streng, ob eine gesprochene ANTWORT einen FAKT korrekt wiedergibt.
Persönliche Kommentare und Anekdoten ohne Regelcharakter sind erlaubt. Falsch ist: ein Widerspruch zum FAKT,
eine neue Regel, Frist, Zuständigkeit oder Behörde, die nicht im FAKT steht."""

PATH = re.compile(r"[A-Z]:\\[^\s,;)\"']+")


def _gen_turn(llm, judge, user: str, allowed: set[str], must: list[str], fact: str | None):
    """One short structured call + checks; returns (Turn | None, problems).

    Checks: numbers ⊆ fact numbers, required literals present (paths, redaction values),
    and (for facts) an LLM faithfulness judge.
    """
    from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

    msgs = [SystemMessage(TURN_SYSTEM), HumanMessage(user)]
    problems: list[str] = []
    for _attempt in range(3):
        try:
            t: Turn = llm.invoke(msgs)
        except Exception as exc:  # noqa: BLE001 - malformed JSON etc. -> retry / fallback
            problems = [f"error:{type(exc).__name__}"]
            continue
        fix = []
        problems = sorted(numbers(f"{t.question} {t.answer}") - allowed)
        if problems:
            fix.append(f"Diese Zahlen/Daten stehen nicht im FAKT: {', '.join(problems)}.")
        if missing := [m for m in must if m not in t.answer]:
            problems += [f"MISSING:{m}" for m in missing]
            fix.append(f"Die Antwort muss wörtlich und unverändert enthalten: {'; '.join(missing)}.")
        if not problems and fact:
            v: Faithful = judge.invoke([SystemMessage(FAITHFUL_SYSTEM),
                                        HumanMessage(f"FAKT: {fact}\n\nANTWORT: {t.answer}")])
            if not v.faithful:
                problems.append(f"UNFAITHFUL:{v.wrong_or_added[:80]}")
                fix.append(f"Das ist falsch oder hinzugefügt: {v.wrong_or_added}. Halte dich genau an den FAKT.")
        if not problems:
            return t, []
        msgs += [AIMessage(t.model_dump_json()), HumanMessage(" ".join(fix) + " Schreibe neu.")]
    return None, problems


def run_job(job, personas, llm, judge) -> tuple[str, dict, list[str]]:
    """Build one text from per-fact turns. Returns (text, fact_id -> line number, fallbacks)."""
    p = personas[job["pid"]]
    first, last = p["name"].split()[0], p["name"].split()[-1]
    staff_numbers = [o["phone_ext"] + " " + o["room"] for o in personas.values()]
    turns: list[tuple[str | None, Turn]] = []
    fallbacks: list[str] = []
    for n, f in enumerate(job["facts"]):
        allowed = allowed_numbers([f], p, staff_numbers)
        # full speaking style only every third answer, so quirks don't repeat in every turn
        style = _style(p) if n % 3 == 0 else "natürlich, gesprochen, duzt Finn"
        user = TURN_USER.format(name=p["name"], role=p["role_de"], style=style,
                                format=TURN_FORMAT[job["modality"]].format(first=first), fact=f["de"])
        safe = f["de"].replace("\\", "⧵")  # backslash paths survive JSON (see hilde/answer.py)
        user = user.replace(f["de"], safe)
        t, problems = _gen_turn(llm, judge, user, allowed, [m.replace("\\", "⧵") for m in
                                                            PATH.findall(f["de"])], safe)
        if t is not None:
            t = Turn(question=t.question.replace("⧵", "\\"), answer=t.answer.replace("⧵", "\\"))
        if t is None:  # never ship an unchecked fact: fall back to the verbatim fact text
            fallbacks.append(f"{f['id']}:{problems}")
            t = Turn(question=f"Was sollte man zum Thema {f['topic']} wissen?", answer=f"Also: {f['de']}")
        turns.append((f["id"], t))

    for i, r in enumerate(job["redactions"]):
        user = ANECDOTE_USER.format(name=p["name"], role=p["role_de"], style=_style(p),
                                    context=r["context"], value=r["value"])
        t, _ = _gen_turn(llm, judge, user, allowed_numbers([], p, [r["value"]]), [r["value"]], None)
        t = t or Turn(question="Gibt es dazu ein Beispiel?",
                      answer=f"Da fällt mir ein Fall ein, {r['context']}: {r['value']}. Aber egal.")
        turns.insert(min(2 + 3 * i, len(turns)), (None, t))

    lines: list[str] = []
    fact_lines: dict[str, int] = {}  # fact id -> paragraph number (1-based) that states it
    if job["modality"] == "audio":
        part = (f" Das ist Teil {job['part']} von {job['parts']} unserer Interviewreihe."
                if job["parts"] > 1 else "")
        lines += [(f"Finn: Hallo {first}, danke, dass du dir Zeit nimmst.{part} Ich bin Finn, eine KI, "
                  "und nehme unser Gespräch auf, damit dein Wissen im Amt bleibt."),
                  f"{last}: Gern, Finn. Dann erzähle ich mal."]
        for fid, t in turns:
            lines.append(f"Finn: {t.question}")
            lines.append(f"{last}: {t.answer}")
            if fid:
                fact_lines[fid] = len(lines)
        lines += [f"Finn: Danke, {first}! Ich mache daraus eine Handbuchseite und zeige sie dir zur Freigabe.",
                  f"{last}: Prima, so machen wir das."]
    elif job["modality"] == "video":
        lines.append(f"{last}: Hallo zusammen, ich zeige euch heute ein paar Dinge direkt am Bildschirm.")
        for fid, t in turns:
            lines.append(f"{last}: {t.answer}")
            if fid:
                fact_lines[fid] = len(lines)
        lines.append(f"{last}: Das war's für heute. Bei Fragen meldet euch gern.")
    else:  # email thread: one mail per fact
        team = [o for o in personas.values() if o["department"] == p["department"] and o["id"] != p["id"]]
        to = ", ".join(o["email"] for o in team) or "alle@fa-hildesheim.example"
        for n, (fid, t) in enumerate(turns):
            lines.append(
                f"Von: {p['name']} <{p['email']}>\nAn: {to}\nDatum: {20 - n:02d}.11.2026\n"
                f"Betreff: {t.question}\n\nLiebe Kolleginnen und Kollegen,\n{t.answer}\n"
                f"Viele Grüße\n{p['name']}"
            )
            if fid:
                fact_lines[fid] = len(lines)
    return "\n\n".join(lines), fact_lines, fallbacks


def gen_llm(jobs, personas) -> list[dict]:
    from langchain_ollama import ChatOllama

    from hilde.config import get_settings

    s = get_settings()
    base = {"base_url": s.ollama_base_url, "model": s.llm_model, "num_ctx": 4096,
            "keep_alive": s.keep_alive_s, "num_predict": 600}
    llm = ChatOllama(**base, temperature=0.5).with_structured_output(Turn, method="json_schema")
    judge = ChatOllama(**base, temperature=0).with_structured_output(Faithful, method="json_schema")
    out = []
    for i, job in enumerate(jobs, 1):
        p = personas[job["pid"]]
        slug = {"audio": f"{job['kind']}_interview", "video": "screen_recording",
                "email": "email_thread"}[job["modality"]]
        if job["parts"] > 1:
            slug += f"_part{job['part']}"
        name = f"{job['modality']}_{job['pid']}_{slug}"
        folder = {"audio": "audio", "video": "video", "email": "docs"}[job["modality"]]
        txt = RAW / folder / f"{name}.txt"
        print(f"[{i}/{len(jobs)}] {name} ({len(job['facts'])} facts) ...", flush=True)
        text, fact_lines, fallbacks = run_job(job, personas, llm, judge)
        write(txt, text)
        media = None if job["modality"] == "email" else RAW / folder / (
            f"{name}.wav" if job["modality"] == "audio" else f"{name}.mp4")
        if fallbacks:
            print(f"    ! verbatim fallback used for {fallbacks}")
        out.append(entry(media or txt, job["modality"], job["pid"], job["facts"], "internal",
                         p["department"], transcript=txt, generator="llm-per-fact",
                         interview_type=job["kind"], voice=p.get("voice"),
                         redaction_targets=[t["value"] for t in job["redactions"]],
                         fact_paragraphs=fact_lines, fallbacks=fallbacks,
                         media_pending=media is not None))
    return out


# ---------------------------------------------------------------- main

def merge_manifest(new: list[dict]) -> int:
    """Replace entries for regenerated files, keep the rest (e.g. Person C's media entries)."""
    old = []
    if MANIFEST.exists():
        old = [json.loads(line) for line in MANIFEST.read_text(encoding="utf-8").splitlines() if line]
    files = {e["file"] for e in new}
    rows = [e for e in old if e["file"] not in files] + new
    rows.sort(key=lambda e: e["file"])
    MANIFEST.write_text("".join(json.dumps(e, ensure_ascii=False) + "\n" for e in rows), encoding="utf-8")
    return len(rows)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--plan", action="store_true", help="list jobs, generate nothing")
    ap.add_argument("--only", nargs="*", help="persona ids for LLM texts")
    ap.add_argument("--templates-only", action="store_true")
    args = ap.parse_args()

    facts, plants, personas, rules, _company = world()
    jobs = [] if args.templates_only else plan_llm(facts, plants, personas, set(args.only or []))
    if args.plan:
        for j in jobs:
            print(f"{j['modality']:<6} {j['pid']} {j['kind']:<20} part {j['part']}/{j['parts']}"
                  f"  facts={[f['id'] for f in j['facts']]}  redact={[t['value'] for t in j['redactions']]}")
        return

    entries = gen_rules(rules, facts, personas) + gen_fact_pages(facts, personas)
    print(f"templates: {len(entries)} files")
    entries += gen_llm(jobs, personas)
    print(f"manifest: {merge_manifest(entries)} entries -> {MANIFEST.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
