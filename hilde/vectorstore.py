"""Qdrant: hybrid index (bge-m3 dense + German BM25 sparse) with role-filtered search."""

import uuid
from functools import lru_cache

from langchain_core.documents import Document
from langchain_qdrant import FastEmbedSparse, QdrantVectorStore, RetrievalMode
from qdrant_client import QdrantClient, models

from hilde.config import get_settings
from hilde.guardrails import build_filter
from hilde.llm import get_embeddings
from hilde.schemas import Hit, User

DENSE = "dense"
SPARSE = "sparse"
# payload fields we filter on -> keyword indexes keep filtering fast as data grows
INDEXED_FIELDS = ["access", "category", "department", "status", "source_type", "source_id"]


@lru_cache
def get_qdrant() -> QdrantClient:
    s = get_settings()
    return QdrantClient(url=s.qdrant_url, api_key=s.qdrant_api_key or None, timeout=30)


@lru_cache
def get_sparse() -> FastEmbedSparse:
    return FastEmbedSparse(model_name="Qdrant/bm25", language="german")


def qdrant_status() -> dict:
    s = get_settings()
    try:
        client = get_qdrant()
        collections = [c.name for c in client.get_collections().collections]
        exists = s.qdrant_collection in collections
        points = client.count(s.qdrant_collection).count if exists else 0
    except Exception as exc:  # noqa: BLE001 - report any connection problem
        return {"ok": False, "error": str(exc)}
    return {"ok": True, "collections": collections, "collection_exists": exists, "points": points}


def ensure_collection(recreate: bool = False) -> None:
    s = get_settings()
    client = get_qdrant()
    if recreate and client.collection_exists(s.qdrant_collection):
        client.delete_collection(s.qdrant_collection)
    if client.collection_exists(s.qdrant_collection):
        return
    client.create_collection(
        s.qdrant_collection,
        vectors_config={DENSE: models.VectorParams(size=s.embed_dim, distance=models.Distance.COSINE)},
        # BM25 needs the IDF modifier
        sparse_vectors_config={SPARSE: models.SparseVectorParams(modifier=models.Modifier.IDF)},
    )
    for field in INDEXED_FIELDS:
        client.create_payload_index(
            s.qdrant_collection, f"metadata.{field}", models.PayloadSchemaType.KEYWORD
        )


@lru_cache
def get_store() -> QdrantVectorStore:
    ensure_collection()
    return QdrantVectorStore(
        client=get_qdrant(),
        collection_name=get_settings().qdrant_collection,
        embedding=get_embeddings(),
        sparse_embedding=get_sparse(),
        retrieval_mode=RetrievalMode.HYBRID,
        vector_name=DENSE,
        sparse_vector_name=SPARSE,
    )


def point_id(chunk_id: str) -> str:
    """Deterministic id -> re-indexing the same chunk overwrites it instead of duplicating."""
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"hilde:{chunk_id}"))


def index_documents(docs: list[Document], batch_size: int = 32) -> int:
    ids = [point_id(d.metadata["chunk_id"]) for d in docs]
    get_store().add_documents(docs, ids=ids, batch_size=batch_size)
    return len(docs)


def get_by_source_id(source_id: str, user: User) -> Hit | None:
    """Exact lookup (e.g. the superseded predecessor of a hit), still role-filtered."""
    f = build_filter(user, include_history=True)
    f.must.append(
        models.FieldCondition(key="metadata.source_id", match=models.MatchValue(value=source_id))
    )
    points, _ = get_qdrant().scroll(
        get_settings().qdrant_collection, scroll_filter=f, limit=1, with_payload=True
    )
    if not points:
        return None
    md = points[0].payload["metadata"]
    return Hit(
        chunk_id=md["chunk_id"], text=points[0].payload["page_content"], score=1.0,
        source_type=md["source_type"], source_id=md["source_id"], citation=md["citation"],
        access=md["access"], status=md["status"], metadata=md,
    )


def search(query: str, user: User, k: int = 8, include_history: bool = False) -> list[Hit]:
    """Hybrid search (dense + BM25, fused with RRF), restricted to what `user` may see."""
    results = get_store().similarity_search_with_score(
        query, k=k, filter=build_filter(user, include_history)
    )
    return [
        Hit(
            chunk_id=d.metadata["chunk_id"],
            text=d.page_content,
            score=float(score),
            source_type=d.metadata["source_type"],
            source_id=d.metadata["source_id"],
            citation=d.metadata["citation"],
            access=d.metadata["access"],
            status=d.metadata["status"],
            metadata=d.metadata,
        )
        for d, score in results
    ]
