"""'Who am I' questions are answered from the asker's own directory entry (no LLM)."""

import pytest

from hilde.answer import chitchat
from hilde.loaders import user_from_persona
from hilde.profile import is_identity_question


@pytest.mark.parametrize("q", ["Wie heiße ich?", "wer bin ich", "Was ist mein Name?", "Wie lautet mein Name eigentlich?",
                               "what is my name", "whats my name?", "What's my full name?", "who am i", "Who am I?"])
def test_identity_questions_detected(q):
    assert is_identity_question(q)


@pytest.mark.parametrize("q", ["Wie heißt du?", "Wer ist mein Mentor?", "What is your name?",
                               "Wie heißt die Vorsteherin?", "Was ist mein Raum und wie heiße ich?"])
def test_other_questions_not_detected(q):
    assert not is_identity_question(q)


def test_identity_answer_for_new_hire_de_and_en():
    u = user_from_persona("p13")
    de = chitchat({"question": "Wie heiße ich?", "user": u})["result"]
    en = chitchat({"question": "what is my name", "user": u})["result"]
    assert "Jonas Albers" in de.answer and de.answer.startswith("Du bist")
    assert "Jonas Albers" in en.answer and en.answer.startswith("You're")
    assert de.citations[0].source_id == "p13" and not de.abstained
