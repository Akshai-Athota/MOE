# MOE: Finn, dein Finanzamt-Assistent

Hackathon project: **Finn**, an AI assistant for the Finanzamt Hildesheim. It interviews retiring employees with story cards,
onboards new hires, answers everyday questions with sources, and learns from a knowledge library everyone can post to.

> All people, internal rules and figures are **synthetic**. Only the office's public address, phone number and tax office number are real.

**Start here:** [`SPEC.md`](SPEC.md), the shared contract for data, pipeline and app.

| Path | What |
|---|---|
| `data/company/company.yaml` | the office: departments, building, systems, projects |
| `data/personas/` | 13 personas (2 leaving: p05 Reinecke, p11 Meyer; 1 new hire: p13 Jonas Albers) |
| `data/rules/rules.yaml` | 10 internal orders, incl. superseded versions |
| `data/facts/facts.yaml` | 106 facts: the single source of truth, plus planted test cases |
| `data/schema/questions.yaml` | 57 onboarding questions (from the PDF) + 18 general/public questions |
| `data/rewards/rewards.yaml` | vouchers for the reward card, from the leavers' own interests |
| `generators/validate.py` | consistency check; run before every push |

```bash
pip install pyyaml
python3 generators/validate.py --coverage
```

## Run the app
```bash
cd ui && npm install && npm run dev
```
See [`ui/README.md`](ui/README.md) for the views and the demo script.
