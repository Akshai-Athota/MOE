"""Turn files into raw pieces: (speaker, text, anchor). One function per format.

Anchors point back into the source, so every answer can cite "Interview Reinecke · 04:12",
"Hausverfügung HV-2026-07 · 2. Regelungen" or "Seite 3".
"""

import re
from functools import lru_cache
from pathlib import Path

from hilde.config import get_settings

Piece = tuple[str | None, str, dict]  # (speaker, text, anchor)

SPEAKER = re.compile(r"^([A-ZÄÖÜ][\wÄÖÜäöüß.\- ]{0,40}):\s+(.*)", re.DOTALL)


def parse_transcript(path: Path) -> list[Piece]:
    """'Name: text' paragraphs. Interviewer questions are merged with the answer that follows,
    so each piece is a self-contained Q+A. Anchor = paragraph number of the answer (1-based)."""
    paragraphs = [p.strip() for p in path.read_text(encoding="utf-8").split("\n\n") if p.strip()]
    pieces: list[Piece] = []
    pending_question = ""
    for n, para in enumerate(paragraphs, 1):
        m = SPEAKER.match(para)
        speaker, _text = (m.group(1), m.group(2)) if m else (None, para)
        if speaker == "Hilde":
            pending_question = para
            continue
        body = f"{pending_question}\n{para}" if pending_question else para
        pieces.append((speaker, body, {"paragraph": n}))
        pending_question = ""
    return pieces


def parse_email_thread(path: Path) -> list[Piece]:
    """One piece per mail (mails start with 'Von:'). Anchor = mail number + subject."""
    text = path.read_text(encoding="utf-8")
    mails = [m.strip() for m in re.split(r"\n(?=Von: )", "\n" + text) if m.strip()]
    pieces = []
    for n, mail in enumerate(mails, 1):
        sender = re.search(r"^Von: ([^<\n]+)", mail, re.MULTILINE)
        subject = re.search(r"^Betreff: (.+)$", mail, re.MULTILINE)
        pieces.append((sender.group(1).strip() if sender else None, mail,
                       {"mail": n, "subject": subject.group(1).strip() if subject else ""}))
    return pieces


def parse_markdown(path: Path) -> tuple[str, list[Piece]]:
    """Split at '## ' headings. Returns (document title, pieces). Anchor = section heading."""
    text = path.read_text(encoding="utf-8")
    title_m = re.search(r"^# (.+)$", text, re.MULTILINE)
    title = title_m.group(1).strip() if title_m else path.stem
    parts = re.split(r"^## ", text, flags=re.MULTILINE)
    head, sections = parts[0], parts[1:]
    pieces: list[Piece] = []
    preamble = re.sub(r"^# .+$", "", head, flags=re.MULTILINE).strip()
    if preamble:
        pieces.append((None, f"{title}\n{preamble}", {"section": "Kopf"}))
    for s in sections:
        heading, _, body = s.partition("\n")
        if body.strip():
            pieces.append((None, f"{title} – {heading.strip()}\n{body.strip()}",
                           {"section": heading.strip()}))
    return title, pieces


def parse_pdf(path: Path) -> list[Piece]:
    from pypdf import PdfReader

    return [(None, page.extract_text() or "", {"page": n})
            for n, page in enumerate(PdfReader(path).pages, 1) if (page.extract_text() or "").strip()]


def parse_docx(path: Path) -> list[Piece]:
    """Group paragraphs under their nearest heading. Anchor = heading text."""
    from docx import Document

    pieces: list[Piece] = []
    heading, buf = "Anfang", []
    for para in Document(path).paragraphs:
        if para.style.name.lower().startswith("heading") or para.style.name.startswith("Überschrift"):
            if buf:
                pieces.append((None, f"{heading}\n" + "\n".join(buf), {"section": heading}))
            heading, buf = para.text.strip(), []
        elif para.text.strip():
            buf.append(para.text.strip())
    if buf:
        pieces.append((None, f"{heading}\n" + "\n".join(buf), {"section": heading}))
    return pieces


@lru_cache
def _whisper():
    from faster_whisper import WhisperModel

    s = get_settings()
    # CPU + int8 keeps the GPU free for the LLM (6 GB card)
    return WhisperModel(s.whisper_model, device="cpu", compute_type="int8")


def transcribe(path: Path, window_s: float = 40.0) -> list[Piece]:
    """Audio/video -> pieces of ~40 s, anchored with start/end seconds."""
    segments, _info = _whisper().transcribe(str(path), language="de", vad_filter=True)
    pieces: list[Piece] = []
    buf, start, end = [], None, 0.0
    for seg in segments:
        start = seg.start if start is None else start
        buf.append(seg.text.strip())
        end = seg.end
        if end - start >= window_s:
            pieces.append((None, " ".join(buf), {"t_start": round(start, 1), "t_end": round(end, 1)}))
            buf, start = [], None
    if buf:
        pieces.append((None, " ".join(buf), {"t_start": round(start or 0, 1), "t_end": round(end, 1)}))
    return pieces


DESCRIBE_IMAGE = """Beschreibe dieses Bild aus einer Behörde sachlich auf Deutsch.
Gib allen lesbaren Text wörtlich wieder (Überschriften, Namen, Pfeile, Beträge, Daten).
Ist es ein Organigramm, Ablaufplan oder Whiteboard, beschreibe die Struktur: wer/was ist womit verbunden."""


def describe_image(path: Path) -> list[Piece]:
    """Image -> text via a local Ollama vision model (VISION_MODEL, e.g. qwen3-vl:4b)."""
    import base64

    import httpx

    s = get_settings()
    r = httpx.post(f"{s.ollama_base_url}/api/generate", timeout=300, json={
        "model": s.vision_model, "prompt": DESCRIBE_IMAGE, "stream": False,
        "images": [base64.b64encode(path.read_bytes()).decode()],
        "think": False,  # qwen3-vl would otherwise reason at length before describing
        "options": {"temperature": 0}, "keep_alive": 0,  # unload: frees VRAM for the LLM
    })
    if r.status_code == 404:
        raise RuntimeError(f"vision model '{s.vision_model}' not pulled: ollama pull {s.vision_model}")
    r.raise_for_status()
    return [(None, r.json()["response"].strip(), {"image": path.name})]
