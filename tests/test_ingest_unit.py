"""Parsers + redaction without Qdrant/Ollama."""

from hilde.ingest.parsers import parse_email_thread, parse_markdown, parse_transcript
from hilde.ingest.pipeline import citation_for, to_segments
from hilde.redact import redact
from hilde.schemas import CaptureMeta, Segment

TRANSCRIPT = """Hilde: Hallo Wolfgang, danke, dass du dir Zeit nimmst.

Reinecke: Gern, Hilde.

Hilde: Wo liegt der Vertretungsplan?

Reinecke: Unter S:\\Amt\\Organisation\\Vertretungsplan.xlsx.

Hilde: Gibt es ein Beispiel?

Reinecke: Die Erstattung ging auf DE89 3704 0044 0532 0130 00, Steuernummer 30/215/12345.
"""


def test_transcript_pairs_question_with_answer(tmp_path):
    f = tmp_path / "t.txt"
    f.write_text(TRANSCRIPT, encoding="utf-8")
    pieces = parse_transcript(f)
    assert len(pieces) == 3
    speaker, text, anchor = pieces[1]
    assert speaker == "Reinecke" and anchor == {"paragraph": 4}
    assert text.startswith("Hilde: Wo liegt") and "Vertretungsplan.xlsx" in text


def test_redaction_removes_iban_and_tax_number_before_storage(tmp_path):
    f = tmp_path / "t.txt"
    f.write_text(TRANSCRIPT, encoding="utf-8")
    segments, removed = to_segments(f)
    joined = " ".join(s.text for s in segments)
    assert "DE89" not in joined and "30/215/12345" not in joined
    assert removed["IBAN"] == 1 and removed["STEUERNUMMER"] == 1
    assert "[IBAN entfernt]" in joined


def test_redact_keeps_normal_numbers():
    text, found = redact("Raum 1.05, Tel. 302-105, Grenze 10.000 € ab 01.07.2026")
    assert found == [] and "302-105" in text and "10.000" in text


def test_email_thread_one_piece_per_mail(tmp_path):
    f = tmp_path / "m.txt"
    f.write_text("Von: A <a@x>\nAn: b@x\nDatum: 20.11.2026\nBetreff: Eins\n\nText 1\n\n"
                 "Von: A <a@x>\nAn: b@x\nDatum: 19.11.2026\nBetreff: Zwei\n\nText 2\n", encoding="utf-8")
    pieces = parse_email_thread(f)
    assert [p[2]["subject"] for p in pieces] == ["Eins", "Zwei"]


def test_markdown_sections_and_citation(tmp_path):
    f = tmp_path / "d.md"
    f.write_text("# HV-1: Test\nKopfzeile\n\n## 1. Zweck\nA\n\n## 2. Regelungen\nB\n", encoding="utf-8")
    title, pieces = parse_markdown(f)
    assert title == "HV-1: Test" and [p[2]["section"] for p in pieces] == ["Kopf", "1. Zweck", "2. Regelungen"]
    seg = Segment(id="x#1", capture_id="x", modality="audio", text="t", anchor={"t_start": 252.1},
                  source_file="a.wav")
    assert citation_for(seg, CaptureMeta(title="Interview Reinecke")) == "Interview Reinecke · 04:12"


def test_redact_catches_asr_mangled_iban():
    text, found = redact("GING AUF DOSKANTO DE 893700 and 400440532013000")
    assert "400440532013000" not in text and "NUMMER" in found


def test_redact_names_keeps_colleagues_removes_taxpayers():
    from hilde.redact import redact

    text, found = redact("Der Fall von Herrn Dieter Konopka ging an Frau Krüger; "
                         "die Bäckerei Hollmann GmbH auch.")
    assert "Konopka" not in text and "Hollmann" not in text
    assert "Frau Krüger" in text
    assert "PERSON" in found and "UNTERNEHMEN" in found


def test_redact_names_with_llm_hints():
    from hilde.redact import redact_names

    text, _ = redact_names("Dieter Konopka stand in der Zeitung, Wolfgang Reinecke nicht.",
                           extra=["Dieter Konopka", "Wolfgang Reinecke"])
    assert "Konopka" not in text and "Wolfgang Reinecke" in text


def test_redact_names_leaves_roles_and_nouns():
    from hilde.redact import redact

    text, found = redact("Frau Vorsteherin zeichnet. Im Fall Rückfragen bitte Frau Schulte fragen.")
    assert found == [] and "Vorsteherin" in text and "Rückfragen" in text
