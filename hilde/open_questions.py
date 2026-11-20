"""Questions Hilde could not answer. The interviewer (step B6) asks the right person about them,
so knowledge gaps are closed from real demand ("improvement A").

Stored as JSON lines in var/open_questions.jsonl (runtime data, git-ignored).
"""

import json
import uuid
from datetime import datetime

from hilde.config import REPO_ROOT

PATH = REPO_ROOT / "var" / "open_questions.jsonl"


def add(question: str, asked_by: str, assigned_to: str | None) -> str:
    PATH.parent.mkdir(exist_ok=True)
    item = {
        "id": uuid.uuid4().hex[:8],
        "question": question,
        "asked_by": asked_by,
        "assigned_to": assigned_to,
        "status": "open",
        "created": datetime.now().isoformat(timespec="seconds"),
    }
    with PATH.open("a", encoding="utf-8") as f:
        f.write(json.dumps(item, ensure_ascii=False) + "\n")
    return item["id"]


def list_open(assigned_to: str | None = None) -> list[dict]:
    if not PATH.exists():
        return []
    items = [json.loads(line) for line in PATH.read_text(encoding="utf-8").splitlines() if line]
    return [
        i for i in items
        if i["status"] == "open" and (assigned_to is None or i["assigned_to"] == assigned_to)
    ]
