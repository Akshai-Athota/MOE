"""Seed Hilde's memory from the YAML world.

    uv run python -m hilde.index              # upsert (idempotent)
    uv run python -m hilde.index --recreate   # drop collection and rebuild
"""

import argparse
import time
from collections import Counter

from hilde.loaders import all_seed_documents
from hilde.vectorstore import ensure_collection, index_documents, qdrant_status


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--recreate", action="store_true", help="drop and rebuild the collection")
    args = ap.parse_args()

    ensure_collection(recreate=args.recreate)
    docs = all_seed_documents()
    t = time.time()
    n = index_documents(docs)
    print(f"indexed {n} chunks in {time.time() - t:.1f}s:",
          dict(Counter(d.metadata["source_type"] for d in docs)))
    print(qdrant_status())


if __name__ == "__main__":
    main()
