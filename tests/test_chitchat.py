"""Small-talk classifier (regex path only, no LLM calls)."""

import pytest

from hilde.answer import chitchat, route_chitchat
from hilde.chitchat import classify, reply
from hilde.schemas import User


@pytest.mark.parametrize("text,kind", [
    ("how are you", "how_are_you"),
    ("Wie geht's dir?", "how_are_you"),
    ("Hallo Q!", "greeting"),
    ("Guten Morgen", "greeting"),
    ("Danke dir", "thanks"),
    ("Tschüss!", "goodbye"),
    ("Wer bist du?", "about_hilde"),
    ("where are you?", "where_are_you"),
    ("wo bist du?", "where_are_you"),
    ("Are you a bot?", "about_hilde"),
    ("Wo ist mein Büro?", "none"),
    ("wo bist deine büro?", "where_are_you"),
    ("Was ist deine Telefonnummer?", "where_are_you"),
    ("what's your phone number", "where_are_you"),
    ("Kannst du mir sagen, wo mein Büro ist?", "none"),
    ("Wo sitzt Herr Reinecke?", "none"),
    ("Hallo, wie beantrage ich Urlaub?", "none"),
    ("Wer ist meine Vertretung?", "none"),
    ("", "none"),
])
def test_classify_regex(text, kind):
    assert classify(text, use_llm=False) == kind


def test_reply_never_uses_asker_name():
    assert reply("greeting") == "Hallo! Schön, dass du da bist. Was kann ich für dich tun?"
    assert reply("greeting", "en") == "Hi! Nice to see you. What can I do for you?"


@pytest.mark.parametrize("text,name", [
    ("hello julia", "Julia"),
    ("Guten Morgen Peter!", "Peter"),
    ("danke julia", "Julia"),
    ("hello q", None),
    ("Hallo zusammen", None),
    ("hi there", None),
    ("hello", None),
    ("Hallo, wie beantrage ich Urlaub?", None),
])
def test_addressed_as(text, name):
    from hilde.chitchat import addressed_as
    assert addressed_as(text) == name


def test_wrong_name_is_corrected():
    assert classify("hello julia", use_llm=False) == "greeting"
    assert reply("greeting", "en", wrong_name="Julia") == (
        "Hi! By the way, I'm Q, not Julia. Nice to see you. What can I do for you?")
    assert reply("thanks", "de", wrong_name="Julia") == (
        "Gern geschehen! Ich bin übrigens Q, nicht Julia. Melde dich einfach, wenn du noch etwas brauchst.")


def test_chitchat_node_short_circuits():
    user = User(id="p01", name="Anna Beispiel", role="employee", department="GS")
    out = chitchat({"question": "how are you", "user": user})
    assert not out["result"].abstained and "Anna" not in out["result"].answer
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


def test_first_person_answer_is_caught():
    from hilde.answer import Generated, Sentence, route_generated
    from tests.test_answer_unit import _hit
    hits = [_hit("p01")]
    bad = Generated(answerable=True, sentences=[Sentence(text="Mein Büro befindet sich in Raum 2.04.", sources=[1])])
    ok = Generated(answerable=True, sentences=[Sentence(text="Dein Büro ist Raum 2.04.", sources=[1])])
    q = "Wo ist dein Büro?"
    assert route_generated({"question": q, "hits": hits, "generated": bad}) == "self"
    assert route_generated({"question": q, "hits": hits, "generated": ok}) == "verify"
    # a learned interview answer is first person, but the question is not about Q
    learned = Generated(answerable=True, sentences=[Sentence(text="Ich prüfe und kürze die Anmeldung.", sources=[1])])
    assert route_generated({"question": "Wie läuft die Haushaltsanmeldung?", "hits": hits,
                            "generated": learned}) == "verify"
