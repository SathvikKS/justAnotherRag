# Local RAG

Local RAG app for PDF ingestion and document search. It uses FastAPI for HTTP, Celery for background ingestion, Redis as broker/result backend, SentenceTransformers for embeddings, LanceDB for hybrid vector plus full-text search, and a Vite React client.

## What Works Today

- Upload PDF files and assign them to a `group_id`.
- Process uploads in a separate Celery worker.
- Parse PDFs with `pypdf`.
- Split extracted page text into 512-character chunks with 50-character overlap.
- Embed chunks with `BAAI/bge-small-en-v1.5` into 384-dimensional vectors.
- Store chunks in LanceDB with filename, page, group, text, vector, and chunk id.
- Search with LanceDB hybrid vector plus text search, prefiltered by `group_id`.
- Poll Celery task status by task id.
- Use the React client to upload PDFs, watch ingestion status, and query a group.
- Run the API, Redis, worker, and web client through Docker Compose.
- Point LanceDB at S3-style object storage with AWS credentials from the environment.
- Optional local `llama-cpp-python` engine exists behind `LlamaCPPEngine`, but `/chat` currently returns retrieved chunks, not generated answers.

## Docs

- [Architecture](docs/architecture.md)
- [Runbook](docs/runbook.md)
- [Agent maintenance guide](docs/agent-maintenance.md)

## Environment

Create `.env`:

```env
LANCEDB_URI=s3://app-vector-bucket
LANCEDB_TABLE=document_chunks
EMBEDDING_MODEL=BAAI/bge-small-en-v1.5
CELERY_BROKER_URL=redis://:redis_password@localhost:6379/0
CELERY_RESULT_BACKEND=redis://:redis_password@localhost:6379/0
LLAMA_MODEL_PATH=model.gguf
CORS_ORIGINS=http://localhost:3000,http://localhost:5173
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_SESSION_TOKEN=
AWS_REGION=us-east-1
AWS_ENDPOINT_URL=
VITE_API_BASE_URL=http://localhost:8000
```

For local filesystem LanceDB storage, set `LANCEDB_URI=./lancedb_data`.

For Redis without a password, use:

```env
CELERY_BROKER_URL=redis://localhost:6379/0
CELERY_RESULT_BACKEND=redis://localhost:6379/0
```

## Run Locally

Start Redis. The app can use any Redis reachable at the URLs in `.env`.

Start the API:

```powershell
uv run uvicorn src.api.routes:app --reload
```

Start the Celery worker in a second terminal:

```powershell
uv run celery -A src.workers.tasks.celery_app worker --loglevel=info --pool=solo
```

`uvicorn` alone is not enough. Uploads are queued into Redis; the Celery worker does the actual PDF parsing, embedding, and LanceDB writes.

Start the web client in a third terminal:

```powershell
cd rag-web
npm run dev
```

Open `http://localhost:5173`.

## Run With Docker Compose

```powershell
docker compose up --build
```

Services:

- API: `http://localhost:8000`
- Web client: `http://localhost:3000`
- Redis: `localhost:6379`

The worker service includes an NVIDIA GPU reservation. On CPU-only Docker hosts, remove the `ai_worker.deploy.resources.reservations.devices` block.

## Use The API

Upload a PDF:

```powershell
curl -X POST http://localhost:8000/upload -F "file=@doc.pdf" -F "group_id=demo"
```

Response:

```json
{"task_id":"<celery-task-id>"}
```

Poll task status:

```powershell
curl http://localhost:8000/status/<celery-task-id>
```

Successful result:

```json
{
  "task_id": "<celery-task-id>",
  "state": "SUCCESS",
  "result": {
    "filename": "doc.pdf",
    "group_id": "demo",
    "chunks_indexed": 12
  }
}
```

Search indexed documents:

```powershell
curl -X POST http://localhost:8000/chat -H "Content-Type: application/json" -d "{\"query\":\"What is this document about?\",\"group_id\":\"demo\",\"limit\":5}"
```

Response contains raw retrieval results:

```json
{
  "query": "What is this document about?",
  "group_id": "demo",
  "results": [
    {
      "text": "...",
      "filename": "doc.pdf",
      "page": 1,
      "group_id": "demo",
      "score": 0.12
    }
  ]
}
```

## Test

```powershell
uv run pytest -q -p no:cacheprovider
```

## Common Gotcha

If `/status/{task_id}` stays `PENDING`, Celery has no result history for that task id. Usually the worker is not running, the worker was started with the wrong app path, or API and worker are using different Redis URLs.
