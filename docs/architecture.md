# Architecture

This is the current implemented architecture.

## Workspace

- `api/src/rag_api`: FastAPI routes, MCP tools, and HTTP dependency providers.
- `ingestion/src/rag_ingestion`: Celery app, PDF and Excel workbook parsing, ingestion task.
- `embedding/src/rag_embedding`: LangChain-backed embedding engine and gRPC server.
- `llm/src/rag_llm`: vLLM gRPC launcher and mock server.
- `packages/rag_core`: settings and shared interfaces.
- `packages/rag_storage`: LanceDB schema, upsert, FTS index, hybrid search.
- `packages/rag_grpc`: embedding gRPC service/client and vLLM client shim.
- `rag-web`: Vite React client. Group state is managed globally across routes via `GroupProvider` (`useGroup`), persisting selected group and locally-created groups in `localStorage`. The `GroupField` component presents an accessible select dropdown displaying available groups with file counts and provides a creation button on the right to add new groups via a modal dialog.

Root `pyproject.toml` is a uv workspace for the service apps and shared packages.

## Runtime Flow

Upload:

1. Client-Side Concurrency Queue:
   - Client manages selected PDF (`.pdf`) and Excel (`.xlsx`, `.xlsm`) files using a concurrent upload queue with a maximum limit of 5 parallel active uploads.
   - Files exceeding 50MB are rejected at selection time with a validation toast.
   - The queue displays dynamic status counts (e.g., `2 uploading · 1 indexing · 5 pending`).
   - Active uploads render visual progress percentages computed via XHR `onprogress`.
   - Completed files are automatically promoted to the indexed file list and removed from the active queue.
2. `POST /upload` validates the supported filename, `group_id`, and verifies that the file size is under 50MB (52,428,800 bytes).
3. API sends Celery task `rag_ingestion.tasks.process_document_task`.
4. `ingestion_worker` parses PDF and Excel workbook bytes with a Docling-backed `DocumentParserBase` implementation configured through Docling OCR settings. For workbooks, each worksheet's one-based position is stored in the existing `page` metadata field for its chunks.
5. Worker sends Docling chunk texts to `embedding_service` (batched in chunks of 128 to prevent gRPC message size limit exhaustion).
6. Worker writes chunk records to LanceDB with a per-upload `file_id`, chunk index, creation timestamp, and text-quality marker.
7. `/status/{task_id}` reads Celery result state.

The ingestion parser is cached once per worker process, so Docling tokenizer/OCR/model state is process-local rather than shared across Celery workers. When `DOCLING_WARMUP_ENABLED=true`, the worker also performs a startup warmup conversion using a tiny synthetic PDF so the first real upload does not pay all initialization costs.

Chat:

1. `POST /chat` validates `query`, `group_id`, `session_id`, and `limit`. It requires a Bearer JWT Token in the `Authorization` header, resolving the `current_user` from the SQLModel database.
2. API validates that the `session_id` exists and belongs to the authenticated user.
3. On the first question in a provisional session, API asks `llm_service` for a concise session title. If generation fails or returns unusable text, it derives a non-empty title from the first few words of the question. The web client initially labels an empty session `New chat` and refreshes the session list after the response so the saved title appears.
4. API retrieves conversation history for the session using `PostgresChatMessageHistory` (stored in the `message_store` table in PostgreSQL), formatting it into the LLM prompt.
5. API bypasses retrieval for simple greetings and returns a direct response with no sources.
6. When `expand_query` is enabled (the web setting defaults on), API asks `llm_service` to generate up to five search questions from the user's query. If generation fails or yields no usable questions, it searches with the original query.
7. API embeds each search question through `embedding_service` and searches LanceDB through `LanceDBStore`, applying `limit` to each question. It merges the results by unique chunk, retaining the strongest relevance result; the pre-deduplication candidate count can reach five times `limit`.
8. API sends the original query, conversation history, and labelled unique retrieved source text to `llm_service`. With `expand_query` disabled, it embeds and searches the original query once.
9. `VllmGrpcClient` wraps the request in a document-QA system/user message, appending history, and renders it with the tokenizer chat template when available.
10. The `VllmGrpcClient` uses vLLM's guided decoding (`json_schema`) to force the LLM to output a structured JSON response containing the user-facing `answer`, a `citations` array, and an `insufficient` boolean. The API uses this structured metadata to record whether valid citations were found or if the context was insufficient. If `require_citations` is true for the request, the API rejects uncited or insufficient document answers with an insufficient-context response while preserving the raw uncited answer in `grounding.raw_answer` for debugging. When false, uncited answers are labelled but not rejected.
11. The AI response and user query are saved to `PostgresChatMessageHistory`. Grounding data and sources are serialized inside the message's `additional_kwargs` to allow full citation reload during session navigation.
12. API returns `query`, `group_id`, `answer`, `sources`, and `grounding` metadata.

Session IDs are UUIDs and remain the unique identity for authorization, history, and navigation. Display titles are labels only; duplicate titles across sessions are allowed.

The web client renders assistant `answer` content as sanitized Markdown with GitHub-flavored tables and other common formatting. It unwraps a complete serialized chat response envelope when one is present in a stored answer. Only table markup is permitted from raw HTML; all other HTML is displayed as text. User-authored messages remain plain text. Chat messages share one scroll viewport that follows new messages when the reader is near the bottom and preserves position while the reader is reviewing earlier content; retrieval search results continue to use the same panel without chat-message formatting.

The Query settings sheet controls retrieval limit, question generation, and citation enforcement. The generation toggle is on by default and applies only to `/chat`; Search Vector DB (`/debug/search`) and MCP search continue to embed and search the supplied query directly. Generating questions adds an LLM call and may increase latency and final context size; duplicate chunks are merged before answer generation.

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
- `LLM_PROVIDER`, `LLM_GRPC_URL`, `LLM_MODEL`, `VLLM_GPU_MEMORY_UTIL`, `VLLM_MAX_MODEL_LEN`
- `CELERY_BROKER_URL`, `CELERY_RESULT_BACKEND`
- `API_KEY`
- `CORS_ORIGINS`
- AWS credential fields for LanceDB S3 storage

For S3-compatible LanceDB storage, shared settings add the LanceDB `allow_http='true'` option only when `AWS_ENDPOINT_URL` explicitly uses `http://`. This is intended for trusted local development services such as MinIO; use HTTPS for endpoints outside that environment. API and ingestion cache settings and the LanceDB store per process, so restart both after changing storage configuration.

`EMBEDDING_MODEL` must produce 384-dimensional vectors unless the LanceDB schema is changed. The current implementation still uses `BAAI/bge-small-en-v1.5`, now through LangChain's Hugging Face embeddings wrapper, to keep query and indexed vectors compatible.

`VLLM_GPU_MEMORY_UTIL` is read by `llm/src/rag_llm/serve.py` and passed to vLLM as `--gpu-memory-utilization`; the default is `0.88`. `VLLM_MAX_MODEL_LEN`, when set, is passed as `--max-model-len`. Leave it unset to use the model's native context length. On a 16GB GPU, Qwen3-4B's native 40960-token length needs more KV cache than utilization `0.75` leaves (about 3.7 GiB); `16384` fits that budget. Both launcher variables are removed from the vLLM process environment so vLLM does not warn about unknown `VLLM_*` names.

The API does not set a separate per-request output limit for answer or search-question generation. vLLM uses the remaining context capacity (`max_model_len` minus prompt tokens) as the maximum completion length, and may stop earlier at an end-of-sequence token. `VLLM_MAX_MODEL_LEN` in `llm/.env` caps the combined prompt and completion context length.

The `/chat` response and persisted assistant turn include `completion_status`: `complete`, `truncated`, `interrupted`, or `invalid`. `truncated` records a `length` finish reason even when the final JSON is syntactically valid. `interrupted` means no final completion frame arrived. `invalid` means a final frame arrived but its JSON or required schema was invalid. For non-complete results, the server extracts only a safely decoded top-level answer prefix from malformed JSON and never invents citations; if no text can be recovered, it returns a short fallback. Citation enforcement rejects incomplete answers with a distinct verifiability fallback while preserving the status. The status persists in history, the UI shows an inline notice in live and reloaded conversations, and later prompts mark such assistant history as incomplete.

`LLM_PROVIDER` accepts `mock`, `vllm`, or `auto`. The ServiceLauncher profiles set the shared API to `auto`; it first tries the mock gRPC contract and falls back to the vLLM contract on the same endpoint.

Local services read `.env` from their own service directory. API and ingestion preload `api/.env` or `ingestion/.env` before shared `rag_core.config` settings are constructed, which avoids falling back to package defaults when those services import shared code. Compose uses the same files via `env_file` and overrides container-only hostnames. Keep Redis URLs aligned between `api/.env` and `ingestion/.env`; examples live beside each service.

ServiceLauncher has `cpu` and `gpu` runtime profiles. The default `cpu` profile syncs the CPU dependency extra, serves mock LLM responses through `llm-cpu`, and runs real `embedding-cpu` and `ingestion-cpu` services with shared API and web services. The `gpu` profile syncs the CUDA 12.9 extra before starting the real `llm-gpu`, `embedding-gpu`, and `ingestion-gpu` services with those same shared API and web services. The shared API uses an `auto` LLM client that detects the mock or vLLM gRPC contract on the configured endpoint. An `all` compatibility alias points to the CPU service set so duplicate ports across profile-specific model services do not create an invalid implicit all-services profile. Profile-specific model service IDs keep the two dependency/runtime sets isolated; both profiles use the same local ports and must be started sequentially because the model sync is a pre-start step.

## LanceDB

API and ingestion share the same LanceDB storage options. For an explicitly configured `http://` S3-compatible endpoint, settings enable `allow_http='true'`; HTTPS endpoints do not receive that option. Group and file listing reads the LanceDB table, so a storage client configuration or connectivity failure can surface as an API error on those endpoints. A browser may report the resulting response as a CORS failure when the server error was produced outside CORS middleware; that symptom alone does not establish that the CORS origin configuration is wrong.

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
