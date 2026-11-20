"""Knowledge library: anyone can post what colleagues should know ("Der Drucker im 2. OG ist defekt").

A post is redacted (§ 30 AO), indexed at once (Finn can answer from it in the next question) and
listed in the app. A short-lived notice can be marked as resolved: its source becomes "superseded",
so Finn stops repeating it but keeps it as history. Posts live in var/library.json (git-ignored).
"""

import json
import uuid
from datetime import date, datetime

from pydantic import BaseModel, Field

from hilde.config import REPO_ROOT
from hilde.learn import learn
from hilde.loaders import load_personas
from hilde.redact import redact
from hilde.schemas import LearnRequest
from hilde.vectorstore import set_status_for

PATH = REPO_ROOT / "var" / "library.json"

TOPICS = {"general": "Alltag", "it": "IT & Technik", "process": "Abläufe", "org": "Organisation",
          "finance": "Haushalt & Beschaffung", "communication": "Kommunikation"}


class PostIn(BaseModel):
    user_id: str
    text: str = Field(min_length=3, max_length=2000)
    category: str = "general"


class Post(BaseModel):
    id: str
    user_id: str
    author: str
    text: str
    category: str
    created: str
    capture_id: str | None = None
    resolved: bool = False


def _load() -> list[Post]:
    if not PATH.exists():
        return []
    return [Post(**x) for x in json.loads(PATH.read_text(encoding="utf-8"))]


def _save(posts: list[Post]) -> None:
    PATH.parent.mkdir(parents=True, exist_ok=True)
    PATH.write_text(json.dumps([p.model_dump() for p in posts], ensure_ascii=False, indent=1), encoding="utf-8")


def list_posts() -> list[Post]:
    return sorted(_load(), key=lambda p: p.created, reverse=True)


def add(req: PostIn) -> Post:
    person = load_personas()[req.user_id]
    clean, _removed = redact(req.text.strip())
    category = req.category if req.category in TOPICS else "general"
    day = date.today().strftime("%d.%m.%Y")
    res = learn(LearnRequest(text=clean, user_id=req.user_id, via="library", category=category,
                             topic=TOPICS[category], label=f"Wissensbibliothek · {person['name']} · {day}"))
    post = Post(id=uuid.uuid4().hex[:8], user_id=req.user_id, author=person["name"], text=clean,
                category=category, created=datetime.now().isoformat(timespec="seconds"),
                capture_id=res["capture_id"])
    _save([*_load(), post])
    return post


def resolve(post_id: str) -> Post:
    posts = _load()
    post = next((p for p in posts if p.id == post_id), None)
    if post is None:
        raise KeyError(post_id)
    if not post.resolved and post.capture_id:
        set_status_for(post.capture_id, "superseded")
    post.resolved = True
    _save(posts)
    return post


def clear() -> None:
    PATH.unlink(missing_ok=True)
