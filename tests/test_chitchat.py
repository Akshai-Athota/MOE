"""Small-talk classifier (regex path only, no LLM calls)."""

import pytest

from hilde.answer import chitchat, route_chitchat
from hilde.chitchat import classify, reply
from hilde.schemas import User


@pytest.mark.parametrize("text,kind", [
    ("how are you", "how_are_you"),
    ("Wie geht's dir?", "how_are_you"),
    ("Hallo Hilde!", "greeting"),
    ("Guten Morgen", "greeting"),
    ("Danke dir", "thanks"),
    ("Tschüss!", "goodbye"),
    ("Wer bist du?", "about_hilde"),
    ("Hallo, wie beantrage ich Urlaub?", "none"),
    ("Wer ist meine Vertretung?", "none"),
    ("", "none"),
])
def test_classify_regex(text, kind):
    assert classify(text, use_llm=False) == kind


def test_reply_uses_first_name():
    assert reply("greeting", "Anna").startswith("Hallo Anna!")
    assert reply("greeting").startswith("Hallo!")


def test_chitchat_node_short_circuits():
    user = User(id="p01", name="Anna Beispiel", role="employee", department="GS")
    out = chitchat({"question": "how are you", "user": user})
    assert not out["result"].abstained and "Anna" in out["result"].answer
    assert route_chitchat({**out}) == "done"


@pytest.mark.parametrize("text,lang", [
    ("how are you", "en"),
    ("Who is my deputy?", "en"),
    ("How do I request holiday leave?", "en"),
    ("Wer ist meine Vertretung?", "de"),
    ("Was ist ELSTER?", "de"),
    ("Wie beantrage ich Urlaub?", "de"),
    ("Elster?", "de"),
])
def test_detect_language(text, lang):
    from hilde.language import detect
    assert detect(text) == lang


def test_chitchat_replies_in_question_language():
    user = User(id="p01", name="Anna Beispiel", role="employee", department="GS")
    en = chitchat({"question": "how are you", "user": user})
    de = chitchat({"question": "Wie geht's dir?", "user": user})
    assert en["lang"] == "en" and en["result"].answer.startswith("I'm doing well")
    assert de["lang"] == "de" and de["result"].answer.startswith("Mir geht's gut")
    assert chitchat({"question": "Who is my deputy?", "user": user}) == {"lang": "en"}
