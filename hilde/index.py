"""Build Q's memory.

    uv run python -m hilde.index --recreate              # facts + rules + staff directory (seed)
    uv run python -m hilde.index --recreate --raw        # staff directory + real sources only
    uv run python -m hilde.index --recreate --seed --raw # everything

--raw ingests data/manifest.jsonl (transcripts, documents, audio) with segment citations.
The staff directory is always indexed (it answers "who is / who covers for ...").
"""

import argparse
import time
from collections import Counter

from hilde.loaders import fact_documents, person_documents, rule_documents
from hilde.vectorstore import ensure_collection, index_documents, qdrant_status


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--recreate", action="store_true", help="drop and rebuild the collection")
    ap.add_argument("--seed", action="store_true", help="index facts.yaml + rules.yaml directly")
    ap.add_argument("--raw", action="store_true", help="ingest generated sources from the manifest")
    args = ap.parse_args()
    seed = args.seed or not args.raw  # default (no flag): seed, as before

    ensure_collection(recreate=args.recreate)
    t = time.time()
    docs = person_documents() + ((fact_documents() + rule_documents()) if seed else [])
    index_documents(docs)
    print(f"seed: {len(docs)} chunks", dict(Counter(d.metadata["source_type"] for d in docs)))
    if args.raw:
        from hilde.ingest import ingest_manifest

        results = ingest_manifest()
        print(f"raw: {len(results)} sources, {sum(r.get('segments', 0) for r in results)} segments, "
              f"redacted {sum((Counter(r.get('redacted', {})) for r in results), Counter())}")
    print(f"{time.time() - t:.1f}s", qdrant_status())


if __name__ == "__main__":
    main()
