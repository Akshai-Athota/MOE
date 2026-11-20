"""Ask each demo question N times; print how often the outcome matches the expectation."""
import sys
from collections import Counter

from hilde.answer import ask
from hilde.loaders import user_from_persona

CASES = [  # (question, user, expected: answer|abstain|conflict)
    ("Wo kann ich parken und was kostet das?", "p07", "answer"),
    ("Wer vertritt mich, wenn ich krank bin?", "p13", "any"),  # p13 has no deputy yet: both ok
    ("Bis zu welchem Betrag darf ich Bescheide selbst zeichnen?", "p13", "answer"),
    ("Wie läuft die Haushaltsanmeldung für das nächste Jahr ab?", "p13", "abstain"),
    ("Gibt es E-Ladesäulen für Mitarbeitende?", "p07", "abstain"),
    ("Wie funktioniert das Mitzeichnungsverfahren?", "p13", "answer"),
    ("Wann hat die Kantine geöffnet?", "p07", "conflict"),
    ("Wie ist das Wetter morgen?", "p07", "abstain"),
]
n = int(sys.argv[1]) if len(sys.argv) > 1 else 3
total = 0
reasons: Counter = Counter()  # (question, abstain_reason) -> count: which step drops answers
for q, uid, want in CASES:
    got = Counter()
    for _ in range(n):
        a = ask(q, user_from_persona(uid))
        outcome = "abstain" if a.abstained else "conflict" if a.conflict else "answer"
        got[outcome] += 1
        if a.abstained:
            reasons[(q, a.abstain_reason)] += 1
    hit = n if want == "any" else got[want]
    total += hit
    print(f"{hit}/{n}  want={want:<8} {dict(got)}  {q}")
print(f"TOTAL {total}/{n * len(CASES)}")
if reasons:
    print("\nwhy abstained (step that dropped the answer):")
    for (q, r), c in sorted(reasons.items()):
        print(f"  {c}x {r:<20} {q}")
