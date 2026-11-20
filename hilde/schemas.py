"""Shared data shapes for the pipeline (SPEC §4/§5)."""

from typing import Literal

from pydantic import BaseModel, Field

Role = Literal["employee", "new_hire", "leaver", "manager"]
Access = Literal["public", "internal", "restricted"]
SourceType = Literal["fact", "rule", "person", "segment", "handbook"]

# SPEC §4: user role -> access levels the user may see. Enforced in retrieval, never only in the prompt.
ACCESS_BY_ROLE: dict[str, list[str]] = {
    "employee": ["public", "internal"],
    "new_hire": ["public", "internal"],
    "leaver": ["public", "internal"],
    "manager": ["public", "internal", "restricted"],
}

# SPEC §4: an `employee` only sees everyday categories + material of their own department.
EMPLOYEE_CATEGORIES = ["general", "public"]


class User(BaseModel):
    id: str = Field(description="persona id, e.g. p13")
    name: str = ""
    role: Role
    department: str = Field(description="AL | RB | GS | VA")


class Segment(BaseModel):
    """A piece of a real source (interview, document, image) with an anchor back into it."""

    id: str = Field(description="<capture_id>#<n>")
    capture_id: str
    modality: Literal["audio", "video", "doc", "email", "text", "image"]
    text: str
    speaker: str | None = None
    anchor: dict = Field(default_factory=dict,
                         description="{t_start,t_end} | {paragraph} | {page} | {section}")
    source_file: str


class CaptureMeta(BaseModel):
    """Who/what a capture is about; drives access filtering and citations."""

    title: str
    persona: str | None = Field(default=None, description="speaker / owner persona id")
    department: str = "ALL"
    access: Access = "internal"
    category: str = "general"
    fact_ids: list[str] = Field(default_factory=list, description="ground truth (synthetic data only)")
    status: str = "current"
    valid_from: str | None = None
    valid_to: str | None = None
    supersedes: str | None = Field(default=None, description="capture id this source replaces")


class Citation(BaseModel):
    n: int = Field(description="number used in the answer text, e.g. [2]")
    source_id: str
    source_type: str
    citation: str = Field(description="human-readable label for the UI")
    snippet: str
    status: str
    valid_from: str | None = None
    anchor: dict = Field(default_factory=dict, description="e.g. {t_start: 252.1} -> play audio from 04:12")
    source_file: str | None = None
    owner: str | None = Field(default=None, description="persona id of the knowledge holder")
    modality: str | None = Field(default=None, description="audio | video | doc | email | text | fact | rule")
    title: str | None = None
    fact_ids: list[str] = Field(default_factory=list, description="ground-truth facts behind the source")


class Contact(BaseModel):
    id: str
    name: str
    role_de: str
    room: str
    phone_ext: str
    email: str


class Change(BaseModel):
    """A cited source replaced older knowledge: UI shows 'geändert am ..., vorher ...'."""

    n: int
    source_id: str
    changed_on: str | None
    previous_source_id: str
    previous_text: str


class Answer(BaseModel):
    question: str
    answer: str
    abstained: bool
    conflict: bool = False
    citations: list[Citation] = []
    changes: list[Change] = []
    who_to_ask: Contact | None = None
    open_question_id: str | None = None
    blocked: bool = Field(default=False, description="the answer exists but is not released for this role")
    restricted_owner: Contact | None = Field(
        default=None, description="whom to ask for content this role may not see")
    seconds: float = 0.0


class LearnRequest(BaseModel):
    """Knowledge captured in the UI (interview answer, quiz answer, uploaded order)."""

    text: str = Field(min_length=3)
    user_id: str = Field(description="knowledge holder (persona id)")
    label: str = Field(description="citation label, e.g. 'Interview W. Reinecke · live'")
    via: Literal["interview", "quiz", "upload"] = "interview"
    topic: str | None = None
    category: str = "general"
    access: Access = "internal"
    valid_from: str | None = Field(default=None, description="ISO date; in the future = scheduled")
    supersedes: str | None = Field(default=None, description="fact/source id this replaces")
    question: str | None = Field(default=None, description="the open question this answers")


class Hit(BaseModel):
    """One retrieved chunk, as returned by search."""

    chunk_id: str
    text: str
    score: float
    source_type: str
    source_id: str
    citation: str
    access: str
    status: str
    metadata: dict
