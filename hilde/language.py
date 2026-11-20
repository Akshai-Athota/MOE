"""Tiny, dependency-free German/English detector for the question language.

Hilde answers in the language of the question. German is the house language and the
default when a message is ambiguous (e.g. "Elster?", "ok").
"""

import re
from typing import Literal

Lang = Literal["de", "en"]

_DE = set("""
ich du er sie es wir ihr mein meine dein deine wer was wie wo wann warum wieso welche welcher welches
ist sind bin bist hat habe hast haben wird werden kann kannst darf darf muss soll gibt geht
der die das den dem des ein eine einen einem einer und oder aber nicht kein keine mit für von zu zum zur
im am auf bei nach über unter vor seit bis auch noch schon heute morgen hallo danke tschüss bitte
""".split())

_EN = set("""
i you he she it we they my your who what how where when why which whose
is are am was were has have had will would can could may must should does do did
the a an and or but not no with for from to at in on by after about since until also still
today tomorrow hello hi thanks thank please bye
""".split())

_WORD = re.compile(r"[a-zäöüß']+")


def detect(text: str) -> Lang:
    t = text.lower()
    if re.search(r"[äöüß]", t):
        return "de"
    words = _WORD.findall(t)
    de = sum(w in _DE for w in words)
    en = sum(w in _EN for w in words)
    return "en" if en > de else "de"


NAMES = {"de": "Deutsch", "en": "Englisch (English)"}
