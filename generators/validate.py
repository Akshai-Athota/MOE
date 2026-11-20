#!/usr/bin/env python3
"""Consistency checks for the synthetic Finanzamt dataset. Run before every push.

Usage: python3 generators/validate.py [--coverage]
Exits non-zero on errors. Person B extends this (manifest, eval checks).
"""
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

CATEGORIES = {"org", "process", "project", "program", "finance", "it", "oversight",
              "communication", "practical", "general", "public"}
ACCESS = {"public", "internal", "restricted"}
DEPARTMENTS = {"AL", "RB", "GS", "VA", "ALL"}
STATUS = {"current", "superseded", "conflict"}
PLANTS = {None, "superseded", "conflict", "restricted", "redaction"}
MODALITIES = {"interview", "doc", "email", "minutes", "image", "video", "intranet"}
ROLES = {"employee", "new_hire", "leaver", "manager"}
PERSONA_KEYS = {"id", "name", "department", "role_de", "role_en", "grade", "status", "tenure_years",
                "start_date", "leave_date", "reports_to", "deputy", "room", "phone_ext", "email",
                "access_role", "speaking_style", "voice", "blind_spots"}
FACT_KEYS = {"id", "category", "topic", "de", "en", "owner", "department", "access",
             "valid_from", "question_ids", "sources_planned"}

errors: list[str] = []


def err(msg: str) -> None:
    errors.append(msg)


def load(path: Path):
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f)


def main() -> int:
    company = load(DATA / "company" / "company.yaml")
    personas = {}
    for p in sorted((DATA / "personas").glob("p*.yaml")):
        d = load(p)
        if d["id"] != p.stem:
            err(f"{p.name}: id {d['id']} != filename")
        missing = PERSONA_KEYS - d.keys()
        if missing:
            err(f"{p.name}: missing keys {sorted(missing)}")
        personas[d["id"]] = d
    pids = set(personas)

    for pid, d in personas.items():
        if d.get("department") not in DEPARTMENTS - {"ALL"}:
            err(f"{pid}: bad department {d.get('department')}")
        if d.get("access_role") not in ROLES:
            err(f"{pid}: bad access_role {d.get('access_role')}")
        for k in ("deputy", "mentor", "mentor_of"):
            v = d.get(k)
            if v is not None and v not in pids:
                err(f"{pid}: {k} -> unknown persona {v}")
        rt = d.get("reports_to")
        if rt not in pids and rt != "LStN":
            err(f"{pid}: reports_to unknown {rt}")

    for code, dep in company["departments"].items():
        for m in dep["members"]:
            if m not in pids:
                err(f"company.yaml: department {code} lists unknown {m}")
            elif personas[m]["department"] != code:
                err(f"company.yaml: {m} listed in {code} but persona says {personas[m]['department']}")

    rules = {r["id"]: r for r in load(DATA / "rules" / "rules.yaml")["rules"]}
    for rid, r in rules.items():
        if r.get("supersedes") and r["supersedes"] not in rules:
            err(f"rule {rid}: supersedes unknown {r['supersedes']}")
        if r.get("access") not in ACCESS:
            err(f"rule {rid}: bad access")

    qdoc = load(DATA / "schema" / "questions.yaml")["questions"]
    qids = {q["id"] for q in qdoc}
    if len(qids) != len(qdoc):
        err("questions.yaml: duplicate ids")

    fdoc = load(DATA / "facts" / "facts.yaml")
    facts = fdoc["facts"]
    fids = [f["id"] for f in facts]
    if len(set(fids)) != len(fids):
        err("facts.yaml: duplicate fact ids")
    fmap = {f["id"]: f for f in facts}

    for f in facts:
        fid = f["id"]
        missing = FACT_KEYS - f.keys()
        if missing:
            err(f"{fid}: missing {sorted(missing)}")
        if f.get("category") not in CATEGORIES:
            err(f"{fid}: bad category {f.get('category')}")
        if f.get("access") not in ACCESS:
            err(f"{fid}: bad access {f.get('access')}")
        if f.get("department") not in DEPARTMENTS:
            err(f"{fid}: bad department {f.get('department')}")
        if f.get("status", "current") not in STATUS:
            err(f"{fid}: bad status")
        if f.get("plant") not in PLANTS:
            err(f"{fid}: bad plant {f.get('plant')}")
        for o in [f.get("owner")] + list(f.get("also_known_by", [])):
            if o not in pids:
                err(f"{fid}: unknown persona {o}")
        for q in f.get("question_ids", []):
            if q not in qids:
                err(f"{fid}: unknown question {q}")
        for m in f.get("sources_planned", []):
            if m not in MODALITIES:
                err(f"{fid}: bad modality {m}")
        if f.get("rule") and f["rule"] not in rules:
            err(f"{fid}: unknown rule {f['rule']}")
        if f.get("supersedes"):
            old = fmap.get(f["supersedes"])
            if not old:
                err(f"{fid}: supersedes unknown {f['supersedes']}")
            elif old.get("status") != "superseded":
                err(f"{fid}: supersedes {old['id']} but that fact is not status=superseded")
        if f.get("status") == "superseded" and not f.get("valid_to"):
            err(f"{fid}: superseded fact needs valid_to")
        if f.get("access") == "restricted" and f.get("plant") != "restricted":
            err(f"{fid}: restricted fact should have plant: restricted")

    plants = fdoc.get("plants", {})
    for c in plants.get("conflicts", []):
        for x in c["facts"] + [c["truth"]]:
            if x not in fmap:
                err(f"plants.conflicts: unknown fact {x}")
            elif fmap[x].get("status") != "conflict":
                err(f"plants.conflicts: {x} should have status=conflict")
    for x in plants.get("restricted", []):
        if fmap.get(x, {}).get("access") != "restricted":
            err(f"plants.restricted: {x} is not access=restricted")
    gap_ids = set()
    for g in plants.get("planted_gaps", []):
        gap_ids.add(g["id"])
        if g["who_to_ask"] not in pids:
            err(f"planted_gap {g['id']}: unknown who_to_ask")
        covered = [f["id"] for f in facts if g["id"] in f.get("question_ids", [])]
        if covered:
            err(f"planted_gap {g['id']} is answered by {covered}; gaps must have no facts")
    for t in plants.get("redaction_targets", []):
        if t["inject_into"] not in pids:
            err(f"redaction target {t['value']}: unknown persona")

    # personas: interests may only exist with explicit consent
    for pid, d in personas.items():
        if d.get("interests") and not (d.get("interests_consent") or {}).get("given"):
            err(f"{pid}: has interests but no interests_consent.given")

    # celebration quiz
    quiz_path = DATA / "celebration" / "quiz.yaml"
    if quiz_path.exists():
        quiz = load(quiz_path)
        gaps_by_id = {g["id"]: g for g in plants.get("planted_gaps", [])}
        secrets = [t["value"] for t in plants.get("redaction_targets", [])]
        qz_ids = [q["id"] for q in quiz["questions"]]
        if len(set(qz_ids)) != len(qz_ids):
            err("quiz.yaml: duplicate question ids")
        for lid in quiz.get("leavers", {}):
            if personas.get(lid, {}).get("status") != "leaving":
                err(f"quiz.yaml: {lid} is not a leaving persona")
        for lid in quiz.get("rewards", {}).get("suggestions", {}):
            if not personas.get(lid, {}).get("interests_consent", {}).get("given"):
                err(f"quiz.yaml: gift suggestions for {lid} without interests consent")
            for s in quiz["rewards"]["suggestions"][lid]:
                if s["est_eur"] > quiz["rewards"]["max_gift_eur"]:
                    err(f"quiz.yaml: gift '{s['de']}' exceeds max_gift_eur")
        for q in quiz["questions"]:
            qid, lid = q["id"], q["leaver"]
            if lid not in quiz.get("leavers", {}):
                err(f"quiz {qid}: leaver {lid} not in leavers")
            if any(s in str(q) for s in secrets):
                err(f"quiz {qid}: contains redaction target")
            if q["type"] == "funny":
                f = fmap.get(q.get("answer_fact"))
                if not f:
                    err(f"quiz {qid}: unknown answer_fact {q.get('answer_fact')}")
                elif lid != f["owner"] and lid not in f.get("also_known_by", []):
                    err(f"quiz {qid}: leaver {lid} does not know {f['id']}")
                if not 0 <= q.get("answer", -1) < len(q.get("options", [])):
                    err(f"quiz {qid}: answer index out of range")
            elif q["type"] == "gap":
                g = gaps_by_id.get(q.get("gap_id"))
                if not g:
                    err(f"quiz {qid}: gap_id {q.get('gap_id')} is not a planted gap")
                elif g["who_to_ask"] != lid:
                    err(f"quiz {qid}: gap {g['id']} should be asked to {g['who_to_ask']}, not {lid}")
            else:
                err(f"quiz {qid}: bad type {q['type']}")

    # every catalogue question must be answered or be a planted gap
    for q in qids:
        if q not in gap_ids and not any(q in f.get("question_ids", []) for f in facts):
            err(f"question {q} has no fact and is not a planted gap")

    if errors:
        print(f"FAILED with {len(errors)} error(s):")
        for e in errors:
            print("  -", e)
        return 1

    print(f"OK  personas={len(personas)} rules={len(rules)} facts={len(facts)} "
          f"questions={len(qids)} gaps={len(gap_ids)}")
    if "--coverage" in sys.argv:
        print("\nFacts per persona (owner / also):")
        for pid, d in personas.items():
            own = sum(1 for f in facts if f["owner"] == pid)
            also = sum(1 for f in facts if pid in f.get("also_known_by", []))
            print(f"  {pid} {d['name']:<22} {d['status']:<7} own={own:<3} also={also}")
        print("\nFacts per category:")
        for c in sorted(CATEGORIES):
            print(f"  {c:<14}{sum(1 for f in facts if f['category'] == c)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
