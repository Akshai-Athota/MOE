"""Run demo questions through ask() and print answers + citations.  uv run python scripts/demo_questions.py"""
import sys

from hilde.answer import ask
from hilde.loaders import user_from_persona

QUESTIONS = [
    ("Wo kann ich parken und was kostet das?", "p07"),
    ("Wer vertritt mich, wenn ich krank bin?", "p13"),
    ("Bis zu welchem Betrag darf ich Bescheide selbst zeichnen?", "p13"),
    ("Wie läuft die Haushaltsanmeldung für das nächste Jahr ab?", "p13"),           # planted gap -> p05
    ("Wer vertritt die Datenschutzkoordinatorin?", "p13"),       # planted gap -> p08
    ("Gibt es E-Ladesäulen für Mitarbeitende?", "p07"),           # planted gap -> p05
    ("Wie funktioniert das Mitzeichnungsverfahren?", "p13"),
    ("Wann hat die Kantine geöffnet?", "p07"),                    # planted conflict F080/F081
    ("Wie ist das Budget 2026 aufgeteilt?", "p13"),               # restricted -> must not leak
    ("Wie ist das Wetter morgen?", "p07"),
]

sel = [QUESTIONS[int(i)] for i in sys.argv[1:]] or QUESTIONS
for q, uid in sel:
    a = ask(q, user_from_persona(uid))
    flag = "ABSTAIN" if a.abstained else ("CONFLICT" if a.conflict else "ok")
    print(f"\n### [{uid}] {q}   -> {flag} ({a.seconds}s)\n{a.answer}")
    for c in a.citations:
        print(f"   [{c.n}] {c.citation} ({c.status})")
    for ch in a.changes:
        print(f"   CHANGED [{ch.n}] on {ch.changed_on}, previously {ch.previous_source_id}: {ch.previous_text[:70]}")
    if a.who_to_ask:
        print(f"   ASK -> {a.who_to_ask.id} {a.who_to_ask.name}")
