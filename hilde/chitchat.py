"""Small-talk detection so greetings, thanks etc. get a friendly reply instead of an abstain.

Two stages:
* regex fast path for obvious cases (no LLM call, no latency);
* LLM classifier only for short messages the regex did not catch.

Replies are fixed templates in German or English (language of the message). They state no facts about the Finanzamt, so the
"facts only from facts.yaml" rule still holds.
"""

import re
from typing import Literal

from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel

from hilde.llm import get_llm
from hilde.prompts import CHITCHAT_SYSTEM

Kind = Literal["greeting", "how_are_you", "thanks", "goodbye", "about_hilde", "where_are_you", "none"]

_HELP = "Was kann ich für dich tun?"
_HELP_EN = "What can I do for you?"

REPLIES_EN: dict[str, str] = {
    "greeting": f"Hi! Nice to see you. {_HELP_EN}",
    "how_are_you": f"I'm doing well, thanks for asking! {_HELP_EN}",
    "thanks": "You're welcome! Just let me know if you need anything else.",
    "goodbye": "Bye, see you soon!",
    "where_are_you": ("I'm an AI, so I don't have a room or a desk – I'm right here in the chat, "
                      "any time. " + _HELP_EN),
    "about_hilde": ("I'm Q, the AI colleague at the Finanzamt Hildesheim. I answer questions "
                    "about work here and always tell you my sources. " + _HELP_EN),
}

REPLIES: dict[str, str] = {
    "greeting": f"Hallo! Schön, dass du da bist. {_HELP}",
    "how_are_you": f"Mir geht's gut, danke der Nachfrage! {_HELP}",
    "thanks": "Gern geschehen! Melde dich einfach, wenn du noch etwas brauchst.",
    "goodbye": "Tschüss, bis bald!",
    "where_are_you": ("Ich bin eine KI und habe kein Büro und keinen Schreibtisch – du findest mich "
                      "jederzeit hier im Chat. " + _HELP),
    "about_hilde": ("Ich bin Q, die KI-Kollegin des Finanzamts Hildesheim. Ich beantworte "
                    "Fragen rund um die Arbeit hier und nenne dir immer meine Quellen. " + _HELP),
}

# Patterns are anchored to the whole (normalized) message, so "Hallo, wie beantrage ich Urlaub?"
# is NOT small talk and still goes through retrieval.
_PATTERNS: list[tuple[str, re.Pattern]] = [
    ("how_are_you", re.compile(
        r"^(hallo |hi |hey |moin )?(wie geht('?s| es) (dir|ihnen)?|wie läuft('?s| es)|alles (gut|klar)|"
        r"how are you|how('?s| is) it going)( heute)?( q)?$")),
    ("greeting", re.compile(
        r"^(hallo|hi|hey|moin( moin)?|servus|guten (morgen|tag|abend)|grüß gott|hello|good morning)( q)?$")),
    ("thanks", re.compile(
        r"^(danke|vielen dank|danke schön|dankeschön|super danke|thanks|thank you|thx)( dir)?( q)?$")),
    ("goodbye", re.compile(
        r"^(tschüss|tschüs|bye|ciao|auf wiedersehen|bis (bald|später|morgen|dann)|schönen feierabend)( q)?$")),
    ("where_are_you", re.compile(
        r"^(q )?(wo bist du|wo (sitzt|wohnst|steckst) du|wo finde ich dich|where are you|"
        r"where do you (sit|live|work)|where can i find you)( q| gerade| right now)?$")),
    ("about_hilde", re.compile(
        r"^(wer bist du|was bist du|was kannst du|wie heißt du|bist du (ein mensch|eine ki|ein bot)|"
        r"who are you|what are you|what can you do|what('?s| is) your name|"
        r"are you (a human|an ai|a bot|real))( q)?$")),
]

# Questions about Q's own whereabouts/contact details, tolerant of grammar and typos
# ("wo bist deine büro?", "what's your phone number"). Searched anywhere in the message, but only
# used when the message has no first-person word, so "Wo ist mein Büro?" stays a real question.
_SELF_LOCATION = re.compile(
    r"\b(dein|deine|deinen|deinem|deiner|your)\b.*\b(büro|raum|zimmer|schreibtisch|arbeitsplatz|platz|"
    r"telefon\w*|durchwahl|nummer|e ?mail|adresse|office|room|desk|phone|extension|number|address)\b"
    r"|\bwo (bist|sitzt|arbeitest|wohnst|steckst) du\b|\bwhere (are|do) you\b"
)
_FIRST_PERSON = re.compile(r"\b(ich|mein\w*|mich|mir|i|my|me|mine)\b")

MAX_LLM_WORDS = 8  # longer messages are almost always real questions; skip the extra LLM call


class Classified(BaseModel):
    kind: Kind


def _normalize(text: str) -> str:
    text = re.sub(r"[^\wäöüß' ]+", " ", text.lower())
    return re.sub(r"\s+", " ", text).strip()


# Words after a greeting that address a group, not a person ("Hallo zusammen", "hi there").
_NOT_A_NAME = {"zusammen", "alle", "leute", "team", "du", "dir", "there", "all", "everyone",
               "everybody", "guys", "folks", "you", "again", "nochmal", "wieder"}

_WRONG_NAME = {
    "de": " Ich bin übrigens Q, nicht {name}.",
    "en": " By the way, I'm Q, not {name}.",
}


def _match(norm: str) -> str | None:
    for kind, pattern in _PATTERNS:
        if pattern.match(norm):
            return kind
    return None


def addressed_as(question: str) -> str | None:
    """Name the small talk addresses Q by, if it is not 'Q' ("hello julia" -> "Julia")."""
    words = _normalize(question).split()
    if len(words) < 2 or words[-1] in _NOT_A_NAME or words[-1] == "q":
        return None
    if _match(" ".join(words)) is None and _match(" ".join(words[:-1])) is not None:
        return words[-1].capitalize()
    return None


def classify(question: str, use_llm: bool = True) -> Kind:
    norm = _normalize(question)
    if not norm:
        return "none"
    kind = _match(norm)
    if kind is None and addressed_as(question):  # "hello julia": small talk + another name
        kind = _match(" ".join(norm.split()[:-1]))
    if kind:
        return kind  # type: ignore[return-value]
    if _SELF_LOCATION.search(norm) and not _FIRST_PERSON.search(norm):
        return "where_are_you"
    if not use_llm or len(norm.split()) > MAX_LLM_WORDS:
        return "none"
    try:
        out = get_llm().with_structured_output(Classified, method="json_schema").invoke([
            SystemMessage(CHITCHAT_SYSTEM), HumanMessage(question),
        ])
        return out.kind
    except Exception:  # noqa: BLE001 - on failure fall back to the normal QA path
        return "none"


def speaks_about_itself(sentences: list[str]) -> bool:
    """True if an answer talks about Q in the first person ("Mein Büro ist ...").

    Sources never describe Q, so such a sentence is the asker's own data (source [1])
    misattributed to Q. Used as a deterministic backstop after generation.
    """
    return any(_FIRST_PERSON.search(_normalize(s)) for s in sentences)


def reply(kind: str, lang: str = "de", wrong_name: str | None = None) -> str:
    """Fixed reply. Never uses the asker's name; corrects Q being called by another name."""
    text = (REPLIES_EN if lang == "en" else REPLIES)[kind]
    if wrong_name:
        first, _, rest = text.partition("! ")
        if rest:  # "Hi!" + " By the way, I'm Q, not Julia." + " Nice to see you ..."
            return f"{first}!{_WRONG_NAME[lang].format(name=wrong_name)} {rest}"
        return text + _WRONG_NAME[lang].format(name=wrong_name)
    return text
