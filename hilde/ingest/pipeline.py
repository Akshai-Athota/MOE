"""File -> pieces -> redaction -> Segments -> LangChain Documents -> Qdrant."""

import json
import re
from collections import Counter
from datetime import date
from pathlib import Path

from langchain_core.documents import Document

from hilde.config import REPO_ROOT
from hilde.ingest import parsers
from hilde.loaders import load_personas
from hilde.redact import redact
from hilde.schemas import CaptureMeta, Segment
from hilde.vectorstore import delete_source, index_documents

AUDIO = {".wav", ".mp3", ".m4a", ".ogg", ".flac", ".webm"}
VIDEO = {".mp4", ".mov", ".mkv"}
IMAGE = {".png", ".jpg", ".jpeg", ".webp"}


def capture_id_for(path: Path) -> str:
    """Deterministic id from the file name: re-ingesting the same file replaces it."""
    return re.sub(r"[^a-zA-Z0-9_\-]", "_", path.stem)


def _pieces(path: Path) -> tuple[str, list[parsers.Piece]]:
    suffix = path.suffix.lower()
    if suffix in AUDIO:
        return "audio", parsers.transcribe(path)
    if suffix in VIDEO:
        return "video", parsers.transcribe(path)
    if suffix in IMAGE:
        return "image", parsers.describe_image(path)
    if suffix == ".pdf":
        return "doc", parsers.parse_pdf(path)
    if suffix == ".docx":
        return "doc", parsers.parse_docx(path)
    if suffix == ".md":
        return "doc", parsers.parse_markdown(path)[1]
    if suffix == ".txt":
        text = path.read_text(encoding="utf-8")
        if text.lstrip().startswith("Von:"):
            return "email", parsers.parse_email_thread(path)
        return "text", parsers.parse_transcript(path)
    raise ValueError(f"unsupported file type: {suffix}")


def to_segments(path: Path, capture_id: str | None = None) -> tuple[list[Segment], Counter]:
    """Parse + redact. Nothing un-redacted leaves this function."""
    capture_id = capture_id or capture_id_for(path)
    modality, pieces = _pieces(path)
    removed: Counter = Counter()
    segments = []
    for n, (speaker, text, anchor) in enumerate(pieces, 1):
        clean, found = redact(text)
        removed.update(found)
        if clean.strip():
            segments.append(Segment(id=f"{capture_id}#{n}", capture_id=capture_id, modality=modality,
                                    text=clean.strip(), speaker=speaker, anchor=anchor,
                                    source_file=path.as_posix()))
    return segments, removed


def _fmt_time(seconds: float) -> str:
    m, s = divmod(int(seconds), 60)
    return f"{m:02d}:{s:02d}"


def citation_for(seg: Segment, meta: CaptureMeta) -> str:
    a = seg.anchor
    if "t_start" in a:
        return f"{meta.title} · {_fmt_time(a['t_start'])}"
    if "paragraph" in a:
        return f"{meta.title} · Abschnitt {a['paragraph']}"
    if "mail" in a:
        return f"{meta.title} · Mail {a['mail']}: {a.get('subject', '')}"
    if "page" in a:
        return f"{meta.title} · Seite {a['page']}"
    if "section" in a:
        return f"{meta.title} · {a['section']}"
    return meta.title


def to_documents(segments: list[Segment], meta: CaptureMeta) -> list[Document]:
    people = load_personas()
    owner_name = people.get(meta.persona or "", {}).get("name", "")
    return [
        Document(
            page_content=s.text,
            metadata={
                "chunk_id": s.id,
                "source_type": "segment",
                "source_id": s.capture_id,
                "title": meta.title,
                "category": meta.category,
                "department": meta.department,
                "access": meta.access,
                "status": meta.status,
                "valid_from": meta.valid_from,
                "valid_to": meta.valid_to,
                "supersedes": meta.supersedes,
                "modality": s.modality,
                "speaker": s.speaker,
                "anchor": s.anchor,
                "source_file": s.source_file,
                "owner": meta.persona,
                "owner_name": owner_name,
                "question_ids": [],
                "fact_ids": meta.fact_ids,
                "citation": citation_for(s, meta),
            },
        )
        for s in segments
    ]


def ingest_file(path: Path, meta: CaptureMeta, capture_id: str | None = None) -> dict:
    """Parse, redact and index one file. Replaces an earlier version of the same capture."""
    segments, removed = to_segments(path, capture_id)
    cid = capture_id or capture_id_for(path)
    delete_source(cid)
    n = index_documents(to_documents(segments, meta)) if segments else 0
    return {"capture_id": cid, "segments": n, "redacted": dict(removed), "title": meta.title}


# ---------------------------------------------------------------- synthetic data (manifest)

KIND_DE = {
    "long_handover": "Übergabe-Interview", "short_priorities": "Interview Prioritäten",
    "process_walkthrough": "Interview Abläufe", "tips_and_tricks": "Interview Tipps",
    "onboarding_retro": "Interview Einarbeitung", "checklist_audio": "Checklisten-Interview",
    "screen_recording": "Bildschirmaufnahme", "email_thread": "E-Mail-Verlauf",
}


def _meta_from_manifest(e: dict, facts: dict, people: dict, rules: dict) -> CaptureMeta:
    cats = Counter(facts[f]["category"] for f in e.get("fact_ids", []) if f in facts)
    if e.get("title"):
        title = e["title"]
    else:
        who = people.get(e.get("persona") or "", {}).get("name", "")
        part = re.search(r"_part(\d+)", e["file"])
        title = f"{KIND_DE.get(e.get('interview_type'), 'Quelle')} {who}".strip()
        if part:
            title += f", Teil {part.group(1)}"
    valid_to = e.get("valid_to")
    expired = bool(valid_to) and valid_to < date.today().isoformat()
    rule_ids = e.get("rule_ids") or []
    supersedes = None
    is_rule_doc = "doc_rule_" in e["file"]  # only rule documents replace each other
    if is_rule_doc and len(rule_ids) == 1 and (old := rules.get(rule_ids[0], {}).get("supersedes")):
        supersedes = f"doc_rule_{old}"  # capture id of the replaced rule document
    return CaptureMeta(title=title, persona=e.get("persona"), department=e.get("department", "ALL"),
                       access=e.get("access", "internal"),
                       category=cats.most_common(1)[0][0] if cats else "general",
                       fact_ids=e.get("fact_ids", []),
                       status="superseded" if expired else "current",
                       valid_from=e.get("valid_from"), valid_to=valid_to, supersedes=supersedes)


def ingest_manifest(manifest: Path = REPO_ROOT / "data" / "manifest.jsonl", only=None) -> list[dict]:
    """Ingest every generated source. Uses the real media file when Person C has rendered it
    (audio/video -> Whisper timestamps), otherwise the text transcript."""
    import yaml

    facts = {f["id"]: f for f in yaml.safe_load(
        (REPO_ROOT / "data" / "facts" / "facts.yaml").read_text(encoding="utf-8"))["facts"]}
    rules = {r["id"]: r for r in yaml.safe_load(
        (REPO_ROOT / "data" / "rules" / "rules.yaml").read_text(encoding="utf-8"))["rules"]}
    people = load_personas()
    results = []
    for line in manifest.read_text(encoding="utf-8").splitlines():
        e = json.loads(line)
        media = REPO_ROOT / e["file"]
        path = media if media.exists() else REPO_ROOT / (e.get("transcript") or e["file"])
        if only and not any(o in path.name for o in only):
            continue
        if not path.exists():
            results.append({"file": e["file"], "error": "missing"})
            continue
        meta = _meta_from_manifest(e, facts, people, rules)
        r = ingest_file(path, meta, capture_id=capture_id_for(Path(e["file"])))
        results.append({"file": path.relative_to(REPO_ROOT).as_posix(), **r})
    return results

