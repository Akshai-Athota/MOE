"""Interviewer logic without LLM/Qdrant."""

import pytest

from hilde import interview
from hilde.interview import Claim, OpenQuestionIn, Session, Turn, deal, details, phrase, plan, relation


def test_plan_order_open_questions_then_gaps_then_catalogue():
    qs = plan("p05", [OpenQuestionIn(id="oq-1", text="Wie läuft die Haushaltsanmeldung?",
                                     asked_by="p13", gap_id="Q34")])
    kinds = [q.kind for q in qs]
    assert kinds[0] == "open_question" and qs[0].demo_answer  # planted live-demo answer attached
    assert kinds.index("gap") < kinds.index("catalogue")
    assert "Q34" not in [q.ref for q in qs if q.kind == "gap"]  # already asked by Jonas
    # a contradiction (canteen) is asked early: the person can clarify it before leaving
    assert [q.ref for q in qs if q.kind == "catalogue"].index("G02") <= 2


def test_redaction_target_in_first_catalogue_demo_answer():
    qs = plan("p05", [])
    first = next(q for q in qs if q.kind == "catalogue")
    assert "DE89" in first.demo_answer or "Konopka" in first.demo_answer


def test_phrase_without_llm_and_for_colleague_question():
    q = plan("p05", [OpenQuestionIn(id="x", text="Gibt es Ladesäulen?", asked_by="p04")])[0]
    assert phrase(q, "p05").text.startswith("Tobias hat gefragt")


def test_relation_rules():
    canteen_new = "Die Kantine hat nur Montag bis Donnerstag von 11:30 bis 13:30 geöffnet."
    canteen_old = "Die Kantine hat Montag bis Freitag von 11:30 bis 14:00 Uhr geöffnet."
    assert relation(canteen_new, canteen_old)[0] == "WIDERSPRUCH"
    assert relation("Parken kostet 12 €.", "Das Entgelt beträgt 10 € im Monat.")[0] == "WIDERSPRUCH"
    assert relation("Ab 1. Dezember Bestellstopp, Meldung bis 15. November.",
                    "Ab dem 1. Dezember keine Bestellungen.")[0] == "AKTUALISIERT"
    assert relation("Erst mündlich, dann Mail.", "Erst mündlich mit der SGL, dann Mail, dann Mitzeichnung.")[0] == "BESTÄTIGT"


def test_details_normalises_times():
    assert details("von 11.30 bis 14:00 Uhr")["Zeit"] == {"11:30", "14:00"}


def test_dates_are_not_times():
    assert details("Stand: 01.01.2022, geöffnet 11:30 bis 14.00 Uhr")["Zeit"] == {"11:30", "14:00"}


# ---------------------------------------------------------------- story cards

def _session(pid="p05"):
    return Session(id="t", persona=pid, created="2026-11-20T10:00:00",
                   deck=deal(pid, [OpenQuestionIn(id="oq-1", text="Wie läuft die Haushaltsanmeldung?",
                                                  asked_by="p13", gap_id="Q34")], seed=1))


def test_deck_has_6_to_9_numbered_gap_and_main_cards():
    sizes = set()
    for seed in range(12):
        deck = deal("p05", [OpenQuestionIn(id="oq-1", text="Wie läuft die Haushaltsanmeldung?",
                                           asked_by="p13", gap_id="Q34")], seed=seed)
        assert 6 <= len(deck) <= 9  # random, always fewer than 10
        assert [q.card for q in deck] == list(range(1, len(deck) + 1))
        assert {q.kind for q in deck} <= {"open_question", "gap", "catalogue"}
        assert deck[0].kind == "open_question" and "catalogue" in [q.kind for q in deck]
        sizes.add(len(deck))
    assert len(sizes) > 1  # the number really varies


def test_reward_card_unlocks_only_after_all_cards(monkeypatch):
    monkeypatch.setattr(interview, "save", lambda s: None)
    s = _session()
    r = interview.reward(s)
    assert not r["unlocked"] and r["voucher"] is None and r["remaining"] == len(s.deck)
    s.done = [q.card for q in s.deck]
    r = interview.reward(s)
    assert r["unlocked"] and r["voucher"]["based_on"] == "Wandern im Harz"
    assert r["voucher"]["est_eur"] <= r["voucher"]["max_eur"]


def test_pick_sets_current_and_rejects_done_cards(monkeypatch):
    monkeypatch.setattr(interview, "save", lambda s: None)
    s = _session()
    interview.pick(s, 2, use_llm=False)
    assert s.current and s.current.card == 2
    s.done.append(3)
    with pytest.raises(ValueError):
        interview.pick(s, 3, use_llm=False)


def test_false_statements_are_ignored_and_no_follow_up(monkeypatch):
    """A statement that contradicts known facts is dropped; the card is done; nothing is asked next."""
    monkeypatch.setattr(interview, "save", lambda s: None)
    learned = []
    monkeypatch.setattr(interview, "learn", lambda req: learned.append(req.text))

    class FakeLLM:
        def with_structured_output(self, *a, **k):
            return self

        def invoke(self, _msgs):
            return interview.Extracted(claims=[
                interview.XClaim(section="Ungeschriebene Regeln", text="Die Kantine hat freitags bis 15:00 Uhr geöffnet."),
                interview.XClaim(section="Prozesse & Freigaben", text="Krüger sammelt den Bedarf bis 15. März."),
            ], taxpayer_names=[], follow_up="Und wer prüft das?")

    monkeypatch.setattr(interview, "get_llm", lambda: FakeLLM())

    def fake_compare(claims, pid):
        claims[0].state = "WIDERSPRUCH"  # contradicts the documented canteen hours

    monkeypatch.setattr(interview, "_compare", fake_compare)
    s = _session()
    interview.pick(s, 1, use_llm=False)  # card 1 = Jonas' open question
    turn = interview.answer(s, "Die Kantine hat freitags bis 15 Uhr auf. Krüger sammelt den Bedarf bis 15. März.")
    assert [c.text for c in turn.claims] == ["Krüger sammelt den Bedarf bis 15. März."]
    assert turn.ignored == 1
    assert learned == ["Krüger sammelt den Bedarf bis 15. März."]  # the false part is never stored
    assert s.current is None and 1 in s.done  # no follow-up; the person picks the next card
    assert all(isinstance(c, Claim) for c in turn.claims)


def test_submit_is_instant_and_processing_runs_later(tmp_path, monkeypatch):
    """The card is done the moment the answer is submitted; the result arrives in the background."""
    monkeypatch.setattr(interview, "DIR", tmp_path)
    s = _session()
    s.id = "bg"
    interview.save(s)
    monkeypatch.setattr(interview, "extract_turn", lambda pid, q, text, n: Turn(
        n=n, question=q, answer=text, claims=[Claim(id=f"{q.card}.1", section="Sonstiges", text=text)],
        at="2026-11-20T10:00:00"))
    monkeypatch.setattr(interview, "publish_turn", lambda s, t: len(t.claims))

    after = interview.submit("bg", 2)
    assert 2 in after.done and after.pending == [2] and not after.turns
    interview.process("bg", 2, text="Die Mitzeichnungsfrist beträgt drei Arbeitstage.")
    s = interview.load("bg")
    assert s.pending == [] and len(s.turns) == 1 and s.turns[0].question.card == 2
    assert s.published_claims == ["2.1"]  # indexed automatically, no publish button


def test_failed_processing_puts_the_card_back(tmp_path, monkeypatch):
    monkeypatch.setattr(interview, "DIR", tmp_path)
    s = _session()
    s.id = "bg2"
    interview.save(s)
    interview.submit("bg2", 3)
    interview.process("bg2", 3, text="")  # nothing recognised
    s = interview.load("bg2")
    assert 3 not in s.done and s.failed == [3] and s.pending == []
    assert 3 in interview.submit("bg2", 3).done  # can be answered again
