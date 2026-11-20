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
- 10 face-down cards: **9 question cards** (gap questions first, colleagues' open questions included, then main
  catalogue questions) and **card 10, the reward card**. Wolfgang picks any card in any order.
- Answers are **audio only**: record in the browser or upload an audio file. With the backend, Whisper transcribes on
  the server (`POST /interview/{sid}/answer-audio`); the audio itself is not kept.
- Taxpayer data is blacked out; statements go into his handover handbook ("Handbuch freigeben" indexes it).
- A statement that contradicts documented knowledge is **ignored silently** (never shown or stored).
- After all 9 cards, **card 10** reveals a voucher based on his own interests (≤ €60, see `data/rewards/rewards.yaml`).

### Wissensbibliothek
Anyone posts what others should know ("Der Drucker im 2. OG ist defekt"), optionally with a file. Finn can answer
from it immediately and cites "Wissensbibliothek · Name". "Erledigt" retires a note (kept as history).

## Demo script (≈ 4 min)
1. **Jonas** → Frag Finn: "Wie läuft die Haushaltsanmeldung?" → *I don't know, forwarded to Wolfgang*. "Wie ist das Budget aufgeteilt?" → blocked by role. "Funktioniert der Drucker im 2. OG?" → answered from the library.
2. **Wolfgang** → Wissensinterview: pick card 01 (Jonas' question), record the answer → handbook notes appear.
3. **Jonas** → ask the budget-request question again → answered, citing Wolfgang.
4. **Wolfgang** → answer the remaining cards → card 10 unlocks → voucher.
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
- Endpoints used: `/ask`, `/learn`, `/interview/start|{sid}|pick|answer-audio|publish`, `/library` (+ `/resolve`), `/ingest`, `/reset-learned`.
