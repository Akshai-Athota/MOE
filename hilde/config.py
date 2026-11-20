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
    llm_temperature: float = 0.1
    llm_num_ctx: int = 8192

    # --- Qdrant ---
    qdrant_url: str = "http://localhost:6333"
    qdrant_api_key: str | None = None
    qdrant_collection: str = "hilde_knowledge"

    # --- Paths ---
    data_dir: Path = REPO_ROOT / "data"


@lru_cache
def get_settings() -> Settings:
    return Settings()
