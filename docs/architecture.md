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
4. Worker sends all chunk texts to `embedding_service`.
5. Worker writes chunk records to LanceDB.
6. `/status/{task_id}` reads Celery result state.

Chat:

1. `POST /chat` validates `query`, `group_id`, and `limit`.
2. API embeds the query through `embedding_service`.
3. API searches LanceDB through `LanceDBStore`.
4. API sends the query and retrieved source text to `llm_service`.
5. API returns `query`, `group_id`, `answer`, and `sources`.

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
- `LLM_GRPC_URL`, `LLM_MODEL`, `LLM_MAX_TOKENS`
- `CELERY_BROKER_URL`, `CELERY_RESULT_BACKEND`
- `CORS_ORIGINS`
- AWS credential fields for LanceDB S3 storage

`EMBEDDING_MODEL` must produce 384-dimensional vectors unless the LanceDB schema is changed.

Local services read `.env` from their own service directory. Compose uses the same files via `env_file` and overrides container-only hostnames. Keep Redis URLs aligned between `api/.env` and `ingestion/.env`; examples live beside each service.

## LanceDB

`DocumentChunk` fields:

- `chunk_id`
- `vector: Vector(384)`
- `text`
- `group_id`
- `filename`
- `page`

Search uses LanceDB hybrid search and validates `group_id` before string-formatting the filter.

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
- Update README and docs when runtime flow, endpoints, services, or environment changes.
