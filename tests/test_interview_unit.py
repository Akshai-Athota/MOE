"""Interviewer logic without LLM/Qdrant."""

from hilde.interview import OpenQuestionIn, details, phrase, plan, relation


def test_plan_order_open_questions_then_gaps_then_catalogue():
    qs = plan("p05", [OpenQuestionIn(id="oq-1", text="Wie läuft die Haushaltsanmeldung?",
                                     asked_by="p13", gap_id="Q34")])
    kinds = [q.kind for q in qs]
    assert kinds[0] == "open_question" and qs[0].demo_answer  # planted live-demo answer attached
    assert kinds.index("gap") < kinds.index("catalogue")
    assert "Q34" not in [q.ref for q in qs if q.kind == "gap"]  # already asked by Finn
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
