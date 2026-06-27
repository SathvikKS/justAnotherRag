FROM ghcr.io/astral-sh/uv:python3.11-bookworm

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PATH="/app/.venv/bin:$PATH"

COPY pyproject.toml uv.lock ./
COPY embedding ./embedding
COPY packages ./packages
RUN uv sync --frozen --package rag-embedding --extra cpu --no-dev

CMD ["python", "-m", "rag_embedding.server"]
