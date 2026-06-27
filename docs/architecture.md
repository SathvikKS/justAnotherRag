# Architecture

This is the current implemented architecture. It is not a future phase plan.

## Directory Map

- `src/core/interfaces.py`: abstract contracts for parser, embedder, vector store, and LLM worker.
- `src/core/config.py`: Pydantic settings loaded from `.env`.
- `src/services/parser_pypdf.py`: PDF text extraction and chunking.
- `src/services/embedder_sentence.py`: SentenceTransformer embedding engine.
- `src/services/store_lancedb.py`: LanceDB schema, upsert, FTS index creation, and hybrid search.
- `src/services/llm_llamacpp.py`: optional llama.cpp-backed LLM engine.
- `src/api/dependencies.py`: FastAPI dependency providers for parser, embedder, and vector store.
- `src/api/routes.py`: FastAPI app and HTTP endpoints.
- `src/workers/tasks.py`: Celery app and document ingestion task.
- `tests/`: route, worker, and LanceDB tests.
- `docs/`: internal docs and runbook.

## Core Interfaces

`src/core/interfaces.py` defines the stable contracts:

- `DocumentParserBase.extract_text(file_bytes, filename) -> list[dict]`
- `EmbeddingEngineBase.embed_text(text) -> list[float]`
- `VectorStoreBase.upsert(chunks) -> bool`
- `VectorStoreBase.search(query_vector, query_text, group_id=None, limit=5) -> list[dict]`
- `LLMWorkerBase.generate_response(prompt, context) -> str`

Routes and workers should use these boundaries conceptually. Concrete vendor code belongs in `src/services/`.

## Configuration

Settings live in `src/core/config.py`:

- `lancedb_uri`: defaults to `./lancedb_data`
- `lancedb_table`: defaults to `document_chunks`
- `embedding_model`: defaults to `BAAI/bge-small-en-v1.5`
- `celery_broker_url`: defaults to `redis://localhost:6379/0`
- `celery_result_backend`: defaults to `redis://localhost:6379/0`
- `llama_model_path`: defaults to `model.gguf`

The API and worker must load the same Celery broker and result backend URLs.

## Upload Flow

1. `POST /upload` accepts multipart form data:
   - `file`: required PDF file
   - `group_id`: required string matching `^[A-Za-z0-9_.-]+$`
2. The route validates filename and `group_id`.
3. The route reads the uploaded bytes.
4. The route enqueues `src.workers.tasks.process_document_task` with file bytes, filename, and `group_id`.
5. The route returns only `{"task_id": "<id>"}`.
6. A separate Celery worker consumes the task.
7. The worker parses, chunks, embeds, and writes records to LanceDB.
8. `GET /status/{task_id}` reads task state and result from the Celery result backend.

The FastAPI process does not ingest documents after enqueueing the task.

## Worker Pipeline

`process_document_task(file_bytes, filename, group_id)` does:

1. Instantiate `PyPDFParser`.
2. Retrieve the module-level cached `SentenceTransformerEngine` (lazily initialized on the first task run to avoid process-fork/CUDA issues and model reload overhead).
3. Instantiate `LanceDBStore`.
4. Extract text chunks from the PDF.
5. Embed each chunk.
6. Build LanceDB records with:
   - `chunk_id`: UUID string
   - `vector`: 384 floats
   - `text`: chunk text
   - `group_id`: upload group id
   - `filename`: source filename
   - `page`: source page number, when available
7. Call `store.upsert(records)`.
8. Return filename, group id, and indexed chunk count.

## Parser

`PyPDFParser` uses:

- `pypdf.PdfReader`
- `RecursiveCharacterTextSplitter`
- `chunk_size=512`
- `chunk_overlap=50`

Each returned chunk has:

```python
{
    "text": "...",
    "metadata": {
        "filename": "doc.pdf",
        "page": 1,
    },
}
```

If no extractable text exists, parser raises `ValueError("No extractable text found")`.

## Embeddings

`SentenceTransformerEngine` loads `BAAI/bge-small-en-v1.5` by default.

`embed_text()` normalizes embeddings and enforces exactly 384 dimensions. A different embedding model must either preserve 384 dimensions or require a coordinated LanceDB schema change.

## LanceDB Store

`DocumentChunk` schema:

- `chunk_id: str`
- `vector: Vector(384)`
- `text: str`
- `group_id: str`
- `filename: str`
- `page: int | None`

`LanceDBStore` connects to `settings.lancedb_uri`, opens or creates `settings.lancedb_table`, and ensures an FTS index on `text`.

Search uses LanceDB hybrid query:

```python
table.search(query_type="hybrid").vector(query_vector).text(query_text)
```

If `group_id` is provided, the store validates it and applies:

```python
.where(f"group_id = '{group_id}'", prefilter=True)
```

The regex guard is required because the filter is string formatted.

## API Endpoints

`POST /upload`

- Input: multipart PDF file and `group_id`
- Output: `{"task_id": str}`

`GET /status/{task_id}`

- Output always includes `task_id` and `state`
- Adds `result` on success
- Adds `error` on failure

`POST /chat`

- Input JSON:

```json
{
  "query": "question",
  "group_id": "demo",
  "limit": 5
}
```

- `query`: required non-empty string
- `group_id`: required, regex validated
- `limit`: integer from 1 to 20
- Output: raw retrieval results, not LLM-generated answers

## LLM Engine Status

`LlamaCPPEngine` exists but is not wired into `/chat`.

It lazy-imports `llama_cpp` and raises a clear runtime error if the optional `llm` extra is missing. Initialization chooses:

- GPU: if `/usr/local/cuda` exists, `n_gpu_layers=-1`
- CPU: otherwise `n_threads=os.cpu_count() or 1`

Current `/chat` returns retrieved LanceDB chunks only.

## Architectural Rules

- Keep long-running ingestion in Celery, not FastAPI.
- Keep route handlers thin: validation, dependency use, enqueue/search, response shaping.
- Keep vendor-specific implementation details inside `src/services/`.
- Keep API and worker Celery URLs aligned.
- Keep the LanceDB vector dimension and embedding model dimension aligned.
- Keep `group_id` validation before LanceDB filtering.
- Update `README.md` and `docs/` when setup, runtime flow, endpoints, or architecture changes.
