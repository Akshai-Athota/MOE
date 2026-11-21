# Finn – UI

The web app for **Finn, dein Finanzamt-Assistent**. React + Vite + Tailwind, Inter, one deep-green accent (`#0F5E54`).

```bash
cd ui
npm install
npm run dev        # builds src/data/dataset.json from ../data (needs python3 + pyyaml), then starts Vite on :5173
npm run build      # production build into ui/dist
```

## Users and views (switch users bottom-left)

| User | Views |
|---|---|
| **Jonas Albers** (p13, new hire) | **Mein Start** (first 30 days, contacts, required reading, his open questions) · **Frag Finn** · **Wissensbibliothek** |
| **Wolfgang Reinecke** (p05, retiring) | **Wissensinterview** (story cards) · **Frag Finn** · **Wissensbibliothek** |

### Wissensinterview: story cards
- 6–9 face-down cards (random, no tags): gap questions first, then main questionnaire questions. Pick any card.
- Answer by **typing** (Enter sends) or **audio** (record or upload). The next card opens immediately; transcription
  and structuring run in the background (spinner on the card, notes appear in the handbook when ready).
- Taxpayer data is blacked out; a statement that contradicts documented knowledge is **ignored silently**.
- When all cards are answered the game ends and a **secret last card** reveals a voucher from his own interests.
- Notes go into Finn's knowledge automatically – there is no "publish" button any more.

### Wissensbibliothek
Anyone posts what others should know ("Der Drucker im 2. OG ist defekt"), optionally with a file. Finn can answer
from it immediately and cites "Wissensbibliothek · Name". "Erledigt" retires a note (kept as history).

## Demo script (≈ 4 min)
1. **Jonas** → Frag Finn: "Wie läuft die Haushaltsanmeldung?" → *I don't know, forwarded to Wolfgang*. "Wie ist das Budget aufgeteilt?" → blocked by role. "Funktioniert der Drucker im 2. OG?" → answered from the library.
2. **Wolfgang** → Wissensinterview: draw a card, type or record the answer → the next card opens at once.
3. **Jonas** → ask the budget-request question again → answered, citing Wolfgang.
4. **Wolfgang** → answer the remaining cards → the secret last card appears → voucher.
5. **Anyone** → Wissensbibliothek: post a note → ask Finn about it.

"Zurücksetzen" in the sidebar restarts the demo (and calls `POST /reset-learned` on the backend).

## Backend connection
The app uses Finn's RAG backend when reachable (sidebar: **Verbunden**), otherwise an in-browser engine on the
synthetic dataset (**Demo-Modus**; audio is transcribed by the browser's speech recognition, uploads use the
prepared demo answer). The status is re-checked every 30 s.

```bash
# from the repo root: Qdrant + index + API
docker compose up -d qdrant
uv run python -m hilde.index --recreate --raw     # once
uv run uvicorn hilde.api.main:app --reload --port 8000
cd ui && npm install && npm run dev               # http://localhost:5173
```

- `vite.config.ts` proxies `/api/*` to `http://localhost:8000` (override with `Q_API_URL`).
- Endpoints used: `/ask`, `/learn`, `/interview/start|{sid}|submit|submit-audio`, `/library` (+ `/resolve`), `/ingest`, `/reset-learned`.
