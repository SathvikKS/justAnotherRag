# Runbook

Operational notes for the current local app.

## Prerequisites

- Python managed by `uv`
- Redis on port `6379`
- A `.env` file in the repo root
- Two long-running processes for normal use:
  - FastAPI API server
  - Celery worker

## Environment

Password-protected Redis:

```env
LANCEDB_URI=./lancedb_data
LANCEDB_TABLE=document_chunks
EMBEDDING_MODEL=BAAI/bge-small-en-v1.5
CELERY_BROKER_URL=redis://:redis_password@localhost:6379/0
CELERY_RESULT_BACKEND=redis://:redis_password@localhost:6379/0
LLAMA_MODEL_PATH=model.gguf
```

Redis without password:

```env
CELERY_BROKER_URL=redis://localhost:6379/0
CELERY_RESULT_BACKEND=redis://localhost:6379/0
```

The API and worker both read `.env`, so restart both after editing it.

## Redis

The repo has a minimal `docker-compose.yml` with a non-password Redis service named `redis_broker`.

If using an existing password-protected Redis, this kind of compose service is also valid:

```yaml
services:
  redis:
    image: redis:7-alpine
    container_name: local_redis
    restart: unless-stopped
    command: redis-server --requirepass redis_password
    ports:
      - "6379:6379"
    volumes:
      - ./redis/data:/data
```

Use only one Redis service on port `6379`.

## Start The App

Terminal 1, API:

```powershell
uv run uvicorn src.api.routes:app --reload
```

Terminal 2, Celery worker:

```powershell
uv run celery -A src.workers.tasks.celery_app worker --loglevel=info --pool=solo
```

On Windows, keep `--pool=solo` for local development.

### Celery Concurrency & Pools (Windows vs. Production)

Understanding how the background tasks run and scale depending on your OS and environment:

#### 1. Windows Local Development (`--pool=solo`)
* **Why:** Python's process-spawning (`prefork`) pool in Celery is buggy and unstable on Windows. Using `--pool=solo` runs the worker in a single process, single-threaded execution model.
* **Concurrency:** Strictly sequential (1 task at a time). Setting `--concurrency` / `-c` has no effect.
* **Testing Concurrency on Windows:** If you want to test concurrent task execution on Windows:
  * **Option A (Multiple Workers):** Open multiple separate terminals and run workers with unique names:
    ```powershell
    uv run celery -A src.workers.tasks.celery_app worker --loglevel=info --pool=solo -n worker1@%h
    ```
  * **Option B (Thread Pool):** Run with `--pool=threads --concurrency=4`. Note that CPU-bound embedding generation will be throttled by Python's GIL, but it lets you test concurrent task routing.
  * **Option C (Docker/WSL2):** Run the API and Celery worker inside Docker or WSL2 to run a native Linux environment.

#### 2. Production Environment (`--pool=prefork`)
* **Why:** In production (on Linux or Docker containers), use the default `prefork` pool.
* **Concurrency:** Set `--concurrency=X` (typically matching the CPU core count). This spawns `X` independent worker processes.
* **GIL Bypass:** Because it uses separate processes rather than threads, it bypasses Python's Global Interpreter Lock (GIL). Multiple PDF extraction and embedding tasks will execute in true, 100% parallel speed.
* **Fault Isolation:** If a CPU-intensive C-library (e.g. PDF parser) encounters a hard crash, only that child process terminates. Celery automatically replaces it with a new process, keeping the worker online.

## Health Checks

Check the API:

```powershell
curl http://localhost:8000/docs
```

Check that a worker is registered:

```powershell
uv run celery -A src.workers.tasks.celery_app inspect ping
```

Expected: at least one worker replies.

List registered worker tasks:

```powershell
uv run celery -A src.workers.tasks.celery_app inspect registered
```

Expected task:

```text
src.workers.tasks.process_document_task
```

## Upload And Search

Upload:

```powershell
curl -X POST http://localhost:8000/upload -F "file=@doc.pdf" -F "group_id=demo"
```

Poll:

```powershell
curl http://localhost:8000/status/<task_id>
```

Search:

```powershell
curl -X POST http://localhost:8000/chat -H "Content-Type: application/json" -d "{\"query\":\"What is this document about?\",\"group_id\":\"demo\",\"limit\":5}"
```

## Debug `PENDING` Tasks

`PENDING` means Celery has no result history for that task id. It does not prove the task is waiting in a queue.

Check:

- The worker process is running.
- The worker command uses `-A src.workers.tasks.celery_app`.
- `inspect ping` returns a worker reply.
- `inspect registered` lists `src.workers.tasks.process_document_task`.
- API and worker use the same `CELERY_BROKER_URL`.
- API and worker use the same `CELERY_RESULT_BACKEND`.
- Redis password in `.env` matches the running Redis server.
- API and worker were both restarted after `.env` changes.

## Debug Upload Failures

`400 Only PDF files are supported`

- Filename must end with `.pdf`.

`400 group_id is required`

- `group_id` cannot be blank.

`400` or `422` for bad `group_id`

- Allowed characters: letters, digits, underscore, dot, hyphen.

Worker failure after task starts:

- Check the worker terminal logs.
- Common causes: malformed PDF, image-only PDF with no extractable text, embedding model download/cache issue, LanceDB write issue.

## LanceDB Data

Default local data path:

```text
./lancedb_data
```

This directory is ignored by git.

To reset local indexed data, stop API/worker first, then remove `lancedb_data`.

## Optional LLM Engine

The optional LLM package is declared as the `llm` extra:

```powershell
uv sync --extra llm
```

`LlamaCPPEngine` expects `LLAMA_MODEL_PATH` to point to a local GGUF file. This engine is currently not wired into `/chat`.

## Tests

Preferred:

```powershell
uv run pytest -q -p no:cacheprovider
```

Fallback if `uv run` is busy syncing optional native packages:

```powershell
.\.venv\Scripts\python.exe -m pytest -q -p no:cacheprovider
```

Current expected result:

```text
17 passed
```
