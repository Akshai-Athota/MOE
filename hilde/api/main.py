"""FastAPI entry point for Hilde's pipeline.

Run locally:  uv run uvicorn hilde.api.main:app --reload
Docs:         http://localhost:8000/docs
"""

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from hilde.config import get_settings
from hilde.llm import ollama_status
from hilde.loaders import load_personas, user_from_persona
from hilde.schemas import Hit, User
from hilde.vectorstore import qdrant_status, search

app = FastAPI(title="Hilde API", version="0.2.0")


@app.get("/health")
def health() -> dict:
    s = get_settings()
    ollama = ollama_status()
    qdrant = qdrant_status()
    return {
        "ok": ollama["ok"] and qdrant["ok"],
        "llm_model": s.llm_model,
        "embed_model": s.embed_model,
        "ollama": ollama,
        "qdrant": qdrant,
    }


@app.get("/users", response_model=list[User])
def users() -> list[User]:
    """Demo login list: every persona with their app role (SPEC §4)."""
    return [user_from_persona(pid) for pid in load_personas()]


class SearchRequest(BaseModel):
    query: str = Field(min_length=2)
    user_id: str = Field(description="persona id of the logged-in user, e.g. p13")
    k: int = Field(default=8, ge=1, le=30)
    include_history: bool = False


@app.post("/search", response_model=list[Hit])
def search_endpoint(req: SearchRequest) -> list[Hit]:
    """Role-filtered hybrid search. Raw retrieval only; answers come in step B3."""
    try:
        user = user_from_persona(req.user_id)
    except KeyError:
        raise HTTPException(404, f"unknown user {req.user_id}") from None
    return search(req.query, user, k=req.k, include_history=req.include_history)
