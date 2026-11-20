"""Full interview loop with the real LLM + Qdrant (~1-2 min). Skipped when services are down.

Wolfgang says the canteen is closed on Fridays -> contradicts the intranet -> publish ->
an employee asking about the canteen now gets a flagged conflict -> demo reset restores it.
"""

import pytest

from hilde import interview
from hilde.answer import ask
from hilde.llm import ollama_status
from hilde.loaders import user_from_persona
from hilde.vectorstore import delete_learned, qdrant_status

pytestmark = pytest.mark.skipif(
    not (ollama_status()["ok"] and qdrant_status().get("points")),
    reason="needs Ollama models + indexed Qdrant",
)


def test_interview_contradiction_reaches_answers_and_is_undone():
    s = interview.start("p05", [])
    canteen = next(q for q in s.queue if q.ref == "G02")
    s = interview.focus(s, canteen)
    turn = interview.answer(s, "Die Kantine hat seit dem Pächterwechsel nur Montag bis Donnerstag "
                               "von 11:30 bis 13:30 Uhr geöffnet, freitags ist zu. Herr Dieter Konopka "
                               "hat sich darüber übrigens auch beschwert.")
    try:
        assert "Konopka" not in turn.answer
        states = {c.state for c in turn.claims}
        assert "WIDERSPRUCH" in states, [(c.text, c.state, c.reason) for c in turn.claims]
        assert interview.publish(s)["conflicts_flagged"] >= 1
        a = ask("Wann hat die Kantine geöffnet?", user_from_persona("p07"))
        assert a.conflict and not a.abstained
    finally:
        delete_learned()
        interview.undo_status_changes()
