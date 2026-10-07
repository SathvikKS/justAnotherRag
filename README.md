# Local RAG

Local RAG app for PDF ingestion and generated answers over indexed document groups.

The Python side is a uv workspace with separate root services:

- `api/`: FastAPI HTTP API.
- `ingestion/`: Celery PDF ingestion worker.
- `embedding/`: gRPC embedding service.
- `llm/`: vLLM gRPC launcher plus mock server.
- `packages/`: shared config, LanceDB storage, and gRPC clients.
- `rag-web/`: Vite React client.

The root workspace environment is intentionally kept Windows-compatible for `api`, `embedding`, and `ingestion` development. The `llm/` service manages its own `uv` environment and should be synced from `llm/` directly, especially for WSL2 GPU installs.

## What Works Today

- Upload PDFs and assign them to a `group_id`.
- Process uploads in `ingestion_worker`.
- Parse PDFs with Docling's LangChain loader and tokenizer-aware chunking.
- Support configurable OCR in ingestion through Docling when documents are scanned or image-heavy.
- Embed queries and chunks through `embedding_service`.
- Store chunks in LanceDB with 384-dimensional vectors.
- Search LanceDB with hybrid vector plus text search, filtered by `group_id`.
- Generate `/chat` answers through `llm_service` with a structured RAG prompt and tokenizer-native chat template rendering.
- Register user accounts, log in via JWT bearer tokens, and isolate stateful chat sessions.
- Persist chat session histories with grounding citations using LangChain Postgres memory.
- Query from the web client using a TanStack Router guarded interface in either `Ask AI` mode or direct `Search Vector DB` mode.
- Bypass retrieval for simple greetings and return no sources.
- List and permanently delete indexed files or whole groups without deleting the LanceDB directory.
- Run GPU-first Docker Compose, or add the CPU override.

## Environment

Each service owns its env file. Copy the service `.env.example` to `.env` inside the service directory you run from. The API and ingestion entrypoints load their own service `.env` before shared settings are resolved, so `api/.env` and `ingestion/.env` remain the source of truth for `LANCEDB_URI`.

Important defaults:

```env
LANCEDB_URI=../lancedb_data
LANCEDB_TABLE=document_chunks
EMBEDDING_MODEL=BAAI/bge-small-en-v1.5
EMBEDDING_GRPC_URL=localhost:50051
DOCLING_OCR_ENABLED=true
DOCLING_OCR_ENGINE=auto
DOCLING_OCR_LANGS=eng
DOCLING_RAPIDOCR_BACKEND=onnxruntime
DOCLING_FORCE_BACKEND_TEXT=true
DOCLING_WARMUP_ENABLED=true
LLM_PROVIDER=mock
LLM_GRPC_URL=localhost:50052
LLM_MODEL=Qwen/Qwen2.5-3B-Instruct
VLLM_GPU_MEMORY_UTIL=0.88
VLLM_MAX_MODEL_LEN=16384
CELERY_BROKER_URL=redis://localhost:6379/0
CELERY_RESULT_BACKEND=redis://localhost:6379/0
API_KEY=dev-api-key
DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5432/postgres
SECRET_KEY=your-super-secret-key-change-this-in-prod

# Model Cache Paths (Local Dev)
HF_HOME=../model_cache/huggingface
```

For local filesystem LanceDB storage shared by API and ingestion, set `LANCEDB_URI=../lancedb_data` in both `api/.env` and `ingestion/.env`.

For LanceDB backed by an S3-compatible service such as local MinIO, configure the same `LANCEDB_URI` and AWS settings in both service env files. Shared settings add `allow_http='true'` automatically only when `AWS_ENDPOINT_URL` explicitly uses `http://`, which supports trusted local development endpoints. Prefer HTTPS for endpoints outside trusted local development. Restart both the API and ingestion worker after changing these settings; they cache settings and the LanceDB store at process startup.

If Redis requires a password, set the passworded `CELERY_BROKER_URL` and `CELERY_RESULT_BACKEND` in both `api/.env` and `ingestion/.env`.

Set `API_KEY` in `api/.env` to require `X-API-Key` on `/mcp` requests only. Leave it unset to disable MCP auth for local-only development.

Docling OCR is configured only in `ingestion/.env`. `DOCLING_OCR_ENGINE=auto` is the default. On this Windows environment, `rapidocr` needs `onnxruntime` installed to avoid falling back to an unsupported torch OCR path.

The ingestion worker caches its `DoclingParser` once per worker process. If you increase Celery process concurrency, each process loads its own Docling/OCR pipeline state. That is mostly a RAM cost on CPU, but it becomes a VRAM multiplier if ingestion later moves to GPU-backed Docling. Prefer one GPU-backed ingestion process per GPU rather than high Celery process concurrency.

With `DOCLING_WARMUP_ENABLED=true`, the ingestion worker also runs a tiny synthetic PDF through Docling at worker startup so tokenizer/OCR/pipeline initialization happens before the first user upload.

### Model Caching & Storage
To avoid downloading models to arbitrary system paths, model storage is unified under the `model_cache/` directory:
- **`HF_HOME` (`model_cache/huggingface`):** Stores embedding models, tokenizers, and LLMs.

In Docker, the named volume `model_cache` is mounted at `/app/model_cache` across `ingestion_worker`, `embedding_service`, and `llm_service` to persist downloads and optimize startup times.

## Local Dev

API:

```powershell
cd api
copy .env.example .env
uv sync
uv run uvicorn rag_api.app:app --reload
```

When editing shared packages while running services directly from terminals, include the package directory in Uvicorn's reload watch list. Otherwise `--reload` may notice changes under `api/src` but miss edits under `../packages`, such as prompt changes in `rag_grpc`:

```powershell
uv run uvicorn rag_api.app:app --reload --reload-dir src --reload-dir ../packages
```

If shared package changes still do not appear, confirm where Python imports the package from:

```powershell
uv run python -c "import rag_grpc, inspect; print(inspect.getfile(rag_grpc))"
```

If it points into `.venv\Lib\site-packages` instead of `packages\rag_grpc\src`, run `uv sync` and restart the API process.

Ingestion:

```powershell
cd ingestion
copy .env.example .env
uv sync
uv run celery -A rag_ingestion.tasks.celery_app worker --loglevel=info --pool=solo
```

`--pool=solo` is the safest local Windows setting and keeps Docling/OCR model loading to one worker process. If you later run multi-process Celery concurrency, expect one Docling/OCR stack per process.

Embedding:

```powershell
cd embedding
copy .env.example .env
uv sync --extra cpu
uv run python -m rag_embedding.server
```

LLM GPU (Linux/WSL2):

* Avoid venv conflicts between Windows and WSL:
  ```bash
  export UV_PROJECT_ENVIRONMENT=~/rag/.venv
  ```
* Run the LLM server (requires CUDA Toolkit — see [CUDA Toolkit Setup](#cuda-toolkit-setup-wsl2) below):
  ```bash
  cd llm
  cp .env.example .env
  uv sync --extra gpu --index-strategy unsafe-best-match
  uv run --extra gpu python -m rag_llm.serve
  ```

The `llm/pyproject.toml` extras intentionally route `torch`, `torchvision`, and `torchaudio` to the same PyTorch index so fresh `uv sync --reinstall` runs do not mix CUDA 12.9 and CUDA 13.x wheels.

The ServiceLauncher config has two runtime profiles, with `cpu` selected by default. Its `all` entry is a compatibility alias for the CPU service set because the profile-specific services share ports:

- `cpu` starts `llm-cpu`, which returns mock responses, then starts the real `embedding-cpu` and `ingestion-cpu` services alongside the shared `api` and `web` services. Its pre-start sync selects the CPU dependency extra, and the CPU embedding/ingestion services hide CUDA with `CUDA_VISIBLE_DEVICES`.
- `gpu` starts the real `llm-gpu`, `embedding-gpu`, and `ingestion-gpu` services alongside the same shared `api` and `web` services. Its pre-start sync selects the CUDA 12.9 dependency extra before the remaining services use `uv run --no-sync`.

The shared API uses `LLM_PROVIDER=auto`: it detects the mock gRPC contract in the CPU profile and falls back to the vLLM gRPC contract in the GPU profile.

Use `servicelauncher --profile gpu` to select the GPU profile for a session. Keep profile startup sequential so the dependency sync completes before the `--no-sync` services start. Re-import `servicelauncher.config.json` after editing it.

LLM CPU (Linux/WSL2):

```bash
cd llm
cp .env.example .env
export VLLM_TARGET_DEVICE=cpu
uv sync --extra cpu --index-strategy unsafe-best-match
uv run --no-sync python -m rag_llm.serve
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
- MCP: `http://localhost:8000/mcp`
- Web client: `http://localhost:3000`
- Redis: `localhost:6379`
- vLLM gRPC: `localhost:50052`

Docker defaults to `Qwen/Qwen2.5-3B-Instruct`. Override with `LLM_MODEL`.
`VLLM_GPU_MEMORY_UTIL` defaults to `0.88` and is passed to vLLM as `--gpu-memory-utilization`; lower it to reserve less VRAM for vLLM KV cache and CUDA graph pools on smaller GPUs. `VLLM_MAX_MODEL_LEN` is passed as `--max-model-len` when set. Use `16384` for Qwen3-4B on a 16GB GPU when the native 40960-token context does not fit the remaining KV cache.

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

List groups:

```powershell
curl http://localhost:8000/groups
```

List files in a group:

```powershell
curl http://localhost:8000/groups/demo/files
```

Delete one indexed file's embeddings:

```powershell
curl -X DELETE http://localhost:8000/groups/demo/files/<file_id>
```

Delete all embeddings in a group:

```powershell
curl -X DELETE http://localhost:8000/groups/demo
```

Deletes are permanent. Re-uploading the same filename creates a new `file_id`.

Inspect direct retrieval output:

```powershell
curl -X POST http://localhost:8000/debug/search -H "Content-Type: application/json" -d "{\"query\":\"What is this document about?\",\"group_id\":\"demo\",\"limit\":5}"
```

MCP tools for third-party agents:

```powershell
claude mcp add --transport http local-rag http://localhost:8000/mcp
```

Configure MCP clients to send `X-API-Key: <API_KEY>` when MCP auth is enabled.

The mounted MCP server exposes retrieval and ingestion tools only: `search_knowledge_base`, `list_groups`, `list_files`, `get_chunk`, `upload_document`, and `check_upload_status`. It shares the API's dependency providers directly and does not call back into REST routes.

The web client also shows indexed files for the current group and exposes refresh/delete controls in the sidebar. The main query panel has two modes: `Ask AI` calls `/chat` and returns an LLM answer with sources, while `Search Vector DB` calls `/debug/search` and shows ranked retrieval hits without LLM generation. Query responses omit vectors and empty optional fields to keep payloads small. Query settings let users choose how many source chunks to retrieve (`5` by default) and whether to reject uncited AI answers. The prompt always asks for citations on document-backed answers; the toggle only controls whether uncited answers are accepted or rejected. Assistant messages include a grounding badge for every document-backed answer: `Cited`, `Uncited`, or `Uncited: rejected`. When citation enforcement is enabled, rejected responses expose the raw uncited model answer in an expandable debug panel.

The embedding service still exposes the same gRPC API, but now uses LangChain's Hugging Face embeddings wrapper internally with the same `EMBEDDING_MODEL`.

## Test

```powershell
uv run pytest -q -p no:cacheprovider
```

Compose validation:

```powershell
docker compose config
docker compose -f docker-compose.yml -f docker-compose.cpu.yml config
```

## Appendix

### CUDA Toolkit Setup (WSL2)

vLLM's `flashinfer` dependency JIT-compiles CUDA kernels at runtime and requires the CUDA Toolkit (`nvcc`) installed as a system package. PyTorch/vLLM wheels already include the CUDA runtime — only the compiler toolchain is missing.

Choose a CUDA version that matches your PyTorch/vLLM wheel target (e.g. `cu129` → CUDA 12.9):

```bash
# Set the desired version
CUDA_VER=12.9
wget https://developer.download.nvidia.com/compute/cuda/repos/wsl-ubuntu/x86_64/cuda-wsl-ubuntu.pin
sudo mv cuda-wsl-ubuntu.pin /etc/apt/preferences.d/cuda-repository-pin-600
wget "https://developer.download.nvidia.com/compute/cuda/${CUDA_VER}.0/local_installers/cuda-repo-wsl-ubuntu-${CUDA_VER/./-}-local_${CUDA_VER}.0-1_amd64.deb"
sudo dpkg -i "cuda-repo-wsl-ubuntu-${CUDA_VER/./-}-local_${CUDA_VER}.0-1_amd64.deb"
sudo cp "/var/cuda-repo-wsl-ubuntu-${CUDA_VER/./-}-local/cuda-*-keyring.gpg" /usr/share/keyrings/
sudo apt-get update
sudo apt-get -y install "cuda-toolkit-${CUDA_VER/./-}"
```

Add to `~/.bashrc` so `nvcc` is always on PATH:

```bash
export CUDA_HOME="/usr/local/cuda-${CUDA_VER}"
export PATH="$CUDA_HOME/bin:$PATH"
export LD_LIBRARY_PATH="$CUDA_HOME/lib64:$LD_LIBRARY_PATH"
```

Verification:

```bash
nvcc --version
```

Multiple CUDA versions can coexist (e.g. `/usr/local/cuda-12.9` and `/usr/local/cuda-13.3`). Switch between them by changing `CUDA_HOME` and `PATH` — update `~/.bashrc` or export in the current shell:

```bash
export CUDA_HOME=/usr/local/cuda-13.3
export PATH="$CUDA_HOME/bin:$PATH"
```

To remove an unused version:

```bash
sudo apt remove cuda-toolkit-13-3
```
