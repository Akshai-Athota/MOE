"""End-to-end answers with the real LLM (~1 min). Skipped when Ollama/Qdrant are not ready."""

import pytest

from hilde.answer import ask
from hilde.llm import ollama_status
from hilde.loaders import user_from_persona
from hilde.vectorstore import qdrant_status

pytestmark = pytest.mark.skipif(
    not (ollama_status()["ok"] and qdrant_status().get("points")),
    reason="needs Ollama models + indexed Qdrant",
)
RESTRICTED = {"F040", "F057", "F096", "F097"}


def test_signing_limit_is_cited_with_change_history():
    a = ask("Bis zu welchem Betrag darf ich Bescheide selbst zeichnen?", user_from_persona("p13"))
    assert not a.abstained and "10.000" in a.answer
    assert any("F013" in c.source_id or "HV-2026-07" in c.source_id for c in a.citations)
    assert a.changes, "should report the change from 5.000 € (F012)"


def test_planted_gap_abstains_and_names_someone():
    # catalogue wording Q34; the bare "Haushaltsanmeldung" is ambiguous for a 7B model
    a = ask("Wie läuft die Haushaltsanmeldung für das nächste Jahr ab?", user_from_persona("p13"))
    assert a.abstained and a.who_to_ask is not None and a.open_question_id


def test_new_hire_never_gets_restricted_sources():
    a = ask("Wie ist das Budget 2026 im Detail aufgeteilt?", user_from_persona("p13"))
    assert not RESTRICTED & {c.source_id for c in a.citations}


def test_off_topic_is_not_routed_to_a_person():
    a = ask("Wie ist das Wetter morgen?", user_from_persona("p07"))
    assert a.abstained and a.who_to_ask is None
