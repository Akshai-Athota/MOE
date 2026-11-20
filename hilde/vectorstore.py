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


def delete_source(source_id: str) -> None:
    """Remove all chunks of one source (before re-ingesting a changed file)."""
    s = get_settings()
    ensure_collection()
    get_qdrant().delete(
        s.qdrant_collection,
        points_selector=models.FilterSelector(filter=models.Filter(must=[
            models.FieldCondition(key="metadata.source_id", match=models.MatchValue(value=source_id))
        ])),
    )


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


# ---------------------------------------------------------------- guardrail helper

# bge-m3 cosine above which a hidden source counts as "about this question"
RESTRICTED_MIN_SCORE = 0.50  # measured: budget questions 0.55-0.62, parking/canteen <= 0.36


def _dense_top(query_vec: list[float], flt: models.Filter) -> tuple[float, dict] | None:
    res = get_qdrant().query_points(
        get_settings().qdrant_collection, query=query_vec, using=DENSE, query_filter=flt,
        limit=1, with_payload=True,
    ).points
    return (res[0].score, res[0].payload["metadata"]) if res else None


def restricted_probe(query: str, user: User) -> Hit | None:
    """Is there restricted content that matches the question better than anything the user may see?

    Lets Q say "this exists, but not for your role – ask X" instead of a misleading partial answer.
    Only the owner is revealed, never the content: the hidden text is not passed to the LLM.
    """
    if user.role == "manager":
        return None
    vec = get_embeddings().embed_query(query)
    hidden = _dense_top(vec, models.Filter(
        must=[models.FieldCondition(key="metadata.access", match=models.MatchValue(value="restricted"))],
        must_not=[models.FieldCondition(key="metadata.status",
                                        match=models.MatchAny(any=["superseded", "scheduled"]))],
    ))
    if not hidden or hidden[0] < RESTRICTED_MIN_SCORE:
        return None
    visible = _dense_top(vec, build_filter(user))
    if visible and visible[0] >= hidden[0]:
        return None  # the user's own sources match at least as well: answer normally
    md = hidden[1]
    return Hit(chunk_id=md["chunk_id"], text="", score=hidden[0], source_type=md["source_type"],
               source_id=md["source_id"], citation=md["citation"], access=md["access"],
               status=md["status"], metadata=md)


def set_status_for(fact_or_source_id: str, status: str) -> None:
    """Mark every chunk of a fact/source (incl. segments that state it) e.g. as superseded."""
    flt = models.Filter(should=[
        models.FieldCondition(key="metadata.source_id", match=models.MatchValue(value=fact_or_source_id)),
        models.FieldCondition(key="metadata.fact_ids", match=models.MatchAny(any=[fact_or_source_id])),
    ])
    get_qdrant().set_payload(get_settings().qdrant_collection, payload={"status": status},
                             key="metadata", points=flt)


def delete_learned() -> int:
    """Remove all knowledge captured live in the app (demo reset). Indexed sources stay."""
    s = get_settings()
    flt = models.Filter(must_not=[models.IsEmptyCondition(is_empty=models.PayloadField(key="metadata.learned_via"))])
    n = get_qdrant().count(s.qdrant_collection, count_filter=flt).count
    get_qdrant().delete(s.qdrant_collection, points_selector=models.FilterSelector(filter=flt))
    return n
