"""Knowledge captured live in the app: an interview answer, a knowledge-library post, an uploaded order.

It is redacted, indexed at once (searchable in the next question) and changes the timeline:
* valid_from in the future  -> status "scheduled" (never an answer before that day)
* supersedes + valid today  -> the replaced fact/source is marked "superseded" (kept as history)
"""

import uuid
from datetime import date, datetime

from langchain_core.documents import Document

from hilde import open_questions, templates
from hilde.loaders import load_personas
from hilde.redact import redact
from hilde.schemas import LearnRequest
from hilde.vectorstore import index_documents, set_status_for


def learn(req: LearnRequest) -> dict:
    people = load_personas()
    owner = people[req.user_id]
    clean, removed = redact(req.text)
    today = date.today().isoformat()
    valid_from = req.valid_from or today
    scheduled = valid_from > today

    # keep the question with the answer: retrieval then matches the question's wording too
    body = clean
    if req.question:
        body = f"Frage: {req.question}\n{owner['name']}: {clean}"
    elif req.topic:
        body = f"{req.topic}: {clean}"

    cid = f"learned-{uuid.uuid4().hex[:8]}"
    doc = Document(page_content=body, metadata={
        "chunk_id": f"{cid}#1",
        "source_type": "segment",
        "source_id": cid,
        "title": req.label,
        "category": req.category,
        "department": "ALL" if req.via in ("upload", "library") else owner["department"],
        "access": req.access,
        "status": "scheduled" if scheduled else "current",
        "valid_from": valid_from,
        "valid_to": None,
        "supersedes": req.supersedes,
        "modality": "doc" if req.via in ("upload", "library") else "interview",
        "learned_via": req.via,
        "learned_at": datetime.now().isoformat(timespec="seconds"),
        "speaker": owner["name"],
        "anchor": {},
        "source_file": None,
        "owner": owner["id"],
        "owner_name": owner["name"],
        "question_ids": [],
        "fact_ids": [],
        "citation": req.label,
    })
    index_documents([doc])
    if req.supersedes and not scheduled:
        set_status_for(req.supersedes, "superseded")
    templates.bump()  # cached questionnaire answers may be outdated now
    closed = open_questions.resolve(req.question) if req.question else 0
    return {"capture_id": cid, "status": doc.metadata["status"], "valid_from": valid_from,
            "redacted": removed, "open_questions_closed": closed}
