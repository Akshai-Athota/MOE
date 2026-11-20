"""uv run python -m hilde.ingest [name-filter ...]  -> ingest data/manifest.jsonl into Qdrant."""

import sys

from hilde.ingest.pipeline import ingest_manifest

for r in ingest_manifest(only=sys.argv[1:] or None):
    print(r)
