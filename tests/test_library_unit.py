"""Knowledge library without LLM/Qdrant: posts are redacted, indexed via learn(), resolvable."""

from hilde import library


def test_post_is_instant_then_indexed_and_resolvable(tmp_path, monkeypatch):
    monkeypatch.setattr(library, "PATH", tmp_path / "library.json")
    learned, statuses = [], []
    monkeypatch.setattr(library, "learn", lambda req: learned.append(req) or {"capture_id": "learned-abc"})
    monkeypatch.setattr(library, "set_status_for", lambda sid, st: statuses.append((sid, st)))

    post = library.add(library.PostIn(user_id="p13", category="it",
                                      text="Drucker 2. OG defekt. Erstattung ging an DE89 3704 0044 0532 0130 00."))
    assert "DE89" not in post.text and post.author == "Jonas Albers"
    assert learned == []  # posting returns at once; indexing is a separate background job
    assert [p.id for p in library.list_posts()] == [post.id]

    library.index(post.id)
    assert learned[0].via == "library" and learned[0].category == "it"
    assert library.list_posts()[0].capture_id == "learned-abc"

    library.resolve(post.id)
    assert statuses == [("learned-abc", "superseded")]  # Finn stops repeating it, history stays
    assert library.list_posts()[0].resolved


def test_unknown_topic_falls_back_to_general(tmp_path, monkeypatch):
    monkeypatch.setattr(library, "PATH", tmp_path / "library.json")
    monkeypatch.setattr(library, "learn", lambda req: {"capture_id": "x"})
    assert library.add(library.PostIn(user_id="p05", text="Schranke defekt", category="foo")).category == "general"


def test_resolved_while_indexing_is_superseded_after_indexing(tmp_path, monkeypatch):
    monkeypatch.setattr(library, "PATH", tmp_path / "library.json")
    statuses = []
    monkeypatch.setattr(library, "learn", lambda req: {"capture_id": "learned-x"})
    monkeypatch.setattr(library, "set_status_for", lambda sid, st: statuses.append((sid, st)))
    post = library.add(library.PostIn(user_id="p05", text="Schranke defekt", category="general"))
    library.resolve(post.id)  # not indexed yet: nothing to mark
    library.index(post.id)
    assert statuses == [("learned-x", "superseded")]


def test_failed_indexing_is_retried_and_picked_up_again(tmp_path, monkeypatch):
    """A post is never lost: indexing retries, and an unindexed post is offered again later."""
    monkeypatch.setattr(library, "PATH", tmp_path / "library.json")
    monkeypatch.setattr(library.time, "sleep", lambda s: None)
    calls = []

    def flaky(req):
        calls.append(req)
        if len(calls) < 2:
            raise RuntimeError("ollama busy")
        return {"capture_id": "learned-retry"}

    monkeypatch.setattr(library, "learn", flaky)
    post = library.add(library.PostIn(user_id="p05", text="Kantine heute zu", category="general"))
    assert library.unindexed() == []  # its job is already scheduled
    library.index(post.id)
    assert len(calls) == 2 and library.list_posts()[0].capture_id == "learned-retry"

    monkeypatch.setattr(library, "learn", lambda req: (_ for _ in ()).throw(RuntimeError("down")))
    other = library.add(library.PostIn(user_id="p05", text="Aufzug defekt", category="general"))
    library.index(other.id)  # all tries fail: the post stays listed, unindexed
    assert len(library.list_posts()) == 2
    assert library.unindexed() == [other.id]  # offered again on the next list
