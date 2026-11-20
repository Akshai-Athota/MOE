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

## Backend (RAG) connection
The chat uses Q's RAG backend when it is reachable (badge **"Live · RAG-Backend"** in Frag Q), otherwise the
in-browser demo engine (`src/lib/engine.ts`, badge **"Demo-Modus"**). The status is re-checked every 30 s.

```bash
# from the repo root: Qdrant + index + API
docker compose up -d qdrant
uv run python -m hilde.index --recreate --raw     # once
uv run uvicorn hilde.api.main:app --reload --port 8000
# then the UI
cd ui && npm install && npm run dev               # http://localhost:5173
```

- `vite.config.ts` proxies `/api/*` to `http://localhost:8000` (override with `Q_API_URL`); `VITE_API_BASE` changes the path.
- `src/lib/api.ts` maps the backend answer to the UI `Answer` shape: citations → source chips (timestamp,
  paragraph or section), `changes` → "Geändert am …", `blocked` → role block, abstain + `who_to_ask` → knowledge gap.
  Planted demo gaps keep their `gapId` (from the local engine) so the interview loop can close them.
- `learn()` (interview, quiz, document upload) also calls `POST /learn`: the backend redacts and indexes it at once;
  a future `valid_from` is stored as *scheduled* and is not an answer before that day.
- **Wissensinterview (leaver)**: with the backend live, `LiveInterviewView.tsx` runs the real AI interviewer
  (`hilde/interview.py`, endpoints `/interview/*`): Q plans the questions (colleagues' open questions → gaps only
  this person can close → topics where they are the only source; contradictions early), phrases them in the
  person's interview style, redacts each answer on the server (IBAN, tax numbers, taxpayer names/companies;
  colleagues are kept), extracts handbook statements and compares them with existing knowledge
  (NEU / BESTÄTIGT / AKTUALISIERT / WIDERSPRUCH, e.g. "andere Zeit: 13:30 statt 14:00"), and asks a follow-up when
  a detail is missing. Answers to colleagues' questions are searchable at once; the handbook page is indexed on
  "Prüfen & freigeben", and a WIDERSPRUCH marks both sources as conflict (Frag Q then shows both).
  Offline, the scripted demo interview is shown instead. "Demo-Antwort einsprechen" fills in a planted answer.
- "Demo zurücksetzen" also calls `POST /reset-learned` (forgets knowledge learned in the app, restores sources
  an interview marked as conflict).
- Answers from the local LLM take ~10–30 s on a laptop GPU; the chat shows "Q durchsucht die Quellen …".
- The role filter runs on the server **before** retrieval. The backend only reveals *that* restricted content
  exists and who owns it, never the content.
- `npm run dev` builds the dataset with `scripts/run_python.mjs`, which finds `uv`, `python3`, `python` or `py` (Windows-safe).
