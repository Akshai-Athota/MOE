"""Ingestion: any source file -> redacted Segments -> Qdrant (searchable at once).

    from hilde.ingest import ingest_file
    ingest_file(Path("memo.wav"), CaptureMeta(title="Sprachmemo Reinecke", persona="p05", department="GS"))

Bulk import of the generated synthetic data:  uv run python -m hilde.ingest
"""

from hilde.ingest.pipeline import ingest_file, ingest_manifest

__all__ = ["ingest_file", "ingest_manifest"]
