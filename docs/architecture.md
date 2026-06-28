# Architecture

This is the current implemented architecture.

## Workspace

- `api/src/rag_api`: FastAPI routes and HTTP dependency providers.
- `ingestion/src/rag_ingestion`: Celery app, PDF parsing, ingestion task.
- `embedding/src/rag_embedding`: SentenceTransformer engine and gRPC server.
- `llm/src/rag_llm`: vLLM gRPC launcher and mock server.
- `packages/rag_core`: settings and shared interfaces.
- `packages/rag_storage`: LanceDB schema, upsert, FTS index, hybrid search.
- `packages/rag_grpc`: embedding gRPC service/client and vLLM client shim.
- `rag-web`: Vite React client.

Root `pyproject.toml` is a uv workspace for the service apps and shared packages.

## Runtime Flow

Upload:

1. `POST /upload` validates the PDF filename and `group_id`.
2. API sends Celery task `rag_ingestion.tasks.process_document_task`.
3. `ingestion_worker` parses PDF bytes with `PyPDFParser`.
4. Worker sends chunk texts to `embedding_service` (batched in chunks of 128 to prevent gRPC message size limit exhaustion).
5. Worker writes chunk records to LanceDB with a per-upload `file_id`, chunk index, creation timestamp, and text-quality marker.
6. `/status/{task_id}` reads Celery result state.

Chat:

1. `POST /chat` validates `query`, `group_id`, and `limit`.
2. API bypasses retrieval for simple greetings and returns a direct response with no sources.
3. API embeds document questions through `embedding_service`.
4. API searches LanceDB through `LanceDBStore`.
5. API sends the query and labelled retrieved source text to `llm_service`.
6. `VllmGrpcClient` wraps the request in a document-QA system/user message and renders it with the tokenizer chat template when available.
7. If `require_citations` is true for the request, the prompt requires source-number citations and the API rejects uncited document answers with an insufficient-context response. When false, no citation verification or rejection is performed.
8. API returns `query`, `group_id`, `answer`, `sources`, and `grounding` metadata.

Management:

1. `GET /groups` lists indexed groups from LanceDB chunk metadata.
2. `GET /groups/{group_id}/files` lists indexed files in a group.
3. `DELETE /groups/{group_id}/files/{file_id}` permanently deletes chunks for one uploaded file.
4. `DELETE /groups/{group_id}` permanently deletes all chunks in a group.
5. `POST /debug/search` returns raw retrieval results for troubleshooting.

## Boundaries

- API does not import SentenceTransformers, Torch, or vLLM.
- Ingestion does not import SentenceTransformers or Torch.
- Embedding service owns SentenceTransformers and the 384-dimension guard.
- LLM service owns vLLM.
- `LLM_PROVIDER=mock` routes API generation to the mock gRPC service for local dev.
- LanceDB access lives in `rag_storage`.
- Shared environment parsing lives in `rag_core.config`.

## Configuration

Settings:

- `LANCEDB_URI`, `LANCEDB_TABLE`
- `EMBEDDING_MODEL`, `EMBEDDING_GRPC_URL`
- `LLM_GRPC_URL`, `LLM_MODEL`, `LLM_MAX_TOKENS`, `VLLM_GPU_MEMORY_UTIL`
- `CELERY_BROKER_URL`, `CELERY_RESULT_BACKEND`
- `CORS_ORIGINS`
- AWS credential fields for LanceDB S3 storage

`EMBEDDING_MODEL` must produce 384-dimensional vectors unless the LanceDB schema is changed.

`VLLM_GPU_MEMORY_UTIL` is read by `llm/src/rag_llm/serve.py` and passed to vLLM as `--gpu-memory-utilization`; the default is `0.88`.

Local services read `.env` from their own service directory. API and ingestion preload `api/.env` or `ingestion/.env` before shared `rag_core.config` settings are constructed, which avoids falling back to package defaults when those services import shared code. Compose uses the same files via `env_file` and overrides container-only hostnames. Keep Redis URLs aligned between `api/.env` and `ingestion/.env`; examples live beside each service.

## LanceDB

`DocumentChunk` fields:

- `chunk_id`
- `vector: Vector(384)`
- `text`
- `group_id`
- `filename`
- `page`
- `file_id`
- `created_at`
- `chunk_index`
- `text_quality`

Search uses LanceDB hybrid search and validates `group_id` before string-formatting the filter. New uploads always get a UUID `file_id`; rows from older local databases without `file_id` are treated as legacy files grouped by filename.

Deletes use LanceDB table `delete(...)` filters and are permanent. Re-uploading the same filename creates a new `file_id` rather than replacing existing rows.

## Docker

`docker-compose.yml` is GPU-first and defines:

- `api_gateway`
- `ingestion_worker`
- `embedding_service`
- `llm_service`
- `redis_broker`
- `web_client`

`docker-compose.cpu.yml` swaps `llm_service` to `vllm/vllm-openai-cpu:latest-x86_64`, sets `VLLM_TARGET_DEVICE=cpu`, and resets GPU reservations.

## Scaling

v1 runs one `llm_service`. Next scaling step is one vLLM instance per GPU. If VRAM permits multiple model copies, add `llm_service_1`, `llm_service_2`, etc. with lower `--gpu-memory-utilization`, then add `LLM_GRPC_URLS` and API-side round-robin. No Envoy/gRPC load balancer in v1.

## Rules

- Keep long-running ingestion in Celery.
- Keep API handlers thin.
- Keep model dependencies out of API and ingestion.
- Keep vector dimension and embedding model aligned.
- Keep `group_id` validation before LanceDB filtering.
- Keep model-specific chat formatting delegated to tokenizer metadata, not hard-coded app templates.
- Keep document/file deletion semantics explicit and permanent unless the API contract changes.
- Update README and docs when runtime flow, endpoints, services, or environment changes.
