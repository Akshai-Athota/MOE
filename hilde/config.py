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
    llm_model: str = "qwen2.5:7b"
    embed_model: str = "bge-m3"
    embed_dim: int = 1024  # bge-m3 dense vector size
    llm_temperature: float = 0.0
    llm_seed: int = 42  # with temperature 0 -> repeatable answers for demo and tests
    llm_num_ctx: int = 8192
    # 6 GB GPUs cannot hold qwen2.5:7b and bge-m3 together -> Ollama swaps them on every
    # question (~20 s). Running the embedder on CPU keeps the LLM resident on the GPU.
    embed_on_cpu: bool = True
    keep_alive_s: int = 1800  # seconds a model stays loaded

    # --- Qdrant ---
    qdrant_url: str = "http://localhost:6333"
    qdrant_api_key: str | None = None
    qdrant_collection: str = "hilde_knowledge"

    # --- Paths ---
    data_dir: Path = REPO_ROOT / "data"


@lru_cache
def get_settings() -> Settings:
    return Settings()
