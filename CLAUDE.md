# Instructions for every Claude session in this repo

1. Read `SPEC.md` first. It is the contract.
2. Only edit the folders your person owns (see SPEC §2). Need a change elsewhere? Say so; don't edit it.
3. `data/facts/facts.yaml` is the single source of truth. Generated documents, transcripts and audio may only state facts from it.
   Never invent new facts in generators. If a fact is missing, ask Person A to add it.
4. Run `python3 generators/validate.py` before every commit. It must print `OK`.
5. All people, taxpayers and internal rules are fictional. Never add real names of employees or taxpayers.
6. Generated content is German. Code, comments and commit messages are English.
7. Keep large binaries (audio/video > 5 MB) out of git unless Git LFS is set up; they must be reproducible with the generators.
