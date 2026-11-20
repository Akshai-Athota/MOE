"""Knowledge library without LLM/Qdrant: posts are redacted, indexed via learn(), resolvable."""

from hilde import library


def test_post_is_redacted_indexed_and_resolvable(tmp_path, monkeypatch):
    monkeypatch.setattr(library, "PATH", tmp_path / "library.json")
    learned, statuses = [], []
    monkeypatch.setattr(library, "learn", lambda req: learned.append(req) or {"capture_id": "learned-abc"})
    monkeypatch.setattr(library, "set_status_for", lambda sid, st: statuses.append((sid, st)))

    post = library.add(library.PostIn(user_id="p13", category="it",
                                      text="Drucker 2. OG defekt. Erstattung ging an DE89 3704 0044 0532 0130 00."))
    assert "DE89" not in post.text and post.author == "Jonas Albers"
    assert learned[0].via == "library" and learned[0].category == "it"
    assert [p.id for p in library.list_posts()] == [post.id]

    library.resolve(post.id)
    assert statuses == [("learned-abc", "superseded")]  # Finn stops repeating it, history stays
    assert library.list_posts()[0].resolved


def test_unknown_topic_falls_back_to_general(tmp_path, monkeypatch):
    monkeypatch.setattr(library, "PATH", tmp_path / "library.json")
    monkeypatch.setattr(library, "learn", lambda req: {"capture_id": "x"})
    assert library.add(library.PostIn(user_id="p05", text="Schranke defekt", category="foo")).category == "general"
