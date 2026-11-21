"""Avatars: a person stays part of the office after leaving: their photo and their (cloned) voice.

* Created only with explicit consent; deleting the avatar deletes photo, voice sample and audio.
* Everything lives in var/avatars/<id>/ (git-ignored: never leaves this machine).
* The avatar only *speaks* answers Finn found in the sources; it is always labelled as AI
  (EU AI Act: synthetic voice/image must be disclosed).
* Voice: XTTS-v2 (coqui-tts), zero-shot cloning from a 10-60 s sample, German + English.
  Optional dependency: uv sync --extra avatar. Model licence (CPML): non-commercial use only.
"""

import hashlib
import json
import re
import shutil
import threading
import uuid
from datetime import datetime
from functools import lru_cache
from pathlib import Path

from hilde.config import REPO_ROOT

DIR = REPO_ROOT / "var" / "avatars"
XTTS = "tts_models/multilingual/multi-dataset/xtts_v2"
_LOCK = threading.Lock()  # one synthesis at a time (one model, one GPU)


class AvatarError(RuntimeError):
    pass


# ---------------------------------------------------------------- storage

def _dir(aid: str) -> Path:
    if not re.fullmatch(r"[a-f0-9]{10}", aid):
        raise AvatarError("unknown avatar")
    return DIR / aid


def to_wav(src: Path, dst: Path, rate: int = 22050) -> None:
    """Any audio (browser webm/opus, mp3, m4a, wav) -> mono WAV. Uses PyAV (comes with faster-whisper)."""
    import av
    import numpy as np
    import soundfile as sf

    with av.open(str(src)) as c:
        res = av.AudioResampler(format="flt", layout="mono", rate=rate)
        chunks = []
        for frame in c.decode(audio=0):
            for f in res.resample(frame):
                chunks.append(f.to_ndarray().reshape(-1))
    if not chunks:
        raise AvatarError("the voice sample contains no audio")
    audio = np.concatenate(chunks)
    if len(audio) < rate * 5:
        raise AvatarError("the voice sample is too short: please record at least 10 seconds")
    sf.write(str(dst), audio, rate)


def create(name: str, persona_id: str | None, photo: bytes, photo_ext: str, voice: bytes,
           voice_ext: str, consent: bool) -> dict:
    if not consent:
        raise AvatarError("an avatar needs the person's explicit consent")
    aid = uuid.uuid4().hex[:10]
    d = DIR / aid
    d.mkdir(parents=True)
    try:
        ext = photo_ext.lower() if photo_ext.lower() in (".jpg", ".jpeg", ".png", ".webp") else ".jpg"
        (d / f"photo{ext}").write_bytes(photo)
        raw = d / f"voice_raw{voice_ext or '.webm'}"
        raw.write_bytes(voice)
        to_wav(raw, d / "voice.wav")
        raw.unlink()
    except Exception:
        shutil.rmtree(d, ignore_errors=True)
        raise
    meta = {
        "id": aid, "name": name, "persona_id": persona_id, "photo": f"photo{ext}",
        "created": datetime.now().isoformat(timespec="seconds"),
        "consent": {"given": True, "at": datetime.now().isoformat(timespec="seconds"),
                    "text": "Ich bin einverstanden, dass aus meinem Foto und meiner Stimme ein "
                            "gekennzeichneter KI-Avatar erstellt wird. Ich kann ihn jederzeit löschen lassen."},
        "label": f"KI-Avatar von {name} – synthetische Stimme",
    }
    (d / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    return meta


def get(aid: str) -> dict:
    p = _dir(aid) / "meta.json"
    if not p.exists():
        raise AvatarError("unknown avatar")
    return json.loads(p.read_text(encoding="utf-8"))


def list_all() -> list[dict]:
    if not DIR.exists():
        return []
    return [json.loads(m.read_text(encoding="utf-8")) for m in sorted(DIR.glob("*/meta.json"))]


def photo_path(aid: str) -> Path:
    return _dir(aid) / get(aid)["photo"]


def delete(aid: str) -> None:
    """Consent withdrawn: remove everything (photo, voice sample, generated audio)."""
    shutil.rmtree(_dir(aid), ignore_errors=True)


# ---------------------------------------------------------------- voice

@lru_cache
def _tts():
    import os

    os.environ.setdefault("COQUI_TOS_AGREED", "1")  # CPML, non-commercial (hackathon demo)
    import torch
    from TTS.api import TTS

    device = "cpu"
    if torch.cuda.is_available():
        free, _ = torch.cuda.mem_get_info()
        device = "cuda" if free > 2.5e9 else "cpu"  # the LLM may hold most of a 6 GB card
    return TTS(XTTS).to(device), device


def _speakable(text: str) -> str:
    """Strip what should not be read aloud: [1][2] citation marks, redaction markers."""
    text = re.sub(r"\s*\[\d+\]", "", text)
    text = re.sub(r"\[[^\]]+ entfernt\]", "(geschwärzt)", text)
    text = re.sub(r"\s+", " ", text).strip()
    # the voice runs on the CPU while the LLM holds the GPU (~20 s per sentence):
    # read the first two sentences aloud, the full answer stays on screen
    sentences = re.split(r"(?<=[.!?])\s+", text)
    return " ".join(sentences[:2])[:400]


def speak(aid: str, text: str, lang: str = "de") -> Path:
    """WAV of `text` in the avatar's voice (cached per text)."""
    d = _dir(aid)
    get(aid)  # exists?
    clean = _speakable(text)
    if not clean:
        raise AvatarError("nothing to say")
    key = hashlib.sha1(f"{lang}|{clean}".encode()).hexdigest()[:16]
    out = d / "audio" / f"{key}.wav"
    if out.exists():
        return out
    out.parent.mkdir(exist_ok=True)
    with _LOCK:
        tts, _device = _tts()
        tts.tts_to_file(text=clean, speaker_wav=str(d / "voice.wav"), language=lang, file_path=str(out))
    return out


def status() -> dict:
    """Is the voice stack installed? (it is an optional, large dependency)"""
    try:
        import torch
        import TTS  # noqa: F401
    except ImportError:
        return {"voice": False, "hint": "uv sync --extra avatar"}
    return {"voice": True, "cuda": torch.cuda.is_available()}
