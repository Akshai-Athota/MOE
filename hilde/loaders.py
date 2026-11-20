"""Turn Person A's YAML world (facts, rules, personas) into LangChain Documents.

This seeds Q's memory before any audio/doc is ingested. Later steps add chunks
from real sources (source_type "segment" / "handbook") with the same metadata keys.
"""

from datetime import date
from pathlib import Path

import yaml
from langchain_core.documents import Document

from hilde.config import get_settings
from hilde.schemas import User

FACT_DEFAULTS = {
    "also_known_by": [],
    "valid_to": None,
    "status": "current",
    "supersedes": None,
    "rule": None,
    "plant": None,
    "question_ids": [],
}


def _iso(v) -> str | None:
    return v.isoformat() if isinstance(v, date) else v


def _de_date(v) -> str:
    return v.strftime("%d.%m.%Y") if isinstance(v, date) else str(v)


def _read(path: Path) -> dict:
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def _data_dir() -> Path:
    return get_settings().data_dir


def load_personas() -> dict[str, dict]:
    return {
        p["id"]: p
        for p in (_read(f) for f in sorted((_data_dir() / "personas").glob("p*.yaml")))
    }


def load_company() -> dict:
    return _read(_data_dir() / "company" / "company.yaml")


def user_from_persona(pid: str) -> User:
    p = load_personas()[pid]
    return User(id=p["id"], name=p["name"], role=p["access_role"], department=p["department"])


def _superseded_by(items: list[dict]) -> dict[str, str]:
    return {i["supersedes"]: i["id"] for i in items if i.get("supersedes")}


def fact_documents() -> list[Document]:
    raw = _read(_data_dir() / "facts" / "facts.yaml")["facts"]
    facts = [{**FACT_DEFAULTS, **f} for f in raw]
    newer = _superseded_by(facts)
    people = load_personas()
    docs = []
    for f in facts:
        owner = people.get(f["owner"], {}).get("name", f["owner"])
        docs.append(
            Document(
                page_content=f"{f['topic']}: {f['de']}",
                metadata={
                    "chunk_id": f["id"],
                    "source_type": "fact",
                    "source_id": f["id"],
                    "title": f["topic"],
                    "category": f["category"],
                    "department": f["department"],
                    "access": f["access"],
                    "status": "superseded" if f["id"] in newer else f["status"],
                    "valid_from": _iso(f.get("valid_from")),
                    "valid_to": _iso(f["valid_to"]),
                    "supersedes": f["supersedes"],
                    "superseded_by": newer.get(f["id"]),
                    "owner": f["owner"],
                    "owner_name": owner,
                    "also_known_by": f["also_known_by"],
                    "rule": f["rule"],
                    "question_ids": f["question_ids"],
                    "citation": f"Wissensbasis {f['id']} · {f['topic']} (Wissensträger: {owner})",
                },
            )
        )
    return docs


def _rule_categories() -> dict[str, str]:
    """rules.yaml has no category: take the most common category of the facts that cite the rule."""
    from collections import Counter

    votes: dict[str, Counter] = {}
    for f in _read(_data_dir() / "facts" / "facts.yaml")["facts"]:
        if f.get("rule"):
            votes.setdefault(f["rule"], Counter())[f["category"]] += 1
    return {rid: c.most_common(1)[0][0] for rid, c in votes.items()}


def rule_documents() -> list[Document]:
    rules = _read(_data_dir() / "rules" / "rules.yaml")["rules"]
    newer = _superseded_by(rules)
    categories = _rule_categories()
    docs = []
    for r in rules:
        clauses = "\n".join(f"Ziffer {i}: {c}" for i, c in enumerate(r.get("clauses", []), 1))
        valid = f"gültig ab {_de_date(r['valid_from'])}"
        if r.get("valid_to"):
            valid += f" bis {_de_date(r['valid_to'])}"
        docs.append(
            Document(
                page_content=(
                    f"Hausverfügung {r['id']}: {r['title_de']} ({valid}).\n"
                    f"{r.get('summary_de', '')}\n{clauses}"
                ),
                metadata={
                    "chunk_id": r["id"],
                    "source_type": "rule",
                    "source_id": r["id"],
                    "title": r["title_de"],
                    "category": categories.get(r["id"], "process"),
                    "department": "ALL",
                    "access": r.get("access", "internal"),
                    "status": "superseded" if r["id"] in newer else r.get("status", "current"),
                    "valid_from": _iso(r["valid_from"]),
                    "valid_to": _iso(r.get("valid_to")),
                    "supersedes": r.get("supersedes"),
                    "superseded_by": newer.get(r["id"]),
                    "owner": str(r.get("issued_by", "")),
                    "question_ids": [],
                    "citation": f"Hausverfügung {r['id']} · {r['title_de']} ({valid})",
                },
            )
        )
    return docs


def person_documents() -> list[Document]:
    """Staff directory: answers 'who is ...', 'who covers for ...', 'which room ...'."""
    people = load_personas()
    depts = load_company()["departments"]

    def name(pid):
        return people[pid]["name"] if pid in people else "nicht festgelegt"

    status_de = {"leaving": "scheidet aus", "new": "neu im Amt", "active": "aktiv"}
    docs = []
    for p in people.values():
        status = status_de.get(p["status"], p["status"])
        if p.get("leave_date"):
            status += f" (zum {_de_date(p['leave_date'])})"
        text = (
            f"{p['name']} – {p['role_de']}, {depts[p['department']]['name_de']}. "
            f"Status: {status}. Raum {p['room']}, Telefon {p['phone_ext']}, E-Mail {p['email']}. "
            f"Vorgesetzt: {name(p['reports_to']) if p.get('reports_to') else '—'}. "
            f"Vertretung: {name(p['deputy']) if p.get('deputy') else 'nicht festgelegt'}."
        )
        if p.get("mentor"):
            text += f" Mentor/in: {name(p['mentor'])}."
        docs.append(
            Document(
                page_content=text,
                metadata={
                    "chunk_id": f"person-{p['id']}",
                    "source_type": "person",
                    "source_id": p["id"],
                    "title": p["name"],
                    "category": "org",
                    "department": p["department"],
                    "access": "internal",
                    "status": "current",
                    "owner": p["id"],
                    "question_ids": ["Q01", "Q05"],
                    "citation": f"Personalverzeichnis · {p['name']}",
                },
            )
        )
    return docs


def all_seed_documents() -> list[Document]:
    return fact_documents() + rule_documents() + person_documents()
