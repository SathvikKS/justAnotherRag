# Runbook

## Prerequisites

- `uv`
- Docker Compose for container runs
- Node.js/npm for local frontend development
- Redis for local non-Docker ingestion
- service `.env` files copied from each service's `.env.example`

## Environment

Each service reads `.env` from its own current directory. API and ingestion also preload their service-local `.env` before importing shared settings so `LANCEDB_URI` does not fall back to package defaults. Copy each service's example when setting it up:

- `api/.env.example` -> `api/.env`
- `ingestion/.env.example` -> `ingestion/.env`
- `embedding/.env.example` -> `embedding/.env`
- `llm/.env.example` -> `llm/.env`

Shared values that must match:

```env
LANCEDB_URI=../lancedb_data
LANCEDB_TABLE=document_chunks
EMBEDDING_MODEL=BAAI/bge-small-en-v1.5
EMBEDDING_GRPC_URL=localhost:50051
LLM_PROVIDER=mock
LLM_GRPC_URL=localhost:50052
LLM_MODEL=Qwen/Qwen2.5-3B-Instruct
LLM_MAX_TOKENS=512
VLLM_GPU_MEMORY_UTIL=0.88
CELERY_BROKER_URL=redis://localhost:6379/0
CELERY_RESULT_BACKEND=redis://localhost:6379/0
```

Compose also reads those service `.env` files with `env_file`. It overrides hostnames to Docker network names: `redis_broker:6379`, `embedding_service:50051`, and `llm_service:50052`.

If Redis requires a password, put the same passworded Redis URLs in `api/.env` and `ingestion/.env`.

## Local Services

API:

```powershell
cd api
copy .env.example .env
uv sync
uv run uvicorn rag_api.routes:app --reload
```

Ingestion worker:

```powershell
cd ingestion
copy .env.example .env
uv sync
uv run celery -A rag_ingestion.tasks.celery_app worker --loglevel=info --pool=solo
```

Embedding service:

```powershell
cd embedding
copy .env.example .env
uv sync --extra cpu
uv run python -m rag_embedding.server
```

LLM mock:

```powershell
cd llm
copy .env.example .env
uv sync --extra mock
uv run python -m rag_llm.mock_server
```

Set `LLM_PROVIDER=mock` before starting the API to route `/chat` to the mock server. The mock returns `Mock answer for: <query>` and is for local API/frontend checks, not production.

LLM GPU (Linux/WSL2):

```powershell
cd llm
copy .env.example .env
uv sync --extra gpu --index-strategy unsafe-best-match
uv run python -m rag_llm.serve
```

LLM CPU (Linux/WSL2):

```powershell
cd llm
copy .env.example .env
VLLM_TARGET_DEVICE=cpu uv sync --extra cpu --torch-backend cpu
uv run python -m rag_llm.serve
```

The `llm/pyproject.toml` extras route `vllm` and `torch` to different indexes:

- `gpu`: `https://wheels.vllm.ai/0.23.0/cu129` and `https://download.pytorch.org/whl/cu129`
- `cpu`: `https://wheels.vllm.ai/0.23.0/cpu` and `https://download.pytorch.org/whl/cpu`

The gRPC server defaults to `Qwen/Qwen2.5-3B-Instruct`; override with `LLM_MODEL`. `VLLM_GPU_MEMORY_UTIL` defaults to `0.88` and maps to vLLM `--gpu-memory-utilization`; lower it to reduce VRAM reserved for KV cache/CUDA graph pools, or raise it only if the GPU has enough headroom.

On Windows, use WSL2, Docker CPU mode, or the mock server for local LLM work.

On Windows, use `--pool=solo` for Celery local development.

## Docker

GPU:

```powershell
docker compose up --build
```

CPU:

```powershell
docker compose -f docker-compose.yml -f docker-compose.cpu.yml up --build
```

Validate config:

```powershell
docker compose config
docker compose -f docker-compose.yml -f docker-compose.cpu.yml config
```

## Health Checks

API docs:

```powershell
curl http://localhost:8000/docs
```

Worker ping:

```powershell
cd ingestion
uv run celery -A rag_ingestion.tasks.celery_app inspect ping
```

Registered task should include:

```text
rag_ingestion.tasks.process_document_task
```

## Upload And Chat

Upload:

```powershell
curl -X POST http://localhost:8000/upload -F "file=@doc.pdf" -F "group_id=demo"
```

Poll:

```powershell
curl http://localhost:8000/status/<task_id>
```

Chat:

```powershell
curl -X POST http://localhost:8000/chat -H "Content-Type: application/json" -d "{\"query\":\"What is this document about?\",\"group_id\":\"demo\",\"limit\":5}"
```

Response has `answer` and `sources`.

Greeting and assistant small-talk queries such as `hi`, `who are you`, and `where are you` bypass retrieval and return no sources.

The web chat shows a grounding badge on assistant messages. Chat settings let users choose the retrieval limit (`5` by default) and toggle citation enforcement per request. The prompt always asks for `[n]` citations on document-backed answers; enforcement only decides whether uncited answers are accepted or rejected. Document-backed answers are labelled `Cited` or `Uncited` based on whether valid citations were found. When citation enforcement is on, uncited document answers are replaced with `I don't have enough information in the provided documents.` and the raw rejected answer is available in an expandable debug panel. `No document sources supplied` means the answer did not use retrieved chunks.

List indexed groups:

```powershell
curl http://localhost:8000/groups
```

Inspect one group:

```powershell
curl http://localhost:8000/groups/demo
```

List files in a group:

```powershell
curl http://localhost:8000/groups/demo/files
```

Delete one file's embeddings:

```powershell
curl -X DELETE http://localhost:8000/groups/demo/files/<file_id>
```

Delete all embeddings in a group:

```powershell
curl -X DELETE http://localhost:8000/groups/demo
```

Deletes are permanent. Re-uploading the same filename creates a new `file_id`.

Debug retrieval:

```powershell
curl -X POST http://localhost:8000/debug/search -H "Content-Type: application/json" -d "{\"query\":\"What is this document about?\",\"group_id\":\"demo\",\"limit\":5}"
```

## Troubleshooting

`/status/{task_id}` stays `PENDING`:

- Start `ingestion_worker`.
- Confirm API and worker use the same Redis URLs.
- Confirm the worker registered `rag_ingestion.tasks.process_document_task`.
- Restart API and worker after `.env` changes.

`/chat` fails:

- Confirm `embedding_service` is reachable from API.
- Confirm `llm_service` is reachable from API.
- If using mock mode, confirm API has `LLM_PROVIDER=mock`.
- Confirm LanceDB URI and AWS settings are valid.
- Use `/debug/search` to inspect raw retrieved chunks and score fields.
- If greetings produce document sources, confirm the API process is running the latest code.

Worker failure:

- Malformed PDF.
- Image-only PDF with no extractable text.
- Extracted text filtered as mojibake/low-signal text.
- Embedding model download/cache failure.
- LanceDB write failure.
- `RESOURCE_EXHAUSTED` (gRPC message larger than max 4MB). Resolved by batching embedding requests in chunks of 128 in `EmbeddingClient.embed_texts`.

## Tests

```powershell
uv run pytest -q -p no:cacheprovider
```

Current expected result:

```text
30 passed
```
