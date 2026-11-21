""""Who am I?" questions, answered from the asker's own staff-directory entry.

The 7B model refused these too often ("Wie heiße ich?", "who am i", "what is my name" without "?"):
the prompt also tells it never to answer questions about Finn with the asker's data, and these
wordings look similar. They are answered deterministically instead, with the directory as source.
"""

import re

from hilde.loaders import load_company, load_personas
from hilde.schemas import Answer, Citation, User

_IDENTITY = re.compile(
    r"^(?:"
    # tolerant of typical slips: "meine name", "was is mein name", "wie heisst ich"
    r"wie (?:heiße|heisse|heiß|heiss|heißt|heisst) ich|wer bin ich"
    r"|(?:was|wie) (?:ist|is|lautet) (?:denn )?mein(?:e|en|em)? (?:voller |ganzer |vollständiger )?namen?"
    r"|what(?:'s| is|s)? my (?:full )?name|who am i|who i am|tell me my name"
    r")(?: eigentlich| nochmal| again)?$"
)


def _normalize(text: str) -> str:
    text = re.sub(r"[^\wäöüß' ]+", " ", text.lower())
    return re.sub(r"\s+", " ", text).strip()


def is_identity_question(question: str) -> bool:
    return bool(_IDENTITY.match(_normalize(question)))


def identity_answer(question: str, user: User, lang: str = "de") -> Answer:
    p = load_personas()[user.id]
    dept = load_company()["departments"][p["department"]]
    if lang == "en":
        text = (f"You're {p['name']}, {p['role_en']} ({dept['name_en']}). "
                f"Your room is {p['room']}, extension {p['phone_ext']}. [1]")
    else:
        text = (f"Du bist {p['name']}, {p['role_de']} ({dept['name_de']}). "
                f"Dein Raum ist {p['room']}, Durchwahl {p['phone_ext']}. [1]")
    snippet = (f"{p['name']} – {p['role_de']}, {dept['name_de']}. Raum {p['room']}, "
               f"Telefon {p['phone_ext']}, E-Mail {p['email']}.")
    cite = Citation(n=1, source_id=p["id"], source_type="person", citation=f"Personalverzeichnis · {p['name']}",
                    snippet=snippet, status="current", owner=p["id"], modality="person", title=p["name"])
    return Answer(question=question, answer=text, abstained=False, citations=[cite])
