"""Knowledge library: anyone can post what colleagues should know ("Der Drucker im 2. OG ist defekt").

A post is redacted (§ 30 AO) and listed at once; indexing for Finn runs in the background (a few
seconds, retried on errors), so posting never blocks the app. Posts whose indexing did not finish
(model busy, server restarted) are indexed again the next time the library is listed. A short-lived notice can be marked as resolved: its source becomes "superseded",
so Finn stops repeating it but keeps it as history. Posts live in var/library.json (git-ignored).
"""

import json
import logging
import os
import threading
import time
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
INDEX_TRIES = 3
log = logging.getLogger(__name__)
_lock = threading.Lock()
_indexing: set[str] = set()  # post ids with an indexing job in this server process

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
    tmp = PATH.with_name(f".{PATH.name}.{uuid.uuid4().hex[:6]}.tmp")
    tmp.write_text(json.dumps([p.model_dump() for p in posts], ensure_ascii=False, indent=1), encoding="utf-8")
    os.replace(tmp, PATH)  # atomic: a reader never sees a half-written file


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
        _indexing.add(post.id)  # the caller schedules index(post.id) right away
    return post


def unindexed() -> list[str]:
    """Posts that are not searchable yet and have no indexing job (e.g. after a restart)."""
    with _lock:
        ids = [p.id for p in _load() if p.capture_id is None and p.id not in _indexing]
        _indexing.update(ids)
        return ids


def index(post_id: str) -> None:
    """Background job: make the post searchable for Finn, with retries. Never raises."""
    try:
        post = next((p for p in _load() if p.id == post_id), None)
        if post is None or post.capture_id:
            return
        day = date.fromisoformat(post.created[:10]).strftime("%d.%m.%Y")
        req = LearnRequest(text=post.text, user_id=post.user_id, via="library", category=post.category,
                           topic=TOPICS.get(post.category, "Alltag"), label=f"Wissensbibliothek · {post.author} · {day}")
        res = None
        for attempt in range(INDEX_TRIES):
            try:
                res = learn(req)
                break
            except Exception:  # noqa: BLE001
                log.exception("library post %s: indexing failed (try %d)", post_id, attempt + 1)
                if attempt < INDEX_TRIES - 1:
                    time.sleep(1.5 * (attempt + 1))
        if res is None:
            return  # stays listed; indexed again on the next list
        with _lock:
            posts = _load()
            for p in posts:
                if p.id == post_id:
                    p.capture_id = res["capture_id"]
                    if p.resolved:  # marked done while it was being indexed
                        set_status_for(p.capture_id, "superseded")
            _save(posts)
    finally:
        with _lock:
            _indexing.discard(post_id)


def resolve(post_id: str) -> Post:
    with _lock:
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
