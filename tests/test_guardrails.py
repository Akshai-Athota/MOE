"""Unit tests for role filters and loaders (no Qdrant/Ollama needed)."""

from hilde.guardrails import build_filter
from hilde.loaders import all_seed_documents, user_from_persona
from hilde.schemas import User


def _access(f):
    return f.must[0].match.any


def test_manager_sees_restricted_others_not():
    assert "restricted" in _access(build_filter(User(id="p01", role="manager", department="AL")))
    for role in ("employee", "new_hire", "leaver"):
        assert "restricted" not in _access(build_filter(User(id="x", role=role, department="VA")))


def test_superseded_hidden_unless_history():
    u = User(id="p13", role="new_hire", department="VA")
    assert build_filter(u).must_not[0].match.any == ["superseded"]
    assert build_filter(u, include_history=True).must_not == []


def test_employee_limited_to_general_or_own_department():
    f = build_filter(User(id="p07", role="employee", department="GS"))
    keys = {c.key: c.match.any for c in f.must[1].should}
    assert keys["metadata.category"] == ["general", "public"]
    assert keys["metadata.department"] == ["GS", "ALL"]


def test_seed_documents_shape():
    docs = all_seed_documents()
    by_id = {d.metadata["chunk_id"]: d for d in docs}
    assert len(by_id) == len(docs), "chunk ids must be unique"
    assert by_id["F012"].metadata["status"] == "superseded"
    assert by_id["F012"].metadata["superseded_by"] == "F013"
    assert by_id["HV-2019-04"].metadata["superseded_by"] == "HV-2026-07"
    for fid in ("F040", "F057", "F096", "F097"):  # SPEC plants.restricted
        assert by_id[fid].metadata["access"] == "restricted"


def test_persona_roles():
    assert user_from_persona("p13").role == "new_hire"
    assert user_from_persona("p05").role == "leaver"
