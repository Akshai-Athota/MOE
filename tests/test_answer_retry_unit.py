"""Retry on "I don't know" (max. 3, only for office topics) and questionnaire handling, without LLM/Qdrant."""

from hilde import answer, templates
from hilde.config import get_settings


def test_unknown_is_retried_three_times_for_office_questions():
    st = {"question": "Wer prüft Rechnungen?", "relevance": 0.7}
    for attempt in range(get_settings().answer_retries):
        assert answer.after_unknown({**st, "attempt": attempt}) == "retry"
    assert answer.after_unknown({**st, "attempt": get_settings().answer_retries}) == "abstain"


def test_irrelevant_question_is_not_retried():
    assert answer.after_unknown({"question": "Wer gewann die WM 2014?", "relevance": 0.2, "attempt": 0}) == "abstain"


def test_restricted_answer_is_not_retried():
    assert answer.after_unknown({"question": "Budgetaufteilung?", "relevance": 0.9, "attempt": 0,
                                 "restricted_owner": "p06"}) == "abstain"


def test_relevance_uses_best_wording(monkeypatch):
    """A typo scores low; the retry query that spells it out decides."""
    scores = {"where is finanazamt?": 0.38, "Wo ist das Finanzamt?": 0.59}
    monkeypatch.setattr(answer, "relevance", lambda q: scores.get(q, 0.1))
    st = {"question": "where is finanazamt?", "attempt": 0}
    st |= answer.unknown(st)
    assert answer.after_unknown(st) == "retry"  # 0.38: not clearly off-topic yet
    st |= {"attempt": 1, "query": "Wo ist das Finanzamt?"}
    st |= answer.unknown(st)
    assert st["relevance"] == 0.59


def test_retry_broadens_the_query(monkeypatch):
    class FakeLLM:
        def invoke(self, _msgs):
            return type("R", (), {"content": "Rechnungsprüfung sachlich rechnerisch Vier-Augen-Prinzip"})()

    monkeypatch.setattr(answer, "get_llm", lambda: FakeLLM())
    q = "Wer guckt sich eigentlich die Rechnungen an?"
    first = answer.retry({"question": q})
    assert first["attempt"] == 1 and "Vier-Augen" in first["query"]
    second = answer.retry({"question": q, "attempt": 1})
    assert second["attempt"] == 2 and "Rechnungen" in second["query"] and "eigentlich" not in second["query"]
    third = answer.retry({"question": q, "attempt": 2})
    assert third["attempt"] == 3 and len(third["query"]) > len(q)


def test_questionnaire_questions_are_recognised():
    assert templates.match("Wer vertritt mich bei Urlaub oder Krankheit?")["id"] == "Q05"
    assert templates.match("Wie funktioniert das Mitzeichnungsverfahren?")["id"] == "Q11"
    assert templates.match("Welche Software nutze ich täglich?")["id"] == "Q35"
    assert templates.match("Wer hat die Fußball-WM 2014 gewonnen?") is None


def test_template_cache_is_dropped_when_knowledge_changes():
    templates.bump()
    v = templates.version()
    templates.put("Q05", "p13", "de", "cached", v)
    assert templates.get("Q05", "p13", "de") == "cached"
    templates.bump()  # e.g. a new library post or interview answer
    assert templates.get("Q05", "p13", "de") is None
    templates.put("Q05", "p13", "de", "stale", v)  # generated before the change: not stored
    assert templates.get("Q05", "p13", "de") is None


def test_template_question_skips_second_verification():
    class G:
        answerable = True

        def valid_sentences(self, n):
            return [("Vertretung: Julia Nowak.", [1])]

    st = {"question": "Wer vertritt mich?", "generated": G(), "hits": [object()], "template": {"id": "Q05"}}
    assert answer.route_generated(st) == "cite"
    assert answer.route_generated({**st, "template": None}) == "verify"
