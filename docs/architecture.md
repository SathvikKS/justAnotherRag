# Architecture

This is the current implemented architecture.

## Workspace

- `api/src/rag_api`: FastAPI routes, MCP tools, and HTTP dependency providers.
- `ingestion/src/rag_ingestion`: Celery app, PDF parsing, ingestion task.
- `embedding/src/rag_embedding`: LangChain-backed embedding engine and gRPC server.
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
3. `ingestion_worker` parses PDF bytes with a Docling-backed `DocumentParserBase` implementation configured through Docling OCR settings.
4. Worker sends Docling chunk texts to `embedding_service` (batched in chunks of 128 to prevent gRPC message size limit exhaustion).
5. Worker writes chunk records to LanceDB with a per-upload `file_id`, chunk index, creation timestamp, and text-quality marker.
6. `/status/{task_id}` reads Celery result state.

The ingestion parser is cached once per worker process, so Docling tokenizer/OCR/model state is process-local rather than shared across Celery workers. When `DOCLING_WARMUP_ENABLED=true`, the worker also performs a startup warmup conversion using a tiny synthetic PDF so the first real upload does not pay all initialization costs.

Chat:

1. `POST /chat` validates `query`, `group_id`, `session_id`, and `limit`. It requires a Bearer JWT Token in the `Authorization` header, resolving the `current_user` from the SQLModel database.
2. API validates that the `session_id` exists and belongs to the authenticated user.
3. API retrieves conversation history for the session using `PostgresChatMessageHistory` (stored in the `message_store` table in PostgreSQL), formatting it into the LLM prompt.
4. API bypasses retrieval for simple greetings and returns a direct response with no sources.
5. API embeds document questions through `embedding_service`.
6. API searches LanceDB through `LanceDBStore`.
7. API sends the query, conversation history, and labelled retrieved source text to `llm_service`.
8. `VllmGrpcClient` wraps the request in a document-QA system/user message, appending history, and renders it with the tokenizer chat template when available.
9. The `VllmGrpcClient` uses vLLM's guided decoding (`json_schema`) to force the LLM to output a structured JSON response containing the user-facing `answer`, a `citations` array, and an `insufficient` boolean. The API uses this structured metadata to record whether valid citations were found or if the context was insufficient. If `require_citations` is true for the request, the API rejects uncited or insufficient document answers with an insufficient-context response while preserving the raw uncited answer in `grounding.raw_answer` for debugging. When false, uncited answers are labelled but not rejected.
10. The AI response and user query are saved to `PostgresChatMessageHistory`. Grounding data and sources are serialized inside the message's `additional_kwargs` to allow full citation reload during session navigation.
11. API returns `query`, `group_id`, `answer`, `sources`, and `grounding` metadata.

MCP:

1. Third-party agents connect to `POST /mcp` using Streamable HTTP.
2. Parent FastAPI middleware optionally enforces `X-API-Key` for `/mcp` when `API_KEY` is configured.
3. `rag_api.mcp_server` exposes retrieval and ingestion tools backed by the same `dependencies.py` providers as REST.
4. `search_knowledge_base`, `list_groups`, `list_files`, and `get_chunk` talk directly to the embedder and LanceDB store.
5. `upload_document` enqueues the same Celery ingestion task as `POST /upload`.
6. `check_upload_status` reads the same Celery result state as `GET /status/{task_id}`.

Management:

1. `GET /groups` lists indexed groups from LanceDB chunk metadata.
2. `GET /groups/{group_id}/files` lists indexed files in a group.
3. `DELETE /groups/{group_id}/files/{file_id}` permanently deletes chunks for one uploaded file.
4. `DELETE /groups/{group_id}` permanently deletes all chunks in a group.
5. `POST /debug/search` returns lightweight retrieval results for troubleshooting, excluding vectors and empty optional fields.

## Boundaries

- API does not import SentenceTransformers, Torch, or vLLM.
- MCP auth is API-key based only, read from `API_KEY`, with no user model or per-client identity.
- Web Auth uses JWT Bearer Tokens, storing credentials and user/session objects in PostgreSQL using SQLModel.
- MCP tools live in `mcp_server.py`, share `dependencies.py` and shared ingestion helpers, and never call REST route handlers.
- Ingestion keeps parsing behind `DocumentParserBase` and currently uses Docling via LangChain.
- Embedding service owns the LangChain embedding wrapper and the 384-dimension guard.
- LLM service owns vLLM.
- `LLM_PROVIDER=mock` routes API generation to the mock gRPC service for local dev.
- LanceDB access lives in `rag_storage`.
- Shared environment parsing lives in `rag_core.config`.

## Configuration

Settings:

- `LANCEDB_URI`, `LANCEDB_TABLE`
- `EMBEDDING_MODEL`, `EMBEDDING_GRPC_URL`
- `DOCLING_OCR_ENABLED`, `DOCLING_OCR_ENGINE`, `DOCLING_OCR_LANGS`, `DOCLING_RAPIDOCR_BACKEND`, `DOCLING_FORCE_BACKEND_TEXT`, `DOCLING_WARMUP_ENABLED`
- `LLM_GRPC_URL`, `LLM_MODEL`, `LLM_MAX_TOKENS`, `VLLM_GPU_MEMORY_UTIL`
- `CELERY_BROKER_URL`, `CELERY_RESULT_BACKEND`
- `API_KEY`
- `CORS_ORIGINS`
- AWS credential fields for LanceDB S3 storage

`EMBEDDING_MODEL` must produce 384-dimensional vectors unless the LanceDB schema is changed. The current implementation still uses `BAAI/bge-small-en-v1.5`, now through LangChain's Hugging Face embeddings wrapper, to keep query and indexed vectors compatible.

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

For ingestion, Celery process concurrency multiplies Docling pipeline residency because each worker process loads its own parser/OCR state. That is acceptable on CPU when memory allows, but a future GPU-backed Docling setup should normally run one ingestion process per GPU to avoid duplicated VRAM usage.

## Rules

- Keep long-running ingestion in Celery.
- Keep API handlers thin.
- Keep model dependencies out of API and ingestion.
- Keep vector dimension and embedding model aligned.
- Keep `group_id` validation before LanceDB filtering.
- Keep model-specific chat formatting delegated to tokenizer metadata, not hard-coded app templates.
- Keep document/file deletion semantics explicit and permanent unless the API contract changes.
- Update README and docs when runtime flow, endpoints, services, or environment changes.
