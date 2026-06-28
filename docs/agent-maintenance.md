# Agent Maintenance Guide

Agents must keep internal documentation current when changing architecture, runtime behavior, setup steps, or operational commands.

## Documentation Roles

- `README.md`: user-facing overview, setup, and basic API usage.
- `docs/architecture.md`: current implemented architecture and module boundaries.
- `docs/runbook.md`: exact commands, environment variables, Redis/Celery workflow, and troubleshooting.
- `docs/agent-maintenance.md`: rules for keeping docs current.
- `AGENTS.md` and `CLAUDE.md`: agent-facing mandate to maintain the docs.

## Required Updates

Update `README.md` when:

- Startup steps change.
- Public endpoint usage changes.
- Required services or environment variables change.
- The app gains a new user-visible capability.

Update `docs/architecture.md` when:

- Module responsibilities change.
- API, worker, parser, embedder, vector store, or LLM flow changes.
- Storage schema changes.
- A service implementation changes its key behavior.
- A new abstraction or vendor implementation is added.

Update `docs/runbook.md` when:

- Commands change.
- Redis, Celery, LanceDB, model, or Docker setup changes.
- New troubleshooting knowledge is discovered.
- Test commands or expected test behavior changes.

Update `AGENTS.md` and `CLAUDE.md` when:

- The agent workflow changes.
- Documentation requirements change.
- New mandatory project rituals are added.

## Before Finishing Any Change

Check whether the change affects:

- How to run the app.
- How to start workers or dependencies.
- Environment variables.
- Public API endpoints.
- Request or response shapes.
- Data storage layout or schema.
- Architectural boundaries.
- Tests or verification commands.
- Common troubleshooting steps.

If yes, update the matching docs in the same change.

## Current Project Facts To Preserve

- FastAPI and Celery are separate runtime processes.
- `uvicorn` alone does not process document uploads.
- Redis is used for both Celery broker and result backend.
- API and worker must share the same Redis URLs.
- `/upload` returns a Celery task id, not ingestion results.
- `/status/{task_id}` reads Celery state.
- `rag_api.app:app` is the API entrypoint; `rag_api.routes` owns only the router.
- `API_KEY` enables simple `X-API-Key` auth for mounted MCP requests only.
- MCP is mounted at `/mcp` and must keep using shared providers/helpers rather than calling REST handlers.
- `/chat` returns a generated `answer` and retrieval `sources`.
- `/chat` bypasses retrieval for simple greetings.
- `/chat` supports request-level citation enforcement; keep it off by default unless the UI/request enables it.
- vLLM prompts should use tokenizer chat templates when available, not hard-coded per-model templates.
- Group/file CRUD endpoints delete LanceDB chunk rows permanently.
- Re-uploading the same filename creates a new `file_id`.
- API and ingestion must not import SentenceTransformers, Torch, or vLLM.
- Embedding model dependencies live in `embedding/`.
- Docling OCR and parser state are loaded once per ingestion worker process, not shared across Celery processes.
- If `DOCLING_WARMUP_ENABLED=true`, ingestion also performs a startup warmup conversion once per worker process.
- vLLM dependencies live in `llm/`.
- GPU-backed ingestion would multiply VRAM usage with Celery process concurrency, so document any concurrency or accelerator changes together.
- Mock LLM mode requires `LLM_PROVIDER=mock` on the API process.
- LanceDB vectors are fixed at 384 dimensions.
- `group_id` must stay validated before LanceDB filtering.

## Rule Of Thumb

If a new chat session would need to rediscover it, document it.
