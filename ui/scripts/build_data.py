#!/usr/bin/env python3
"""Bundle the YAML dataset (data/) into one JSON file for the UI's mock engine."""
import datetime as dt
import json
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
OUT = Path(__file__).resolve().parents[1] / "src" / "data" / "dataset.json"


def load(p):
    with open(p, encoding="utf-8") as f:
        return yaml.safe_load(f)


def default(o):
    if isinstance(o, (dt.date, dt.datetime)):
        return o.isoformat()
    raise TypeError(type(o))


facts_doc = load(DATA / "facts" / "facts.yaml")
bundle = {
    "company": load(DATA / "company" / "company.yaml"),
    "personas": [load(p) for p in sorted((DATA / "personas").glob("p*.yaml"))],
    "rules": load(DATA / "rules" / "rules.yaml")["rules"],
    "facts": facts_doc["facts"],
    "plants": facts_doc["plants"],
    "questions": load(DATA / "schema" / "questions.yaml")["questions"],
    "quiz": load(DATA / "celebration" / "quiz.yaml"),
}
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps(bundle, ensure_ascii=False, default=default, indent=1), encoding="utf-8")
print(f"wrote {OUT.relative_to(ROOT)} ({len(bundle['facts'])} facts)")
