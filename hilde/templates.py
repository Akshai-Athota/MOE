"""The hackathon questionnaire ("Das Gedächtnis der Verwaltung", Q01-Q57 + everyday questions G01-G18).

These are the questions new colleagues ask most, so they get special treatment:
* match()   recognises a question as one of the catalogue questions (cheap, no model call)
* sources   the facts linked to that catalogue question are put first in retrieval (see answer.py)
* cache     the finished answer is kept per (question, asker, language) and served instantly
            until knowledge changes: learn / library / interview / ingest / reset call bump().
"""

import re
import threading
from functools import lru_cache

import yaml

from hilde.config import REPO_ROOT

# words that carry no topic ("Wie läuft eigentlich ...?", "Kannst du mir sagen ...")
STOP = set("""
der die das den dem des ein eine einen einem einer und oder wie was wer wo wann warum welche welcher welches
ich du er sie es wir ihr mich mir dich dir mein meine dein deine im in am an auf aus bei mit von vom zu zum zur
für fuer über ueber nach vor bis gibt es hier man muss kann darf soll sollte eigentlich denn noch auch nur schon mal
bitte hallo hi finn q als wenn dass ob nicht kein keine so sich uns euch sind ist hat haben werden wird läuft laeuft
kannst sagen erklären erklaeren weißt weisst the a an is are how what who where when which do does i my you
""".split())


def _norm(s: str) -> str:
    s = s.lower()
    for a, b in (("ä", "ae"), ("ö", "oe"), ("ü", "ue"), ("ß", "ss")):
        s = s.replace(a, b)
    return re.sub(r"[^a-z0-9 ]", " ", s)


def stems(text: str) -> set[str]:
    """Content words, cut to 6 letters so 'Vertretung'/'vertritt'/'Vertreter' meet."""
    folded_stop = {_norm(w).strip() for w in STOP}
    return {w[:6] for w in _norm(text).split() if len(w) > 2 and w not in folded_stop}


@lru_cache
def catalogue() -> list[dict]:
    doc = yaml.safe_load((REPO_ROOT / "data" / "schema" / "questions.yaml").read_text(encoding="utf-8"))
    return [{**q, "_stems": stems(q["de"])} for q in doc["questions"]]


MATCH_MIN = 0.5  # (covered share of the catalogue question's topic words) - 0.5 * (extra words asked)


def match(question: str) -> dict | None:
    """The catalogue question this is (almost) the same as, or None."""
    asked = stems(question)
    if not asked:
        return None
    best, best_score = None, 0.0
    for q in catalogue():
        cq = q["_stems"]
        if not cq:
            continue
        # most of the catalogue question's topic words, and not much else
        covered = len(asked & cq) / len(cq)
        extra = len(asked - cq) / max(1, len(asked))
        score = covered - 0.5 * extra
        if score > best_score:
            best, best_score = q, score
    if best is None or best_score < MATCH_MIN:
        return None
    return {k: v for k, v in best.items() if k != "_stems"}


# ---------------------------------------------------------------- answer cache

_lock = threading.Lock()
_cache: dict[tuple[str, str, str], object] = {}
_version = 0


def version() -> int:
    return _version


def bump() -> None:
    """Knowledge changed: cached answers may be outdated."""
    global _version
    with _lock:
        _version += 1
        _cache.clear()


def get(qid: str, user_id: str, lang: str):
    with _lock:
        return _cache.get((qid, user_id, lang))


def put(qid: str, user_id: str, lang: str, answer, at_version: int) -> None:
    """Store only if nothing changed while the answer was being generated."""
    with _lock:
        if at_version == _version:
            _cache[(qid, user_id, lang)] = answer
