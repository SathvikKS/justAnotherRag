# Local RAG

Local RAG app for PDF ingestion and generated answers over indexed document groups.

The Python side is a uv workspace with separate root services:

- `api/`: FastAPI HTTP API.
- `ingestion/`: Celery PDF ingestion worker.
- `embedding/`: gRPC SentenceTransformers embedding service.
- `llm/`: vLLM gRPC launcher plus mock server.
- `packages/`: shared config, LanceDB storage, and gRPC clients.
- `rag-web/`: Vite React client.

## What Works Today

- Upload PDFs and assign them to a `group_id`.
- Process uploads in `ingestion_worker`.
- Parse PDFs with `pypdf` and split into 512-character chunks.
- Embed queries and chunks through `embedding_service`.
- Store chunks in LanceDB with 384-dimensional vectors.
- Search LanceDB with hybrid vector plus text search, filtered by `group_id`.
- Generate `/chat` answers through `llm_service`.
- Run GPU-first Docker Compose, or add the CPU override.

## Environment

Each service owns its env file. Copy the service `.env.example` to `.env` inside the service directory you run from.

Important defaults:

```env
LANCEDB_URI=./lancedb_data
LANCEDB_TABLE=document_chunks
EMBEDDING_MODEL=BAAI/bge-small-en-v1.5
EMBEDDING_GRPC_URL=localhost:50051
LLM_PROVIDER=mock
LLM_GRPC_URL=localhost:50052
LLM_MODEL=Qwen/Qwen2.5-7B-Instruct
CELERY_BROKER_URL=redis://localhost:6379/0
CELERY_RESULT_BACKEND=redis://localhost:6379/0
```

For local filesystem LanceDB storage, set `LANCEDB_URI=./lancedb_data`.

If Redis requires a password, set the passworded `CELERY_BROKER_URL` and `CELERY_RESULT_BACKEND` in both `api/.env` and `ingestion/.env`.

## Local Dev

API:

```powershell
cd api
copy .env.example .env
uv sync
uv run uvicorn rag_api.routes:app --reload
```

Ingestion:

```powershell
cd ingestion
copy .env.example .env
uv sync
uv run celery -A rag_ingestion.tasks.celery_app worker --loglevel=info --pool=solo
```

Embedding:

```powershell
cd embedding
copy .env.example .env
uv sync --extra cpu
uv run python -m rag_embedding.server
```

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

LLM mock:

```powershell
cd llm
copy .env.example .env
uv sync --extra mock
uv run python -m rag_llm.mock_server
```

Set `LLM_PROVIDER=mock` in the API environment when using the mock server. It returns `Mock answer for: <query>` without loading vLLM.

Native vLLM CPU/GPU extras do not install on Windows. Use WSL2, Docker, or mock mode there.

Web:

```powershell
cd rag-web
npm run dev
```

## Docker

GPU default:

```powershell
docker compose up --build
```

CPU override:

```powershell
docker compose -f docker-compose.yml -f docker-compose.cpu.yml up --build
```

Services:

- API: `http://localhost:8000`
- Web client: `http://localhost:3000`
- Redis: `localhost:6379`
- vLLM gRPC: `localhost:50052`

Docker defaults to `Qwen/Qwen2.5-7B-Instruct` for GPU and `Qwen/Qwen2.5-1.5B-Instruct` for CPU. Override either with `LLM_MODEL`.

## API

Upload:

```powershell
curl -X POST http://localhost:8000/upload -F "file=@doc.pdf" -F "group_id=demo"
```

Chat:

```powershell
curl -X POST http://localhost:8000/chat -H "Content-Type: application/json" -d "{\"query\":\"What is this document about?\",\"group_id\":\"demo\",\"limit\":5}"
```

Response:

```json
{
  "query": "What is this document about?",
  "group_id": "demo",
  "answer": "...",
  "sources": []
}
```

## Test

```powershell
uv run pytest -q -p no:cacheprovider
```

Compose validation:

```powershell
docker compose config
docker compose -f docker-compose.yml -f docker-compose.cpu.yml config
```
