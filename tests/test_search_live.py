"""Live guardrail tests against the real index. Needs Qdrant + Ollama and `python -m hilde.index`.

Skipped automatically when the services are not running.
"""

import pytest

from hilde.loaders import user_from_persona
from hilde.vectorstore import qdrant_status, search

pytestmark = pytest.mark.skipif(
    not qdrant_status().get("points"), reason="Qdrant not running or index empty"
)

RESTRICTED = {"F040", "F057", "F096", "F097"}


def _ids(query, pid, **kw):
    """Fact ids behind the hits: works for the seed index (facts) and the raw index (segments
    carry the ground-truth fact ids of their source from the manifest)."""
    ids = []
    for h in search(query, user_from_persona(pid), k=10, **kw):
        ids += [h.source_id, *h.metadata.get("fact_ids", [])]
    return ids


def test_new_hire_never_gets_restricted_budget():
    ids = _ids("Budgetaufteilung Reserve vertraulich", "p13")
    assert not RESTRICTED & set(ids)


def test_manager_gets_restricted_budget():
    assert "F040" in _ids("Budgetaufteilung Reserve vertraulich", "p01")


def test_current_signing_limit_wins_over_old():
    ids = _ids("Bis zu welchem Betrag darf ich Bescheide selbst zeichnen?", "p13")
    assert "F013" in ids and "F012" not in ids
    assert "F012" in _ids("Bis zu welchem Betrag darf ich Bescheide selbst zeichnen?", "p13",
                          include_history=True)


def test_employee_does_not_see_other_department_process():
    # p07 is an employee in GS; VA-internal process facts must not appear
    for h in search("Zeichnungsrecht Bescheide Abweichungen", user_from_persona("p07"), k=10):
        md = h.metadata
        assert (md["category"] in ("general", "public") or md["department"] in ("GS", "ALL")
                or md["source_type"] == "person"), h.source_id
