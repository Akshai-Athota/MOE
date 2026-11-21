"""Knowledge library: anyone can post what colleagues should know ("Der Drucker im 2. OG ist defekt").

A post is redacted (§ 30 AO) and listed at once; indexing for Finn runs in the background (a few
seconds), so posting never blocks the app. A short-lived notice can be marked as resolved: its source becomes "superseded",
so Finn stops repeating it but keeps it as history. Posts live in var/library.json (git-ignored).
"""

import json
import threading
import uuid
from datetime import date, datetime

from pydantic import BaseModel, Field

from hilde import templates
from hilde.config import REPO_ROOT
from hilde.learn import learn
from hilde.loaders import load_personas
from hilde.redact import redact
from hilde.schemas import LearnRequest
from hilde.vectorstore import set_status_for

PATH = REPO_ROOT / "var" / "library.json"
_lock = threading.Lock()

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
    """Store the post at once (redacted). Indexing for Finn runs separately: index(post.id)."""
    person = load_personas()[req.user_id]
    clean, _removed = redact(req.text.strip())
    category = req.category if req.category in TOPICS else "general"
    post = Post(id=uuid.uuid4().hex[:8], user_id=req.user_id, author=person["name"], text=clean,
                category=category, created=datetime.now().isoformat(timespec="seconds"))
    with _lock:
        _save([*_load(), post])
    return post


def index(post_id: str) -> None:
    """Background job: make the post searchable for Finn. Never raises."""
    post = next((p for p in _load() if p.id == post_id), None)
    if post is None:
        return
    try:
        day = date.fromisoformat(post.created[:10]).strftime("%d.%m.%Y")
        res = learn(LearnRequest(text=post.text, user_id=post.user_id, via="library", category=post.category,
                                 topic=TOPICS.get(post.category, "Alltag"),
                                 label=f"Wissensbibliothek · {post.author} · {day}"))
    except Exception:  # noqa: BLE001 - the post stays listed; Finn just cannot cite it
        return
    with _lock:
        posts = _load()
        for p in posts:
            if p.id == post_id:
                p.capture_id = res["capture_id"]
                if p.resolved:  # marked done while it was being indexed
                    set_status_for(p.capture_id, "superseded")
        _save(posts)


def resolve(post_id: str) -> Post:
    with _lock:
        posts = _load()
        post = next((p for p in posts if p.id == post_id), None)
        if post is None:
            raise KeyError(post_id)
        if not post.resolved and post.capture_id:
            set_status_for(post.capture_id, "superseded")
            templates.bump()
        post.resolved = True
        _save(posts)
        return post


def clear() -> None:
    PATH.unlink(missing_ok=True)
