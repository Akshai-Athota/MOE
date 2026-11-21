"""Central settings. Values come from environment variables or the `.env` file.

Never hard-code secrets; QDRANT_API_KEY lives only in `.env` (git-ignored).
"""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=REPO_ROOT / ".env", env_file_encoding="utf-8", extra="ignore"
    )

    # --- Ollama (open-source models, served locally) ---
    # Inside Docker, set OLLAMA_BASE_URL=http://host.docker.internal:11434
    ollama_base_url: str = "http://localhost:11434"
    llm_model: str = "qwen3:8b"
    # qwen3 "thinks" before answering by default: slow and unneeded for structured output
    llm_reasoning: bool = False
    embed_model: str = "bge-m3"
    embed_dim: int = 1024  # bge-m3 dense vector size
    # Qwen3 recommended sampling for non-thinking mode
    llm_temperature: float = 0.7
    llm_top_p: float = 0.8
    llm_top_k: int = 20
    llm_seed: int = 42  # fixed seed keeps answers fairly stable for the demo
    llm_num_ctx: int = 8192
    # 6 GB GPUs cannot hold the LLM and bge-m3 together -> Ollama swaps them on every
    # question (~20 s). Running the embedder on CPU keeps the LLM resident on the GPU.
    embed_on_cpu: bool = True
    keep_alive_s: int = 1800  # seconds a model stays loaded

    # --- Answering ---
    # "I don't know" is retried with a broader search, but only for questions about the office:
    # below this bge-m3 cosine (best match in the whole knowledge base) a question is off-topic.
    relevance_min_score: float = 0.45
    answer_retries: int = 3
    # onboarding questions from the hackathon questionnaire: cached answers, curated sources first
    template_cache: bool = True

    # --- Ingestion ---
    whisper_model: str = "small"  # faster-whisper on CPU/int8; "medium" = better, slower
    vision_model: str = "qwen3-vl:4b"  # Ollama vision model for images (pull before use)

    # --- Qdrant ---
    qdrant_url: str = "http://localhost:6333"
    qdrant_api_key: str | None = None
    qdrant_collection: str = "hilde_knowledge"

    # --- Paths ---
    data_dir: Path = REPO_ROOT / "data"


@lru_cache
def get_settings() -> Settings:
    return Settings()
