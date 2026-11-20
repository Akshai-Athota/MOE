"""Full story-card interview with the real LLM + Qdrant (~1-2 min). Skipped when services are down.

Wolfgang picks the canteen card and says the canteen is open until 15:00 on Fridays -> contradicts
the documented hours -> the statement is ignored (not shown, not stored, nothing flagged) ->
publishing creates no conflict. The taxpayer name he mentions is redacted.
"""

import pytest

from hilde import interview
from hilde.llm import ollama_status
from hilde.vectorstore import delete_learned, qdrant_status

pytestmark = pytest.mark.skipif(
    not (ollama_status()["ok"] and qdrant_status().get("points")),
    reason="needs Ollama models + indexed Qdrant",
)


def test_false_statement_is_ignored_and_never_published():
    s = interview.start("p05", [])
    card = next((q.card for q in s.deck if q.ref == "G02"), None)
    if card is None:
        pytest.skip("canteen question not dealt into this deck")
    s = interview.pick(s, card)
    turn = interview.answer(s, "Die Kantine hat freitags von 11:30 bis 15:00 Uhr geöffnet. "
                               "Herr Dieter Konopka hat sich darüber übrigens auch beschwert.")
    try:
        assert "Konopka" not in turn.answer
        assert all(c.state != "WIDERSPRUCH" for c in turn.claims)
        assert turn.ignored >= 1, [(c.text, c.state) for c in turn.claims]
        assert s.current is None and card in s.done
        assert interview.publish(s)["conflicts_flagged"] == 0
    finally:
        delete_learned()
        interview.undo_status_changes()
