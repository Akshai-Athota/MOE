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
answered: list[tuple[str, str, list[str]]] = []  # answers to abstain/any questions
details: list[tuple[str, str, str]] = []  # per abstain: what the failing step saw


def _detail(a) -> str:
    v, g = a.debug.get("verdict") or {}, a.debug.get("generated") or {}
    if a.abstain_reason == "verify_rejected":
        return (f"answers_question={v.get('answers_question')} "
                f"supported_by_sources={v.get('supported_by_sources')}\n"
                f"      question_meaning: {v.get('question_meaning')}\n"
                f"      source_meaning:   {v.get('source_meaning')}\n"
                f"      answer: {' '.join(x['text'] for x in g.get('sentences', []))}")
    if a.abstain_reason in ("no_valid_citations", "model_unanswerable", "key_term_missing"):
        return f"generated: {g}"
    return ""


reasons: Counter = Counter()  # (question, abstain_reason) -> count: which step drops answers
for q, uid, want in CASES:
    got = Counter()
    for _ in range(n):
        a = ask(q, user_from_persona(uid))
        outcome = "abstain" if a.abstained else "conflict" if a.conflict else "answer"
        got[outcome] += 1
        if want in ("any", "abstain") and not a.abstained:
            # an answer where none (or either) is expected: show what was said and from where
            answered.append((q, a.answer, [c.source_id for c in a.citations]))
        if a.abstained:
            reasons[(q, a.abstain_reason)] += 1
            details.append((q, a.abstain_reason, _detail(a)))
    hit = n if want == "any" else got[want]
    total += hit
    print(f"{hit}/{n}  want={want:<8} {dict(got)}  {q}")
print(f"TOTAL {total}/{n * len(CASES)}")
if reasons:
    print("\nwhy abstained (step that dropped the answer):")
    for (q, r), c in sorted(reasons.items()):
        print(f"  {c}x {r:<20} {q}")

if details:
    print("\ndetails per abstain:")
    for q, r, d in details:
        if d:
            print(f"  [{r}] {q}\n      {d}")

if answered:
    print("\nanswers where an abstain was expected or allowed (check they are correct):")
    for q, text, cited in dict.fromkeys((q, t, tuple(c)) for q, t, c in answered):
        n = sum(1 for x in answered if x[0] == q and x[1] == text)
        print(f"  {n}x {q}\n      {text}\n      cited: {', '.join(cited)}")
