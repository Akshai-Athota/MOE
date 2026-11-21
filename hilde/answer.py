"""Question answering as a LangGraph:

    chitchat -> (END | retrieve -> generate -> verify -> (cite | retry -> retrieve ... | abstain))

* chitchat: greetings, thanks, "how are you" etc. get a friendly fixed reply (hilde/chitchat.py).
* retrieve: role-filtered hybrid search + the asker's own directory entry + predecessors
  of hits that replaced older knowledge (for "changed on ..., previously ...").
* generate: Qwen with structured output decides `answerable` and which sources it used.
* cite:     keep only citations the answer really uses; no valid citation -> abstain.
* retry:    an "I don't know" about an office topic is retried up to 3 times with a broader
            search (rephrased query, key terms, more sources). Off-topic questions are not retried.
* abstain:  "I don't know", pick who to ask, store the open question for the next interview.

Questionnaire questions (hilde/templates.py) get their linked sources first, skip the second
verification pass and are cached until knowledge changes, so they answer fast.
"""

import re
import time
from typing import TypedDict

from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import END, StateGraph
from pydantic import BaseModel, ConfigDict, Field

from hilde import chitchat as smalltalk
from hilde import language, open_questions, profile, templates
from hilde.config import get_settings
from hilde.llm import get_llm
from hilde.loaders import load_company, load_personas
from hilde.prompts import (
    ANSWER_SYSTEM,
    ANSWER_USER,
    RETRY_EMPTY,
    RETRY_QUERY_SYSTEM,
    VERIFY_SYSTEM,
    VERIFY_USER,
    WHO_TO_ASK_SYSTEM,
    WHO_TO_ASK_USER,
)
from hilde.rewrite import rewrite
from hilde.schemas import Answer, Change, Citation, Contact, Hit, User
from hilde.vectorstore import by_question_id, get_by_source_id, relevance, restricted_probe, search

TOP_K = 8


class Sentence(BaseModel):
    text: str = Field(description="ein Satz der Antwort, in der ANTWORTSPRACHE, ohne Quellennummer")
    sources: list[int] = Field(description="Nummern der QUELLEN, die diesen Satz belegen")


def _all_required(schema: dict) -> None:
    """qwen3 omits optional JSON fields (e.g. returns no "sentences" at all). Fields keep their
    Python defaults, but the schema sent to the model lists every property as required."""
    schema["required"] = list(schema.get("properties", {}))


class Generated(BaseModel):
    model_config = ConfigDict(json_schema_extra=_all_required)

    answerable: bool = Field(description="true nur, wenn die QUELLEN die Frage beantworten")
    sentences: list[Sentence] = Field(
        default_factory=list, description="1-5 Sätze; leer, wenn answerable=false"
    )
    conflict: bool = False

    def valid_sentences(self, n_sources: int) -> list[tuple[str, list[int]]]:
        """Sentences with at least one existing source; unsupported sentences are dropped."""
        out = []
        for s in self.sentences:
            nums = sorted({n for n in s.sources if 1 <= n <= n_sources})
            if s.text.strip() and nums:
                out.append((s.text.strip(), nums))
        return out


class Verdict(BaseModel):
    model_config = ConfigDict(json_schema_extra=_all_required)

    # field order matters: the model writes the topics first, then judges ("think, then decide")
    question_meaning: str = Field(
        description="Was bedeutet der Fachbegriff der FRAGE genau? Ein Satz (was, wie oft, wofür)."
    )
    source_meaning: str = Field(
        description="Was bedeuten die 'Thema:'-Angaben der QUELLEN genau? Ein Satz (was, wie oft, wofür)."
    )
    answers_question: bool = Field(description="beantwortet die ANTWORT genau die gestellte FRAGE?")
    supported_by_sources: bool = Field(description="ist jede Aussage durch die QUELLEN gedeckt?")
    sources_contradict: bool = Field(
        default=False, description="widersprechen sich die QUELLEN in dem, was zur FRAGE gesagt wird?")


class PickedPerson(BaseModel):
    person_id: str


class State(TypedDict, total=False):
    question: str  # after normalize(): the cleaned-up question every later step uses
    original: str  # exactly what the user typed
    user: User
    lang: language.Lang  # language of the question; every reply uses it
    hits: list[Hit]
    history: dict[int, Hit]  # source number -> superseded predecessor
    generated: Generated
    verified: bool
    contradiction: bool
    restricted_owner: str | None  # owner of a better-matching source this role may not see
    result: Answer
    started: float
    template: dict | None  # matched questionnaire question
    attempt: int  # retries done after an "I don't know"
    query: str  # search query (rephrased on retries)
    relevance: float  # best cosine of the question in the whole knowledge base


# ---------- nodes ----------

def normalize(state: State) -> State:
    """LLM rewrite into one clean question (typos, grammar). Clear cases skip the extra call:
    small talk and "who am I" are recognised by patterns already."""
    q = state["question"]
    if profile.is_identity_question(q) or smalltalk.classify(q, use_llm=False) != "none":
        return {"original": q}
    return {"original": q, "question": rewrite(q)}


def chitchat(state: State) -> State:
    lang = language.detect(state["question"])
    if profile.is_identity_question(state["question"]):  # "Wer bin ich?" -> own directory entry
        return {"lang": lang, "result": profile.identity_answer(state["question"], state["user"], lang)}
    kind = smalltalk.classify(state["question"])
    if kind == "none":
        return {"lang": lang}
    text = smalltalk.reply(kind, lang, wrong_name=smalltalk.addressed_as(state["question"]))
    return {"lang": lang, "result": Answer(question=state["question"], answer=text, abstained=False)}


def route_chitchat(state: State) -> str:
    return "done" if "result" in state else "retrieve"


def retrieve(state: State) -> State:
    user, question = state["user"], state["question"]
    attempt = state.get("attempt", 0)
    hits = [h for h in search(state.get("query") or question, user, k=TOP_K + 6 * attempt)
            if h.source_id != user.id]
    if tpl := state.get("template"):
        # questionnaire question: the curated sources for it come first
        linked = [h for h in by_question_id(tpl["id"], user) if h.status not in ("superseded", "scheduled")]
        seen = {h.chunk_id for h in linked}
        hits = (linked + [h for h in hits if h.chunk_id not in seen])[:TOP_K + 6 * attempt]
    me = get_by_source_id(user.id, user)  # resolves "ich/mich" (deputy, mentor, room ...)
    if me:
        hits.insert(0, me)  # always source [1], see prompt rule 6
    history = {}
    for n, h in enumerate(hits, 1):
        old_id = h.metadata.get("supersedes")
        if old_id and (old := get_by_source_id(old_id, user)):
            history[n] = old
    hidden = restricted_probe(question, user)
    return {"hits": hits, "history": history,
            "restricted_owner": hidden.metadata.get("owner") if hidden else None}


# Windows paths (S:\Amt\...) break the model's JSON output ("\A" is an invalid escape) and get
# cut off. The model sees a look-alike character instead; cite() turns it back into "\".
BS = chr(0x5C)  # backslash
BS_SAFE = chr(0x29F5)  # "⧵" reverse solidus operator: looks the same, no JSON escaping


def _format_sources(hits: list[Hit], history: dict[int, Hit]) -> str:
    return _format_sources_raw(hits, history).replace(BS, BS_SAFE)


def _format_sources_raw(hits: list[Hit], history: dict[int, Hit]) -> str:
    lines = []
    for n, h in enumerate(hits, 1):
        md = h.metadata
        meta = f"{h.citation}; Status: {h.status}"
        if md.get("valid_from"):
            meta += f"; gültig ab {md['valid_from']}"
        lines.append(f"[{n}] ({meta})\n{h.text}")
        if n in history:
            old = history[n]
            lines.append(
                f"    FRÜHERE FASSUNG von [{n}] (gültig bis {old.metadata.get('valid_to')}): {old.text}"
            )
    return "\n\n".join(lines)


def _asker(user: User) -> str:
    p = load_personas().get(user.id, {})
    return f"{user.name or user.id} ({p.get('role_de', user.role)}, Abteilung {user.department})"


def generate(state: State) -> State:
    if not state["hits"]:
        return {"generated": Generated(answerable=False)}
    llm = get_llm().with_structured_output(Generated, method="json_schema")
    messages = [
        SystemMessage(ANSWER_SYSTEM),
        HumanMessage(ANSWER_USER.format(
            asker=_asker(state["user"]),
            sources=_format_sources(state["hits"], state["history"]),
            question=state["question"],
            language=language.NAMES[state.get("lang", "de")],
        )),
    ]
    out: Generated = llm.invoke(messages)
    if out.answerable and not out.valid_sentences(len(state["hits"])):
        # 7B models sometimes say "answerable" but return no sentences: retry once
        messages.append(HumanMessage(RETRY_EMPTY))
        out = llm.invoke(messages)
    return {"generated": out}


_ADDRESSES_Q = re.compile(r"\b(du|dich|dir|dein\w*|you|your\w*)\b")


def route_generated(state: State) -> str:
    g = state["generated"]
    # an answer without at least one sentence backed by a real source is not allowed
    sentences = g.valid_sentences(len(state["hits"]))
    if not g.answerable or not sentences:
        return "unknown"
    # "Mein Büro ist in Raum 2.04" = the asker's data told as if it were Q's.
    # Only for questions addressed to Q: learned interview answers are legitimately first person.
    if _ADDRESSES_Q.search(state.get("question", "").lower()) and smalltalk.speaks_about_itself(
            [t for t, _ in sentences]):
        return "self"
    if state.get("template"):
        return "cite"  # curated sources for a questionnaire question: skip the second pass (fast)
    return "verify"


WORD = re.compile(r"(?<![\wÄÖÜäöüß])[A-ZÄÖÜ][a-zäöüß]{9,}")  # capitalised = noun; verbs vary too much


def key_term_grounded(question: str, sources: list[str]) -> bool:
    """German compound nouns carry the topic ("Haushaltsanmeldung", "Mitzeichnungsverfahren").
    The longest such noun of the question must appear (first 12 letters) in a cited source.
    Cheap guard against fluent answers about a similar-sounding topic."""
    words = WORD.findall(question)
    if not words:
        return True
    stem = max(words, key=len)[:12].lower()  # 12: "haushaltsanm" must not match "Haushaltsangelegenheiten"
    return any(stem in s.lower() for s in sources)


def about_self(state: State) -> State:
    """Fixed reply when the model answered a question about Q with someone else's data."""
    return {"result": Answer(question=state["question"], abstained=False,
                             answer=smalltalk.reply("where_are_you", state.get("lang", "de")))}


def verify(state: State) -> State:
    """Second, strict pass: does the answer really address the question, do the cited sources
    support it, and do they contradict each other? Catches 'related topic' answers."""
    g, hits = state["generated"], state["hits"]
    sentences = g.valid_sentences(len(hits))
    used = sorted({n for _, nums in sentences for n in nums})
    # German-compound check: only meaningful when the question is German like the sources
    cited = [hits[n - 1].text for n in used]
    # the user's own words OR the cleaned-up question may carry the key term (rewrites can coin words)
    if state.get("lang", "de") == "de" and not (
            key_term_grounded(state["question"], cited)
            or key_term_grounded(state.get("original", state["question"]), cited)):
        return {"verified": False, "contradiction": False}
    try:
        v: Verdict = get_llm().with_structured_output(Verdict, method="json_schema").invoke([
            SystemMessage(VERIFY_SYSTEM),
            HumanMessage(VERIFY_USER.format(
                question=state["question"],
                answer=" ".join(t for t, _ in sentences),
                sources="\n\n".join(
                    f"[{n}] Thema: {hits[n - 1].citation}\n{hits[n - 1].text}" for n in used
                ),
            )),
        ])
    except Exception:  # noqa: BLE001 - if the check itself fails, do not block the answer
        return {"verified": True, "contradiction": False}
    # Conflicts are detected when knowledge is stored (memory update step) and kept as
    # status="conflict". Pairwise LLM checks at question time were unreliable with a 7B model.
    contradiction = (v.sources_contradict and len(used) > 1) or any(
        hits[n - 1].status == "conflict" for n in used)
    if contradiction:
        # contradicting sources: reporting both (and flagging it) is the desired behaviour
        return {"verified": v.supported_by_sources, "contradiction": True}
    return {"verified": v.answers_question and v.supported_by_sources, "contradiction": False}


def route_verified(state: State) -> str:
    return "cite" if state["verified"] else "unknown"


def unknown(state: State) -> State:
    """The model could not answer. Measure whether the question is about the office at all: best
    score of the asked wording, the cleaned-up wording and the latest retry query (a typo like
    "finanazamt" scores low until a retry spells it out)."""
    if state.get("restricted_owner"):
        return {}
    texts = {state["question"], state.get("original") or state["question"], state.get("query") or state["question"]}
    try:
        best = max(relevance(t) for t in texts if t)
    except Exception:  # noqa: BLE001 - without the score, assume relevant
        best = 1.0
    return {"relevance": max(best, state.get("relevance", 0.0))}


def is_relevant(state: State) -> bool:
    """Before the first retry only clearly off-topic questions stop (typos score low too)."""
    floor = get_settings().relevance_min_score
    if state.get("attempt", 0) == 0:
        floor = min(floor, 0.35)
    return state.get("relevance", 1.0) >= floor


def after_unknown(state: State) -> str:
    """The model could not answer: retry (broader search) up to 3 times, unless the question is
    off-topic or the answer exists only for other roles."""
    if state.get("restricted_owner"):
        return "abstain"
    if state.get("attempt", 0) >= get_settings().answer_retries or not is_relevant(state):
        return "abstain"
    return "retry"


_KEY = re.compile(r"[A-Za-zÄÖÜäöüß][\wÄÖÜäöüß-]{3,}")


def retry(state: State) -> State:
    """Broaden the search: 1) rephrase with office vocabulary, 2) key terms only, 3) the closest
    questionnaire wording. Each attempt also fetches more sources."""
    attempt = state.get("attempt", 0) + 1
    q = state["question"]
    query = q
    if attempt == 1:
        try:
            query = get_llm().invoke([SystemMessage(RETRY_QUERY_SYSTEM), HumanMessage(q)]).content.strip() or q
        except Exception:  # noqa: BLE001
            query = q
    elif attempt == 2:
        terms = [w for w in _KEY.findall(q) if w.lower() not in templates.STOP]
        query = " ".join(terms) or q
    else:
        best = max(templates.catalogue(), key=lambda c: len(templates.stems(q) & c["_stems"]), default=None)
        query = f"{q} {best['de']}" if best else q
    return {"attempt": attempt, "query": query}


def cite(state: State) -> State:
    """Renumber used sources 1..k in order of appearance and render 'Satz. [1][2]'."""
    g, hits = state["generated"], state["hits"]
    renumber: dict[int, int] = {}
    parts = []
    for text, nums in g.valid_sentences(len(hits)):
        for n in nums:
            renumber.setdefault(n, len(renumber) + 1)
        marks = "".join(f"[{renumber[n]}]" for n in nums)
        parts.append(f"{text.rstrip().replace(BS_SAFE, BS)} {marks}")
    citations = [
        Citation(
            n=new,
            source_id=hits[old - 1].source_id,
            source_type=hits[old - 1].source_type,
            citation=hits[old - 1].citation,
            snippet=hits[old - 1].text[:300],
            status=hits[old - 1].status,
            valid_from=hits[old - 1].metadata.get("valid_from"),
            anchor=hits[old - 1].metadata.get("anchor") or {},
            source_file=hits[old - 1].metadata.get("source_file"),
            owner=hits[old - 1].metadata.get("owner"),
            modality=hits[old - 1].metadata.get("modality") or hits[old - 1].source_type,
            title=hits[old - 1].metadata.get("title"),
            fact_ids=hits[old - 1].metadata.get("fact_ids")
            or ([hits[old - 1].source_id] if hits[old - 1].source_type == "fact" else []),
        )
        for old, new in renumber.items()
    ]
    return {"result": Answer(
        question=state["question"], answer=" ".join(parts), abstained=False,
        conflict=g.conflict or state.get("contradiction", False)
        or any(c.status == "conflict" for c in citations),
        citations=citations,
        changes=_changes(renumber, hits, state["history"]),
        restricted_owner=_contact(state.get("restricted_owner")),
    )}


def _contact(pid: str | None) -> Contact | None:
    p = load_personas().get(pid or "")
    if not p:
        return None
    return Contact(id=p["id"], name=p["name"], role_de=p["role_de"], room=p["room"],
                   phone_ext=p["phone_ext"], email=p["email"])


def _changes(renumber: dict[int, int], hits: list[Hit], history: dict[int, Hit]) -> list[Change]:
    """Deterministic 'changed on ..., previously ...' notes for cited sources (no LLM needed)."""
    out, seen = [], set()
    for old_n, new_n in renumber.items():
        if old_n in history and history[old_n].source_id not in seen:
            prev = history[old_n]
            seen.add(prev.source_id)
            out.append(Change(
                n=new_n,
                source_id=hits[old_n - 1].source_id,
                changed_on=hits[old_n - 1].metadata.get("valid_from"),
                previous_source_id=prev.source_id,
                previous_text=prev.text,
            ))
    return out


def _pick_person(question: str, asker_id: str) -> str | None:
    people = load_personas()
    depts = load_company()["departments"]
    heads = {d["head"] for d in depts.values()}
    staff = "\n".join(
        f"{p['id']}: {p['name']} – {p['role_de']}"
        f"{' (LEITUNG)' if p['id'] in heads else ''} – Abteilung: {depts[p['department']]['name_en']}"
        for p in people.values() if p["id"] != asker_id and p["status"] != "new"
    )
    try:
        picked = get_llm().with_structured_output(PickedPerson, method="json_schema").invoke([
            SystemMessage(WHO_TO_ASK_SYSTEM),
            HumanMessage(WHO_TO_ASK_USER.format(staff=staff, question=question)),
        ])
        return picked.person_id if picked.person_id in people else None
    except Exception:  # noqa: BLE001 - abstaining must never fail
        return None


_ABSTAIN = {
    "de": {
        "off_topic": ("Dazu habe ich keine Informationen. Ich helfe dir bei Fragen rund um "
                      "die Arbeit im Finanzamt Hildesheim."),
        "unknown": "Das weiß ich leider nicht – dazu habe ich keine Quelle.",
        "ask": " Frag am besten {name} ({role}, Raum {room}, Tel. {ext}).",
        "leaving": " Ich habe die Frage für das nächste Übergabe-Interview mit {name} vorgemerkt.",
        "noted": " Ich habe die Frage vorgemerkt, damit wir die Wissenslücke schließen.",
        "blocked": ("Dazu gibt es Informationen, die für deine Rolle nicht freigegeben sind. "
                    "Wende dich bitte direkt an {name} (Raum {room})."),
    },
    "en": {
        "off_topic": ("I don't have any information on that. I can help you with questions about "
                      "working at the Finanzamt Hildesheim."),
        "unknown": "Sorry, I don't know that – I have no source for it.",
        "ask": " Your best bet is to ask {name} ({role}, room {room}, ext. {ext}).",
        "leaving": " I've noted the question for the next handover interview with {name}.",
        "noted": " I've noted the question so we can close this knowledge gap.",
        "blocked": ("There is information on this that is not released for your role. "
                    "Please ask {name} (room {room}) directly."),
    },
}


def abstain(state: State) -> State:
    user, question = state["user"], state["question"]
    t = _ABSTAIN[state.get("lang", "de")]
    if owner := _contact(state.get("restricted_owner")):
        # the answer exists but only for other roles: say so, name the owner, queue nothing
        return {"result": Answer(question=question, abstained=True, blocked=True,
                                 restricted_owner=owner, who_to_ask=owner,
                                 answer=t["blocked"].format(name=owner.name, room=owner.room))}
    # clearly off-topic (nothing in the knowledge base is close): plain "I don't know", fast
    pid = None if state.get("relevance", 1.0) < get_settings().relevance_min_score else _pick_person(question, user.id)
    if not pid:  # off-topic: nobody to route to, nothing to learn
        return {"result": Answer(question=question, abstained=True, answer=t["off_topic"])}
    p = load_personas()[pid]
    contact = Contact(id=pid, name=p["name"], role_de=p["role_de"], room=p["room"],
                      phone_ext=p["phone_ext"], email=p["email"])
    text = t["unknown"] + t["ask"].format(name=p["name"], role=p["role_de"], room=p["room"],
                                          ext=p["phone_ext"])
    text += (t["leaving"] if p["status"] == "leaving" else t["noted"]).format(name=p["name"])
    qid = open_questions.add(question, asked_by=user.id, assigned_to=pid)
    return {"result": Answer(question=question, answer=text, abstained=True,
                             who_to_ask=contact, open_question_id=qid)}


# ---------- graph ----------

def build_graph():
    g = StateGraph(State)
    g.add_node("normalize", normalize)
    g.add_node("chitchat", chitchat)
    g.add_node("retrieve", retrieve)
    g.add_node("generate", generate)
    g.add_node("verify", verify)
    g.add_node("cite", cite)
    g.add_node("abstain", abstain)
    g.add_node("self", about_self)
    g.add_node("retry", retry)
    g.add_node("unknown", unknown)
    g.set_entry_point("normalize")
    g.add_edge("normalize", "chitchat")
    g.add_conditional_edges("chitchat", route_chitchat, {"done": END, "retrieve": "retrieve"})
    # best match is restricted for this role -> "not released for you", no partial answer
    g.add_conditional_edges("retrieve", lambda s: "abstain" if s.get("restricted_owner") else "generate",
                            {"abstain": "abstain", "generate": "generate"})
    g.add_conditional_edges("generate", route_generated,
                            {"verify": "verify", "cite": "cite", "unknown": "unknown", "self": "self"})
    g.add_conditional_edges("verify", route_verified, {"cite": "cite", "unknown": "unknown"})
    g.add_conditional_edges("unknown", after_unknown, {"retry": "retry", "abstain": "abstain"})
    g.add_edge("retry", "retrieve")
    g.add_edge("cite", END)
    g.add_edge("abstain", END)
    g.add_edge("self", END)
    return g.compile()


_GRAPH = None


def ask(question: str, user: User) -> Answer:
    global _GRAPH
    _GRAPH = _GRAPH or build_graph()
    t = time.time()
    use_cache = get_settings().template_cache
    tpl = templates.match(question)
    lang = language.detect(question)
    if tpl and use_cache and (hit := templates.get(tpl["id"], user.id, lang)) is not None:
        cached = hit.model_copy(update={"question": question})
        cached.seconds = round(time.time() - t, 2)
        return cached
    at_version = templates.version()
    out = _GRAPH.invoke({"question": question, "user": user, "template": tpl, "attempt": 0})
    result: Answer = out["result"]
    result.question = question
    if out["question"] != question:
        result.interpreted_as = out["question"]  # shown in the UI: "verstanden als ..."
    result.seconds = round(time.time() - t, 2)
    if tpl and use_cache and not result.abstained:
        templates.put(tpl["id"], user.id, lang, result, at_version)
    return result
