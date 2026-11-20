# MOE: Hilde, the memory of the public administration

Hackathon project: an AI colleague for **Finanzamt Hildesheim**. It interviews employees who are leaving, onboards new hires,
answers everyday staff questions and keeps its knowledge up to date, with citations and role-based guardrails.

> All people, internal rules and figures are **synthetic**. Only the office's public address, phone number and tax office number are real.

**Start here:** [`SPEC.md`](SPEC.md), the shared contract for data, pipeline and app.

| Path | What |
|---|---|
| `data/company/company.yaml` | the office: departments, building, systems, projects |
| `data/personas/` | 13 personas (2 leaving: p05 Reinecke, p11 Meyer; 1 new hire: p13 Albers) |
| `data/rules/rules.yaml` | 10 internal orders, incl. superseded versions |
| `data/facts/facts.yaml` | 97 facts: the single source of truth, plus planted test cases |
| `data/schema/questions.yaml` | 57 onboarding questions (from the PDF) + 17 general/public questions |
| `generators/validate.py` | consistency check; run before every push |

```bash
pip install pyyaml
python3 generators/validate.py --coverage
```
