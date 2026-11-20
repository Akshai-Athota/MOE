"""FastAPI entry point for Hilde's pipeline.

Run locally:  uv run uvicorn hilde.api.main:app --reload
Docs:         http://localhost:8000/docs
"""

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from hilde import open_questions
from hilde.answer import ask
from hilde.config import get_settings
from hilde.llm import ollama_status
from hilde.loaders import load_personas, user_from_persona
from hilde.schemas import Answer, Hit, User
from hilde.vectorstore import qdrant_status, search

app = FastAPI(title="Hilde API", version="0.3.0")


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


def _user(user_id: str) -> User:
    try:
        return user_from_persona(user_id)
    except KeyError:
        raise HTTPException(404, f"unknown user {user_id}") from None


@app.post("/search", response_model=list[Hit])
def search_endpoint(req: SearchRequest) -> list[Hit]:
    """Role-filtered hybrid search (raw chunks, no LLM)."""
    return search(req.query, _user(req.user_id), k=req.k, include_history=req.include_history)


class AskRequest(BaseModel):
    question: str = Field(min_length=2)
    user_id: str = Field(description="persona id of the logged-in user, e.g. p13")


@app.post("/ask", response_model=Answer)
def ask_endpoint(req: AskRequest) -> Answer:
    """Cited answer in the language of the question (de/en), or 'I don't know' + who to ask (question is queued)."""
    return ask(req.question, _user(req.user_id))


@app.get("/open-questions")
def open_questions_endpoint(assigned_to: str | None = None) -> list[dict]:
    """Questions Hilde could not answer; the interviewer (B6) uses these."""
    return open_questions.list_open(assigned_to)
