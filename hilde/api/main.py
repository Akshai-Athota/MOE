"""FastAPI entry point for Finn's pipeline (Finn, dein Finanzamt-Assistent).

Run locally:  uv run uvicorn hilde.api.main:app --reload
Docs:         http://localhost:8000/docs
"""

import uuid
from pathlib import Path
from typing import Annotated

from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from hilde import avatar, interview, library, open_questions
from hilde.answer import ask
from hilde.config import REPO_ROOT, get_settings
from hilde.ingest import ingest_file
from hilde.learn import learn
from hilde.llm import ollama_status
from hilde.loaders import load_personas, user_from_persona
from hilde.schemas import Access, Answer, CaptureMeta, Hit, LearnRequest, User
from hilde.vectorstore import qdrant_status, search

app = FastAPI(title="Finn API", version="0.7.0")

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
    library.clear()
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
    _session(sid)
    return interview.to_dict(interview.get(sid))


@app.post("/interview/{sid}/answer")
def interview_answer(sid: str, req: InterviewAnswer) -> dict:
    """Redact, extract handbook statements, compare with existing knowledge, ask the next question."""
    s = _session(sid)
    if s.current is None:
        raise HTTPException(409, "interview finished")
    turn = interview.answer(s, req.answer)
    return {"turn": turn.model_dump(), **interview.to_dict(s)}


class InterviewPick(BaseModel):
    card: int = Field(ge=1, description="story card number from the deck")


@app.post("/interview/{sid}/pick")
def interview_pick(sid: str, req: InterviewPick) -> dict:
    """The person picked a story card: Finn asks its question."""
    try:
        return interview.to_dict(interview.pick(_session(sid), req.card))
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from None


class InterviewSubmit(BaseModel):
    card: int = Field(ge=1)
    answer: str = Field(min_length=2, description="typed answer")


@app.post("/interview/{sid}/submit")
def interview_submit(sid: str, req: InterviewSubmit) -> dict:
    """Typed answer for a card. Returns at once (the card is done, draw the next one); redaction,
    extraction and indexing run in a background worker. Poll GET /interview/{sid} for the results."""
    _session(sid)
    try:
        return interview.to_dict(interview.submit(sid, req.card, text=req.answer))
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from None


@app.post("/interview/{sid}/submit-audio")
def interview_submit_audio(sid: str, card: Annotated[int, Form(ge=1)],
                           file: Annotated[UploadFile, File(description="recorded or uploaded audio")]) -> dict:
    """Audio answer for a card. Returns at once; Whisper transcription and everything else run in
    the background worker (the audio file is deleted afterwards)."""
    _session(sid)
    suffix = Path(file.filename or "answer.webm").suffix.lower() or ".webm"
    UPLOADS.mkdir(parents=True, exist_ok=True)
    path = UPLOADS / f"interview-{sid}-{card}-{uuid.uuid4().hex[:6]}{suffix}"
    path.write_bytes(file.file.read())
    try:
        return interview.to_dict(interview.submit(sid, card, audio_path=str(path)))
    except ValueError as exc:
        path.unlink(missing_ok=True)
        raise HTTPException(409, str(exc)) from None


@app.post("/interview/{sid}/answer-audio")
def interview_answer_audio(sid: str, file: Annotated[UploadFile, File(description="recorded or uploaded audio")]) -> dict:
    """Answer the current card by audio: transcribed (Whisper), then handled like a spoken answer.
    Only the redacted answer is returned and stored."""
    from hilde.ingest import parsers

    s = _session(sid)
    if s.current is None:
        raise HTTPException(409, "pick a card first")
    suffix = Path(file.filename or "answer.webm").suffix.lower() or ".webm"
    UPLOADS.mkdir(parents=True, exist_ok=True)
    path = UPLOADS / f"interview-{sid}-{len(s.turns) + 1}{suffix}"
    path.write_bytes(file.file.read())
    try:
        text = " ".join(t for _speaker, t, _anchor in parsers.transcribe(path)).strip()
    finally:
        path.unlink(missing_ok=True)  # the audio itself is not kept
    if len(text) < 2:
        raise HTTPException(422, "no speech recognized")
    turn = interview.answer(s, text)
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


# ---------------------------------------------------------------- knowledge library

@app.get("/library")
def library_list(bg: BackgroundTasks) -> list[library.Post]:
    """Everything colleagues posted, newest first. Posts whose indexing did not finish are retried."""
    for pid in library.unindexed():
        bg.add_task(library.index, pid)
    return library.list_posts()


@app.post("/library")
def library_add(req: library.PostIn, bg: BackgroundTasks) -> library.Post:
    """Post a note for everyone (e.g. 'Drucker 2. OG defekt'). Stored and listed at once (redacted);
    Finn can answer from it a few seconds later (indexed in the background, retried on errors)."""
    _user(req.user_id)
    post = library.add(req)
    bg.add_task(library.index, post.id)
    return post


@app.post("/library/{post_id}/resolve")
def library_resolve(post_id: str) -> library.Post:
    """A notice is no longer true (printer fixed): Finn stops repeating it, history stays."""
    try:
        return library.resolve(post_id)
    except KeyError:
        raise HTTPException(404, f"unknown post {post_id}") from None


# ---------------------------------------------------------------- avatars ("remembered forever")

def _avatar_call(f, *args):
    try:
        return f(*args)
    except avatar.AvatarError as exc:
        raise HTTPException(400, str(exc)) from None


@app.get("/avatar/status")
def avatar_status() -> dict:
    return avatar.status()


@app.get("/avatar")
def avatar_list() -> list[dict]:
    return avatar.list_all()


@app.post("/avatar")
def avatar_create(
    name: Annotated[str, Form(description="shown as 'KI-Avatar von <name>'")],
    consent: Annotated[bool, Form(description="explicit consent of the person; required")],
    photo: Annotated[UploadFile, File(description="front-facing photo (jpg/png)")],
    voice: Annotated[UploadFile, File(description="10-60 s of clear speech (webm/mp3/wav/m4a)")],
    persona_id: Annotated[str | None, Form()] = None,
) -> dict:
    """Create a labelled AI avatar from a photo and a voice sample (stored locally only)."""
    return _avatar_call(
        avatar.create, name, persona_id, photo.file.read(), Path(photo.filename or "p.jpg").suffix,
        voice.file.read(), Path(voice.filename or "v.webm").suffix, consent)


@app.get("/avatar/{aid}/photo")
def avatar_photo(aid: str) -> FileResponse:
    return FileResponse(_avatar_call(avatar.photo_path, aid))


class SpeakRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    lang: str = "de"


@app.post("/avatar/{aid}/speak")
def avatar_speak(aid: str, req: SpeakRequest) -> FileResponse:
    """The text in the avatar's cloned voice (WAV)."""
    if not avatar.status()["voice"]:
        raise HTTPException(503, "voice stack not installed: uv sync --extra avatar")
    return FileResponse(_avatar_call(avatar.speak, aid, req.text, req.lang), media_type="audio/wav")


class AvatarAsk(BaseModel):
    question: str = Field(min_length=2)
    user_id: str


@app.post("/avatar/{aid}/ask")
def avatar_ask(aid: str, req: AvatarAsk) -> dict:
    """Finn finds the answer in the sources (role filter as always); the avatar speaks it."""
    meta = _avatar_call(avatar.get, aid)
    a = ask(req.question, _user(req.user_id))
    lang = "en" if a.answer and a.answer[:40].isascii() and " the " in f" {a.answer.lower()} " else "de"
    return {"avatar": meta, "answer": a.model_dump(), "audio": f"/avatar/{aid}/speak", "lang": lang}


@app.delete("/avatar/{aid}")
def avatar_delete(aid: str) -> dict:
    """Consent withdrawn: photo, voice sample and all generated audio are deleted."""
    _avatar_call(avatar.get, aid)
    avatar.delete(aid)
    return {"deleted": aid}
