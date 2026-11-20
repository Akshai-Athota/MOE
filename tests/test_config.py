from hilde.config import Settings


def test_defaults_without_env(monkeypatch):
    monkeypatch.delenv("QDRANT_URL", raising=False)
    s = Settings(_env_file=None)
    assert s.llm_model == "qwen2.5:7b"
    assert s.embed_model == "bge-m3"
    assert s.embed_dim == 1024


def test_env_overrides(monkeypatch):
    monkeypatch.setenv("LLM_MODEL", "qwen3:4b")
    assert Settings(_env_file=None).llm_model == "qwen3:4b"
