FROM ghcr.io/astral-sh/uv:python3.11-bookworm

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PATH="/app/.venv/bin:$PATH"

COPY pyproject.toml uv.lock ./
COPY ingestion ./ingestion
COPY packages ./packages
RUN uv sync --frozen --package rag-ingestion --no-dev

CMD ["celery", "-A", "rag_ingestion.tasks.celery_app", "worker", "--loglevel=info"]
