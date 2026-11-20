"""Question answering as a LangGraph:

    chitchat -> (END | retrieve -> generate -> (cite | abstain))

* chitchat: greetings, thanks, "how are you" etc. get a friendly fixed reply (hilde/chitchat.py).
* retrieve: role-filtered hybrid search + the asker's own directory entry + predecessors
  of hits that replaced older knowledge (for "changed on ..., previously ...").
* generate: Qwen with structured output decides `answerable` and which sources it used.
* cite:     keep only citations the answer really uses; no valid citation -> abstain.
* abstain:  "I don't know", pick who to ask, store the open question for the next interview.
"""

import time
from typing import TypedDict

from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import END, StateGraph
from pydantic import BaseModel, Field

from hilde import chitchat as smalltalk
from hilde import language, open_questions
from hilde.llm import get_llm
from hilde.loaders import load_company, load_personas
from hilde.prompts import (
    ANSWER_SYSTEM,
    ANSWER_USER,
    RETRY_EMPTY,
    VERIFY_SYSTEM,
    VERIFY_USER,
    WHO_TO_ASK_SYSTEM,
    WHO_TO_ASK_USER,
)
from hilde.schemas import Answer, Change, Citation, Contact, Hit, User
from hilde.vectorstore import get_by_source_id, search

TOP_K = 8


class Sentence(BaseModel):
    text: str = Field(description="ein Satz der Antwort, in der ANTWORTSPRACHE, ohne Quellennummer")
    sources: list[int] = Field(description="Nummern der QUELLEN, die diesen Satz belegen")


class Generated(BaseModel):
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
    # field order matters: the model writes the topics first, then judges ("think, then decide")
    question_meaning: str = Field(
        description="Was bedeutet der Fachbegriff der FRAGE genau? Ein Satz (was, wie oft, wofür)."
    )
    source_meaning: str = Field(
        description="Was bedeuten die 'Thema:'-Angaben der QUELLEN genau? Ein Satz (was, wie oft, wofür)."
    )
    answers_question: bool = Field(description="beantwortet die ANTWORT genau die gestellte FRAGE?")
    supported_by_sources: bool = Field(description="ist jede Aussage durch die QUELLEN gedeckt?")


class PickedPerson(BaseModel):
    person_id: str


class State(TypedDict, total=False):
    question: str
    user: User
    lang: language.Lang  # language of the question; every reply uses it
    hits: list[Hit]
    history: dict[int, Hit]  # source number -> superseded predecessor
    generated: Generated
    verified: bool
    result: Answer
    started: float


# ---------- nodes ----------

def chitchat(state: State) -> State:
    lang = language.detect(state["question"])
    kind = smalltalk.classify(state["question"])
    if kind == "none":
        return {"lang": lang}
    first = (state["user"].name or "").split(" ")[0]
    return {"lang": lang, "result": Answer(
        question=state["question"], answer=smalltalk.reply(kind, first, lang), abstained=False)}


def route_chitchat(state: State) -> str:
    return "done" if "result" in state else "retrieve"


def retrieve(state: State) -> State:
    user, question = state["user"], state["question"]
    hits = [h for h in search(question, user, k=TOP_K) if h.source_id != user.id]
    me = get_by_source_id(user.id, user)  # resolves "ich/mich" (deputy, mentor, room ...)
    if me:
        hits.insert(0, me)  # always source [1], see prompt rule 6
    history = {}
    for n, h in enumerate(hits, 1):
        old_id = h.metadata.get("supersedes")
        if old_id and (old := get_by_source_id(old_id, user)):
            history[n] = old
    return {"hits": hits, "history": history}


def _format_sources(hits: list[Hit], history: dict[int, Hit]) -> str:
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


def route_generated(state: State) -> str:
    g = state["generated"]
    # an answer without at least one sentence backed by a real source is not allowed
    sentences = g.valid_sentences(len(state["hits"]))
    if not g.answerable or not sentences:
        return "abstain"
    # "Mein Büro ist in Raum 2.04" = the asker's data told as if it were Hilde's
    if smalltalk.speaks_about_itself([t for t, _ in sentences]):
        return "self"
    return "verify"


def about_self(state: State) -> State:
    """Fixed reply when the model answered a question about Hilde with someone else's data."""
    first = (state["user"].name or "").split(" ")[0]
    return {"result": Answer(question=state["question"], abstained=False,
                             answer=smalltalk.reply("where_are_you", first, state.get("lang", "de")))}


def verify(state: State) -> State:
    """Second, strict LLM pass: does the answer really address the question, and do the
    cited sources support it? Catches 'related topic' answers (fluent, cited, but wrong)."""
    g, hits = state["generated"], state["hits"]
    sentences = g.valid_sentences(len(hits))
    used = sorted({n for _, nums in sentences for n in nums})
    try:
        v: Verdict = get_llm().with_structured_output(Verdict, method="json_schema").invoke([
            SystemMessage(VERIFY_SYSTEM),
            HumanMessage(VERIFY_USER.format(
                question=state["question"],
                answer=" ".join(t for t, _ in sentences),
                sources="\n\n".join(
                    f"[{n}] Thema: {hits[n - 1].metadata.get('title', '')}\n{hits[n - 1].text}"
                    for n in used
                ),
            )),
        ])
    except Exception:  # noqa: BLE001 - if the check itself fails, do not block the answer
        return {"verified": True}
    if any(hits[n - 1].status == "conflict" for n in used):
        # known contradiction between sources: reporting both is the desired behaviour
        return {"verified": v.supported_by_sources}
    return {"verified": v.answers_question and v.supported_by_sources}


def route_verified(state: State) -> str:
    return "cite" if state["verified"] else "abstain"


def cite(state: State) -> State:
    """Renumber used sources 1..k in order of appearance and render 'Satz. [1][2]'."""
    g, hits = state["generated"], state["hits"]
    renumber: dict[int, int] = {}
    parts = []
    for text, nums in g.valid_sentences(len(hits)):
        for n in nums:
            renumber.setdefault(n, len(renumber) + 1)
        marks = "".join(f"[{renumber[n]}]" for n in nums)
        parts.append(f"{text.rstrip()} {marks}")
    citations = [
        Citation(
            n=new,
            source_id=hits[old - 1].source_id,
            source_type=hits[old - 1].source_type,
            citation=hits[old - 1].citation,
            snippet=hits[old - 1].text[:300],
            status=hits[old - 1].status,
            valid_from=hits[old - 1].metadata.get("valid_from"),
        )
        for old, new in renumber.items()
    ]
    return {"result": Answer(
        question=state["question"], answer=" ".join(parts), abstained=False,
        conflict=g.conflict or any(c.status == "conflict" for c in citations),
        citations=citations,
        changes=_changes(renumber, hits, state["history"]),
    )}


def _changes(renumber: dict[int, int], hits: list[Hit], history: dict[int, Hit]) -> list[Change]:
    """Deterministic 'changed on ..., previously ...' notes for cited sources (no LLM needed)."""
    out = []
    for old_n, new_n in renumber.items():
        if old_n in history:
            prev = history[old_n]
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
    },
    "en": {
        "off_topic": ("I don't have any information on that. I can help you with questions about "
                      "working at the Finanzamt Hildesheim."),
        "unknown": "Sorry, I don't know that – I have no source for it.",
        "ask": " Your best bet is to ask {name} ({role}, room {room}, ext. {ext}).",
        "leaving": " I've noted the question for the next handover interview with {name}.",
        "noted": " I've noted the question so we can close this knowledge gap.",
    },
}


def abstain(state: State) -> State:
    user, question = state["user"], state["question"]
    t = _ABSTAIN[state.get("lang", "de")]
    pid = _pick_person(question, user.id)
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
    g.add_node("chitchat", chitchat)
    g.add_node("retrieve", retrieve)
    g.add_node("generate", generate)
    g.add_node("verify", verify)
    g.add_node("cite", cite)
    g.add_node("abstain", abstain)
    g.add_node("self", about_self)
    g.set_entry_point("chitchat")
    g.add_conditional_edges("chitchat", route_chitchat, {"done": END, "retrieve": "retrieve"})
    g.add_edge("retrieve", "generate")
    g.add_conditional_edges("generate", route_generated, {"verify": "verify", "abstain": "abstain", "self": "self"})
    g.add_conditional_edges("verify", route_verified, {"cite": "cite", "abstain": "abstain"})
    g.add_edge("cite", END)
    g.add_edge("abstain", END)
    g.add_edge("self", END)
    return g.compile()


_GRAPH = None


def ask(question: str, user: User) -> Answer:
    global _GRAPH
    _GRAPH = _GRAPH or build_graph()
    t = time.time()
    out = _GRAPH.invoke({"question": question, "user": user})
    result: Answer = out["result"]
    result.seconds = round(time.time() - t, 2)
    return result
