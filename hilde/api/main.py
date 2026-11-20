"""FastAPI entry point for Q's pipeline.

Run locally:  uv run uvicorn hilde.api.main:app --reload
Docs:         http://localhost:8000/docs
"""

from pathlib import Path
from typing import Annotated

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from hilde import interview, open_questions
from hilde.answer import ask
from hilde.config import REPO_ROOT, get_settings
from hilde.ingest import ingest_file
from hilde.learn import learn
from hilde.llm import ollama_status
from hilde.loaders import load_personas, user_from_persona
from hilde.schemas import Access, Answer, CaptureMeta, Hit, LearnRequest, User
from hilde.vectorstore import qdrant_status, search

app = FastAPI(title="Q API", version="0.6.0")

# the web app (Vite dev server on :5173) calls the API from the browser
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_methods=["*"],
    allow_headers=["*"],
)


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
    """Questions Q could not answer; the interviewer (B6) uses these."""
    return open_questions.list_open(assigned_to)


UPLOADS = REPO_ROOT / "var" / "uploads"


@app.post("/ingest")
def ingest_endpoint(
    file: Annotated[UploadFile, File(description="audio/video, PDF, DOCX, MD, TXT or image")],
    user_id: Annotated[str, Form(description="uploader persona id; becomes the knowledge owner")],
    title: Annotated[str, Form(description="e.g. 'Sprachmemo Reinecke zur Haushaltsanmeldung'")],
    access: Annotated[Access, Form()] = "internal",
    category: Annotated[str, Form()] = "general",
) -> dict:
    """Upload a source: it is transcribed/parsed, redacted (§ 30 AO) and searchable at once."""
    user = _user(user_id)
    if access == "restricted" and user.role != "manager":
        raise HTTPException(403, "only managers may store restricted knowledge")
    name = Path(file.filename or "upload").name
    UPLOADS.mkdir(parents=True, exist_ok=True)
    path = UPLOADS / name
    path.write_bytes(file.file.read())
    meta = CaptureMeta(title=title, persona=user.id, department=user.department,
                       access=access, category=category)
    try:
        return ingest_file(path, meta)
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(400, str(exc)) from None


@app.post("/learn")
def learn_endpoint(req: LearnRequest) -> dict:
    """Store knowledge captured in the app (interview/quiz answer, uploaded order). Searchable at once;
    a future valid_from is stored as scheduled and only becomes the answer on that day."""
    user = _user(req.user_id)
    if req.access == "restricted" and user.role != "manager":
        raise HTTPException(403, "only managers may store restricted knowledge")
    return learn(req)


@app.post("/reset-learned")
def reset_learned_endpoint() -> dict:
    """Demo reset: forget knowledge learned live in the app (interviews, quiz, uploads) and open
    questions. Superseded markers from live updates stay; rebuild with `python -m hilde.index`."""
    from hilde.vectorstore import delete_learned

    removed = delete_learned()
    restored = interview.undo_status_changes()
    open_questions.PATH.unlink(missing_ok=True)
    return {"removed": removed, "restored": restored}


# ---------------------------------------------------------------- interviewer (B6)

class InterviewStart(BaseModel):
    user_id: str = Field(description="the person being interviewed (usually a leaver)")
    open_questions: list[interview.OpenQuestionIn] = Field(
        default_factory=list, description="colleagues' questions routed to this person (from the app)")


class InterviewAnswer(BaseModel):
    answer: str = Field(min_length=2, description="spoken or typed answer (redacted before storage)")


def _session(sid: str) -> interview.Session:
    try:
        return interview.load(sid)
    except FileNotFoundError:
        raise HTTPException(404, f"unknown interview {sid}") from None


@app.post("/interview/start")
def interview_start(req: InterviewStart) -> dict:
    """Plan the interview: colleagues' questions, gaps only this person can close, topics where
    this person is the only source. Returns Q's first question and the (empty) handbook page."""
    _user(req.user_id)
    return interview.to_dict(interview.start(req.user_id, req.open_questions))


@app.get("/interview/{sid}")
def interview_get(sid: str) -> dict:
    return interview.to_dict(_session(sid))


@app.post("/interview/{sid}/answer")
def interview_answer(sid: str, req: InterviewAnswer) -> dict:
    """Redact, extract handbook statements, compare with existing knowledge, ask the next question."""
    s = _session(sid)
    if s.current is None:
        raise HTTPException(409, "interview finished")
    turn = interview.answer(s, req.answer)
    return {"turn": turn.model_dump(), **interview.to_dict(s)}


@app.post("/interview/{sid}/focus")
def interview_focus(sid: str, q: interview.PlannedQuestion) -> dict:
    """Answer a specific question now (e.g. a colleague's question picked in the app)."""
    return interview.to_dict(interview.focus(_session(sid), q))


@app.post("/interview/{sid}/skip")
def interview_skip(sid: str) -> dict:
    return interview.to_dict(interview.skip(_session(sid)))


@app.post("/interview/{sid}/publish")
def interview_publish(sid: str) -> dict:
    """The person approved the handbook page: index it. Contradictions go to a manager."""
    s = _session(sid)
    return {"result": interview.publish(s), **interview.to_dict(s)}
