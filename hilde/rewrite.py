"""Rewrite the user's question into one clean, standard question before anything else.

"was ist meine name", "wo kann man hier parkn", "wer zeichnet bescheide in die ersten monate"
-> fixed spelling/grammar, same meaning, same language, same persons (ich stays ich, du stays du).
Everything after this step (identity check, search, answer, open questions) uses the clean version,
so typos and broken grammar no longer cost answers.
"""

from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel, ConfigDict, Field

from hilde import language
from hilde.llm import get_llm


def _all_required(schema: dict) -> None:
    schema["required"] = list(schema.get("properties", {}))  # qwen3 skips optional fields


class Rewritten(BaseModel):
    model_config = ConfigDict(json_schema_extra=_all_required)
    question: str = Field(description="die bereinigte Frage")


REWRITE_SYSTEM = """Du bereinigst Fragen von Beschäftigten an Finn, den KI-Assistenten eines Finanzamts.
Korrigiere Rechtschreibung, Tippfehler und Grammatik und formuliere eine klare, vollständige Frage.
Strenge Regeln:
- Bedeutung NICHT ändern, nichts hinzufügen, nichts weglassen, nicht beantworten.
- Sprache beibehalten (Deutsch bleibt Deutsch, Englisch bleibt Englisch).
- Personen beibehalten: "ich/mein" bleibt "ich/mein", "du/dein" bleibt "du/dein".
- Fachbegriffe, Namen, Nummern und Pfade unverändert übernehmen.
- Keine neuen zusammengesetzten Wörter bilden; die Wörter der Frage möglichst behalten.
- Englische Fragen NIE ins Deutsche übersetzen und umgekehrt.
Beispiele:
"was ist meine name" -> "Was ist mein Name?"
"wo kann man hier parkn" -> "Wo kann man hier parken?"
"wan hat kantine auf" -> "Wann hat die Kantine auf?"
"whats my room no" -> "What is my room number?"
"whats the cantine opening time" -> "What are the canteen opening times?"
"""


def rewrite(question: str) -> str:
    """Clean version of `question`; falls back to the original if the model fails or drifts."""
    q = question.strip()
    try:
        out: Rewritten = get_llm().model_copy(update={"temperature": 0.0}).with_structured_output(Rewritten, method="json_schema").invoke(
            [SystemMessage(REWRITE_SYSTEM), HumanMessage(q)])
        clean = out.question.strip().strip('"„“').strip()
    except Exception:  # noqa: BLE001 - never block a question because cleaning failed
        return q
    # a rewrite that is empty, much longer or in another language has drifted: keep the original
    if not clean or len(clean) > 2 * len(q) + 30 or language.detect(clean) != language.detect(q):
        return q
    return clean
