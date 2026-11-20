# Hilde API image. Dependencies are managed with uv (pyproject.toml + uv.lock).
FROM ghcr.io/astral-sh/uv:python3.11-bookworm-slim

WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PYTHONUNBUFFERED=1

# 1) Install dependencies only (cached layer while code changes)
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

# 2) Copy code and data
COPY hilde ./hilde
COPY data ./data

ENV PATH="/app/.venv/bin:$PATH"
EXPOSE 8000
CMD ["uvicorn", "hilde.api.main:app", "--host", "0.0.0.0", "--port", "8000"]
