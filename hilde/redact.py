"""Redaction before storage (Steuergeheimnis, § 30 AO).

Interviews may mention real taxpayers. Q keeps the know-how and forgets taxpayer data:
everything here runs BEFORE text is embedded or stored.

This module covers structured identifiers with patterns. Part C4 adds Presidio (German NER)
for taxpayer names and company names via `register(...)`.
"""

import re
from collections.abc import Callable

# DE IBAN: DE + 2 check digits + 18 digits, often written in groups of 4
IBAN = re.compile(r"\bDE\d{2}(?:\s?\d{4}){4}\s?\d{2}\b")
# Steuernummer, e.g. 30/215/12345 (Niedersachsen format) and 13-digit federal format
TAX_NUMBER = re.compile(r"\b\d{2,3}/\d{3}/\d{4,5}\b|\b\d{13}\b")
# Steuer-ID: 11 digits
TAX_ID = re.compile(r"\b\d{2}\s?\d{3}\s?\d{3}\s?\d{3}\b")

# Speech recognition writes spoken account numbers as loose digit groups
# ("DE 893700 and 400440532013000"): any run of >= 10 digits is treated as an identifier.
# Phone extensions (302-105), amounts (120.000 €) and dates are shorter or use separators.
LONG_DIGITS = re.compile(r"\b(?:DE\s?)?(?:\d\s?){10,}\b")

PATTERNS: list[tuple[str, re.Pattern]] = [
    ("IBAN", IBAN),
    ("STEUERNUMMER", TAX_NUMBER),
    ("STEUER_ID", TAX_ID),
    ("NUMMER", LONG_DIGITS),
]

# extra redactors (e.g. Presidio NER) registered by Part C: text -> (text, found labels)
_EXTRA: list[Callable[[str], tuple[str, list[str]]]] = []


def register(redactor: Callable[[str], tuple[str, list[str]]]) -> None:
    _EXTRA.append(redactor)


def redact(text: str) -> tuple[str, list[str]]:
    """Return (redacted text, labels of what was removed)."""
    found: list[str] = []
    for label, pattern in PATTERNS:
        text, n = pattern.subn(f"[{label} entfernt]", text)
        found += [label] * n
    for extra in _EXTRA:
        text, more = extra(text)
        found += more
    return text, found


# ---------------------------------------------------------------- names (C4, lightweight)
# Taxpayers appear as "Herr/Frau <Name>" or as companies with a legal form (GmbH, AG, KG ...).
# Colleagues are allowed: every surname and first name from the staff directory is kept.

COMPANY = re.compile(
    r"\b(?:[A-ZÄÖÜ][\wÄÖÜäöüß&.\-]*\s){1,3}(?:GmbH(?:\s?&\s?Co\.?\s?KG)?|AG|KG|OHG|e\.\s?K\.|UG|GbR|mbH)\b"
)
TITLED = re.compile(r"\b(Herrn?|Frau|Familie)\s+((?:[A-ZÄÖÜ][a-zäöüß]+\s){0,2}[A-ZÄÖÜ][a-zäöüß\-]+)")
# "Frau Vorsteherin", "Herr Kollege": titles and roles, not names
ROLE_WORDS = {"Vorsteherin", "Vorsteher", "Kollegin", "Kollege", "Kollegen", "Sachgebietsleiterin",
              "Sachgebietsleiter", "Leiterin", "Leiter", "Präsidentin", "Präsident", "Doktor"}


def _staff_names() -> set[str]:
    from hilde.loaders import load_personas  # local import: avoid a cycle at module load

    names: set[str] = set()
    for p in load_personas().values():
        names.update(w for w in p["name"].replace("Dr. ", "").split() if len(w) > 1)
    return names


def redact_names(text: str, extra: list[str] | None = None) -> tuple[str, list[str]]:
    """Remove taxpayer names/companies; keep colleagues. `extra` = names found by the LLM."""
    staff = _staff_names()
    found: list[str] = []
    text, n = COMPANY.subn("[Unternehmen entfernt]", text)
    found += ["UNTERNEHMEN"] * n

    def titled(m: re.Match) -> str:
        if any(w in staff or w in ROLE_WORDS for w in m.group(2).split()):
            return m.group(0)
        found.append("PERSON")
        return f"{m.group(1)} [Steuerpflichtige:r entfernt]"

    text = TITLED.sub(titled, text)
    for name in sorted({e.strip() for e in (extra or []) if e and e.strip()}, key=len, reverse=True):
        if any(w in staff for w in name.split()) or len(name) < 3:
            continue
        text, n = re.subn(re.escape(name), "[Steuerpflichtige:r entfernt]", text)
        found += ["PERSON"] * n
    return text, found


register(redact_names)
