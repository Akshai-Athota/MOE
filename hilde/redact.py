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
