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

Kind = Literal["greeting", "how_are_you", "thanks", "goodbye", "about_hilde", "none"]

_HELP = "Was kann ich für dich tun?"
_HELP_EN = "What can I do for you?"

REPLIES_EN: dict[str, str] = {
    "greeting": f"Hi{{name}}! Nice to see you. {_HELP_EN}",
    "how_are_you": f"I'm doing well, thanks for asking{{name}}! {_HELP_EN}",
    "thanks": "You're welcome! Just let me know if you need anything else.",
    "goodbye": "Bye{name}, see you soon!",
    "about_hilde": ("I'm Hilde, the AI colleague at the Finanzamt Hildesheim. I answer questions "
                    "about work here and always tell you my sources. " + _HELP_EN),
}

REPLIES: dict[str, str] = {
    "greeting": f"Hallo{{name}}! Schön, dass du da bist. {_HELP}",
    "how_are_you": f"Mir geht's gut, danke der Nachfrage{{name}}! {_HELP}",
    "thanks": "Gern geschehen! Melde dich einfach, wenn du noch etwas brauchst.",
    "goodbye": "Tschüss{name}, bis bald!",
    "about_hilde": ("Ich bin Hilde, die KI-Kollegin des Finanzamts Hildesheim. Ich beantworte "
                    "Fragen rund um die Arbeit hier und nenne dir immer meine Quellen. " + _HELP),
}

# Patterns are anchored to the whole (normalized) message, so "Hallo, wie beantrage ich Urlaub?"
# is NOT small talk and still goes through retrieval.
_PATTERNS: list[tuple[str, re.Pattern]] = [
    ("how_are_you", re.compile(
        r"^(hallo |hi |hey |moin )?(wie geht('?s| es) (dir|ihnen)?|wie läuft('?s| es)|alles (gut|klar)|"
        r"how are you|how('?s| is) it going)( heute)?( hilde)?$")),
    ("greeting", re.compile(
        r"^(hallo|hi|hey|moin( moin)?|servus|guten (morgen|tag|abend)|grüß gott|hello|good morning)( hilde)?$")),
    ("thanks", re.compile(
        r"^(danke|vielen dank|danke schön|dankeschön|super danke|thanks|thank you|thx)( dir)?( hilde)?$")),
    ("goodbye", re.compile(
        r"^(tschüss|tschüs|bye|ciao|auf wiedersehen|bis (bald|später|morgen|dann)|schönen feierabend)( hilde)?$")),
    ("about_hilde", re.compile(
        r"^(wer bist du|was bist du|was kannst du|wie heißt du|who are you|what can you do)$")),
]

MAX_LLM_WORDS = 8  # longer messages are almost always real questions; skip the extra LLM call


class Classified(BaseModel):
    kind: Kind


def _normalize(text: str) -> str:
    text = re.sub(r"[^\wäöüß' ]+", " ", text.lower())
    return re.sub(r"\s+", " ", text).strip()


def classify(question: str, use_llm: bool = True) -> Kind:
    norm = _normalize(question)
    if not norm:
        return "none"
    for kind, pattern in _PATTERNS:
        if pattern.match(norm):
            return kind  # type: ignore[return-value]
    if not use_llm or len(norm.split()) > MAX_LLM_WORDS:
        return "none"
    try:
        out = get_llm().with_structured_output(Classified, method="json_schema").invoke([
            SystemMessage(CHITCHAT_SYSTEM), HumanMessage(question),
        ])
        return out.kind
    except Exception:  # noqa: BLE001 - on failure fall back to the normal QA path
        return "none"


def reply(kind: str, first_name: str = "", lang: str = "de") -> str:
    name = f" {first_name}" if first_name else ""
    return (REPLIES_EN if lang == "en" else REPLIES)[kind].format(name=name)
