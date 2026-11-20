# SPEC: Hilde, the memory of Finanzamt Hildesheim

**Read this file before editing anything.** It is the contract between data (A), the AI pipeline (B) and the app (C).

> **Synthetic data disclaimer.** The office's name, address, phone number and tax office number are public facts.
> Everything else is **fictional**: all people, internal rules, figures, projects, rooms, phone extensions and taxpayers.
> It was invented for a hackathon. Do not present it as how the real authority works.

## 1. The product in one sentence
Hilde is an AI colleague that never retires. It interviews employees who are leaving, guides new hires through onboarding,
answers everyday questions from all staff (parking, canteen, leave and so on), and keeps its knowledge current
(new, same, update, conflict) with a citation for every answer and role-based guardrails.

## 2. Folder ownership (one owner per folder → no merge conflicts)

| Folder | Owner | Contents |
|---|---|---|
| `SPEC.md`, `CLAUDE.md` | everyone (change only in a small PR announced to the team) | contract |
| `data/company/` | A | `company.yaml`: real public facts, departments, building, systems |
| `data/personas/` | A | `pNN.yaml`: one file per person |
| `data/rules/` | A | `rules.yaml`: internal orders (Hausverfügungen), including superseded versions |
| `data/facts/` | A | `facts.yaml`: **single source of truth**, plus planted cases |
| `data/schema/` | A | `questions.yaml`: onboarding and general question catalogue |
| `generators/` | B (text), C (media) | scripts that read the YAML and write to `data/raw/` |
| `generators/validate.py` | A creates, B extends | consistency checks; **run before every push** |
| `data/raw/` | generated | `docs/ audio/ images/ video/`; the output of generators |
| `data/manifest.jsonl` | C (builder) | one line per generated file |
| `eval/` | B | `qa.yaml`, derived from `facts.question_ids` + `planted_gaps` |

## 3. IDs

| Thing | Format | Example |
|---|---|---|
| Person | `pNN` | `p05` |
| Department | 2 letters | `AL`, `RB`, `GS`, `VA` |
| Fact | `F###` | `F042` |
| Rule | `HV-YYYY-NN` | `HV-2026-07` |
| Project | `PR#` | `PR1` |
| Question | `Q##` (onboarding), `G##` (general staff) | `Q14`, `G03` |
| Generated file | `<modality>_<persona>_<slug>` | `audio_p05_handover_interview.mp3` |

## 4. Enums

- **department**: `AL` Amtsleitung (head of office) · `RB` Rechtsbehelfsstelle (appeals office) · `GS` Geschäftsstelle & Servicestelle (central services and front desk) · `VA` Veranlagung / Arbeitnehmerbereich (tax assessment of employees) · `ALL`
- **category** (from the onboarding PDF, adapted for a Finanzamt, plus 2 general categories):
  `org` · `process` · `project` · `program` (Land programmes with reporting duties, the Finanzamt equivalent of "funded projects") ·
  `finance` · `it` · `oversight` (the PDF's "political level": LStN, ministry, Personalrat) · `communication` · `practical` ·
  `general` (everyday staff questions) · `public` (what any citizen could know)
- **access** (enforced in retrieval, **never** only in the prompt):
  - `public`: everyone, including citizens
  - `internal`: all employees
  - `restricted`: managers only (`p01`, `p02`, `p05`, `p10`)
- **user roles** in the app → visible access levels:
  - `employee` → public, internal (categories `general`, `public` + department handbooks of their own department)
  - `new_hire` → public, internal (all categories, onboarding path)
  - `leaver` → public, internal + interview mode + their own draft pages
  - `manager` → public, internal, restricted + coverage dashboard + conflict approval
- **fact status**: `current` · `superseded` · `conflict`
- **plant** (deliberate test cases): `superseded` · `conflict` · `restricted` · `redaction` · `null`
- **modality** (`sources_planned`): `interview` (audio) · `doc` (PDF/DOCX) · `email` · `minutes` · `image` · `video` · `intranet`

## 5. Schemas

### Fact (`data/facts/facts.yaml` → `facts:`)
```yaml
- id: F042
  category: process
  topic: Zeichnungsrecht Sachbearbeiter
  de: "Sachbearbeiter dürfen Bescheide mit Abweichungen bis 10.000 € selbst zeichnen."
  en: "Case workers may sign assessments with deviations up to €10,000 themselves."
  owner: p10            # primary knowledge holder (must exist in personas)
  also_known_by: [p11]  # optional secondary sources
  department: VA
  access: internal
  valid_from: 2026-07-01
  valid_to: null
  status: current
  supersedes: F041      # optional
  rule: HV-2026-07      # optional link to rules.yaml
  question_ids: [Q09]   # which catalogue questions it helps answer
  sources_planned: [doc, interview]
  plant: superseded
```
Personas do **not** list their facts. Derive them with `owner` / `also_known_by` so there is a single source of truth.

### Persona (`data/personas/pNN.yaml`)
See `data/personas/p05.yaml`. Required keys: `id, name, department, role_de, role_en, grade, status, tenure_years,
start_date, leave_date, reports_to, deputy, room, phone_ext, email, access_role, speaking_style, voice, blind_spots`.

### Rule (`data/rules/rules.yaml` → `rules:`)
`id, title_de, title_en, issued_by, valid_from, valid_to, supersedes, access, summary_de, clauses[]`.

### Manifest line (`data/manifest.jsonl`, C builds it)
```json
{"file": "data/raw/audio/audio_p05_handover_interview.mp3", "modality": "audio", "persona": "p05",
 "fact_ids": ["F010","F031"], "rule_ids": [], "access": "internal", "department": "GS",
 "created": "2026-11-18", "language": "de", "transcript": "data/raw/audio/audio_p05_handover_interview.txt"}
```

### Generated text must
1. be German (Behördendeutsch for documents, natural spoken German for interviews);
2. contain **only** facts from `facts.yaml` (plus harmless filler), and list the IDs it used in the manifest;
3. never contain real people or real taxpayers. Fictional taxpayers appear only via `redaction_targets`.

## 6. Planted test cases (do not "fix" these)
Listed under `plants:` in `facts.yaml`: superseded rules, conflicts between sources, restricted content,
taxpayer data for redaction, and `planted_gaps` (questions with **no** source, so Hilde must say "I don't know" and name who to ask).

## 7. Tech defaults (B and C may change, but must say so here)
Ollama + Qwen2.5/Qwen3 (German) · faster-whisper · Piper TTS (German voices) · bge-m3 + Qdrant · Docling · Presidio · Chainlit.
