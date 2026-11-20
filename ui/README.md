# Q – UI

The web app for **Q, das Gedächtnis des Finanzamts**. Built with React + Vite + Tailwind. Brand colour `#573CFA`.

```bash
cd ui
npm install
npm run dev        # builds src/data/dataset.json from ../data (needs python3 + pyyaml), then starts Vite on :5173
npm run build      # production build into ui/dist
```

## Views (by role; switch roles in the bottom-left of the sidebar)

| Role | Persona | Views |
|---|---|---|
| New hire | Finn Albers (p13) | **Mein Start** (30-day path, mentor, required reading, unwritten rules) · **Frag Q** |
| Leaver | Wolfgang Reinecke (p05) | **Wissensinterview** (Q interviews, live redaction, handbook page, questions from colleagues) · **Abschied** · Frag Q |
| Employee | Leyla Demir (p03) | Frag Q (everyday topics + own department) |
| Manager | Petra Schulte (p10) | **Wissenslandkarte** (coverage of all onboarding questions, retirement risk) · **Wissen & Verlauf** (NEW/SAME/UPDATE/CONFLICT, conflicts, live document upload) · Abschied · Frag Q |

## Demo script (≈ 5 min)
1. **Finn** → Frag Q: "Wer zeichnet meine Bescheide…?" (rule changed; shows the history) → "Wann hat die Kantine geöffnet?" (conflict) → "Wie läuft die Haushaltsanmeldung?" (**I don't know + who to ask**, forwarded) → "Wie ist das Budget aufgeteilt?" (**blocked by role**).
2. **Wolfgang** → Wissensinterview: record 2 answers (taxpayer name and IBAN are **redacted live**) → "Jetzt beantworten" on Finn's question → "Demo-Antwort einsprechen" → Speichern.
3. **Finn** → ask the budget question again → answered, **"Neu gelernt"**, cites Wolfgang.
4. **Wolfgang** → Abschied → Quiz starten (party): funny questions with confetti, then a gap question answered live → finale with booklet.
5. **Petra** → Wissen & Verlauf → "Neue Hausverfügung hochladen" (parking €10 → €12 from 01.01.2027) → Frag Q "Wo kann ich parken?" shows the upcoming change → Wissenslandkarte.

Use "Demo zurücksetzen" in the sidebar to restart from scratch. State is kept in localStorage.

## Backend integration (Person B)
`src/lib/engine.ts` is an in-browser mock that runs on the real synthetic dataset.
Replace `ask()` with a call to the RAG API that returns the same `Answer` shape (`src/lib/types.ts`):
`kind` (answer | gap | blocked | conflict), `text`, `facts`, `citations[{factId,label,kind,anchor}]`, `changedFrom`, `upcoming`, `askPerson`, `gapId`.
The role filter must stay **before** retrieval on the server, exactly like `canSee()` here.
