FROM ghcr.io/astral-sh/uv:python3.11-bookworm

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PATH="/app/.venv/bin:$PATH"

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

COPY src ./src

CMD ["uvicorn", "src.api.routes:app", "--host", "0.0.0.0", "--port", "8000"]
