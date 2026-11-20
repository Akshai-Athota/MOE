"""Answer-graph logic without LLM calls."""

from hilde.answer import Generated, Sentence, cite, route_generated
from hilde.schemas import Hit


def _hit(sid, status="current", **md):
    return Hit(chunk_id=sid, text=f"text {sid}", score=1, source_type="fact", source_id=sid,
               citation=f"cite {sid}", access="internal", status=status,
               metadata={"valid_from": "2026-07-01", **md})


def test_sentences_without_valid_source_are_dropped():
    g = Generated(answerable=True, sentences=[
        Sentence(text="belegt", sources=[2]),
        Sentence(text="erfunden", sources=[]),
        Sentence(text="falsche Nummer", sources=[9]),
    ])
    assert g.valid_sentences(3) == [("belegt", [2])]


def test_route_abstains_without_valid_sentences():
    hits = [_hit("F1")]
    assert route_generated({"hits": hits, "generated": Generated(answerable=False)}) == "abstain"
    no_src = Generated(answerable=True, sentences=[Sentence(text="x", sources=[])])
    assert route_generated({"hits": hits, "generated": no_src}) == "abstain"
    ok = Generated(answerable=True, sentences=[Sentence(text="x", sources=[1])])
    assert route_generated({"hits": hits, "generated": ok}) == "verify"


def test_cite_renumbers_and_reports_changes():
    hits = [_hit("p13"), _hit("F012", "superseded"), _hit("F013", supersedes="F012")]
    g = Generated(answerable=True, sentences=[Sentence(text="Bis 10.000 €.", sources=[3])])
    out = cite({"question": "q", "hits": hits, "generated": g, "history": {3: hits[1]}})["result"]
    assert out.answer == "Bis 10.000 €. [1]"
    assert [c.source_id for c in out.citations] == ["F013"]
    assert out.changes[0].previous_source_id == "F012"


def test_conflict_flag_from_source_status():
    hits = [_hit("F080", "conflict"), _hit("F081", "conflict")]
    g = Generated(answerable=True, sentences=[Sentence(text="a", sources=[1]),
                                               Sentence(text="b", sources=[2])])
    assert cite({"question": "q", "hits": hits, "generated": g, "history": {}})["result"].conflict
