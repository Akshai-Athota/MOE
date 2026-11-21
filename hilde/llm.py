"""LangChain wrappers for the local Ollama models (LLM + embeddings)."""

from functools import lru_cache

import httpx
from langchain_ollama import ChatOllama, OllamaEmbeddings

from hilde.config import get_settings


@lru_cache
def get_llm() -> ChatOllama:
    s = get_settings()
    return ChatOllama(
        base_url=s.ollama_base_url,
        model=s.llm_model,
        temperature=s.llm_temperature,
        top_p=s.llm_top_p,
        top_k=s.llm_top_k,
        seed=s.llm_seed,
        num_ctx=s.llm_num_ctx,
        keep_alive=s.keep_alive_s,
        reasoning=s.llm_reasoning,
    )


@lru_cache
def get_embeddings() -> OllamaEmbeddings:
    s = get_settings()
    return OllamaEmbeddings(
        base_url=s.ollama_base_url,
        model=s.embed_model,
        keep_alive=s.keep_alive_s,
        num_gpu=0 if s.embed_on_cpu else None,
    )


def ollama_status() -> dict:
    """Is Ollama reachable, and are the configured models pulled?"""
    s = get_settings()
    try:
        r = httpx.get(f"{s.ollama_base_url}/api/tags", timeout=5)
        r.raise_for_status()
        names = {m["name"] for m in r.json().get("models", [])}
    except Exception as exc:  # noqa: BLE001 - report any connection problem
        return {"ok": False, "url": s.ollama_base_url, "error": str(exc)}

    def pulled(model: str) -> bool:
        # "bge-m3" matches "bge-m3:latest"
        return model in names or f"{model}:latest" in names

    missing = [m for m in (s.llm_model, s.embed_model) if not pulled(m)]
    return {
        "ok": not missing,
        "url": s.ollama_base_url,
        "models": sorted(names),
        "missing": missing,
    }
