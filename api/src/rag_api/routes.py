import re
from pathlib import Path

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator
from celery import Celery

from rag_api.dependencies import (
    get_embedding_engine,
    get_llm_client,
    get_vector_store,
)
from rag_core.config import get_settings
from rag_core.interfaces import EmbeddingEngineBase, LLMClientBase, VectorStoreBase

load_dotenv(Path(__file__).resolve().parents[2] / ".env", encoding="utf-8-sig")
settings = get_settings()

app = FastAPI(title="Local RAG API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

GROUP_ID_REGEX = re.compile(r"^[A-Za-z0-9_.-]+$")
INGESTION_TASK = "rag_ingestion.tasks.process_document_task"
celery_app = Celery(
    "rag_api",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
)


class ChatRequest(BaseModel):
    query: str = Field(..., min_length=1)
    group_id: str
    limit: int = Field(5, ge=1, le=20)
    require_citations: bool = False

    @field_validator("group_id")
    @classmethod
    def validate_group_id(cls, v: str) -> str:
        if not GROUP_ID_REGEX.match(v):
            raise ValueError(
                "group_id must contain only letters, digits, underscores, dots, and hyphens"
            )
        return v


class Source(BaseModel):
    text: str
    chunk_id: str | None = None
    file_id: str | None = None
    filename: str | None = None
    page: int | None = None
    group_id: str | None = None
    score: float | None = None


class ChatResponse(BaseModel):
    query: str
    group_id: str
    answer: str
    sources: list[Source]
    grounding: dict


class GroupSummary(BaseModel):
    group_id: str
    chunks: int
    files: int
    created_at: str | None = None


class FileSummary(BaseModel):
    file_id: str
    filename: str
    group_id: str
    chunks: int
    pages: list[int]
    created_at: str | None = None
    legacy: bool = False


class DeleteResponse(BaseModel):
    deleted_chunks: int


class DebugSearchRequest(ChatRequest):
    pass


class DebugSearchResponse(BaseModel):
    query: str
    group_id: str
    results: list[dict]


SMALL_TALK_RESPONSES = {
    "hi": "Hi! Ask me a question about your uploaded documents.",
    "hello": "Hello! Ask me a question about your uploaded documents.",
    "hey": "Hey! Ask me a question about your uploaded documents.",
    "thanks": "You're welcome. Ask me another document question when you're ready.",
    "thank you": "You're welcome. Ask me another document question when you're ready.",
    "where are you": "I'm running locally as your document assistant. Ask me a question about your uploaded documents when you're ready.",
    "where do you live": "I'm running locally as your document assistant. Ask me a question about your uploaded documents when you're ready.",
    "who are you": "I'm your local RAG assistant for answering questions about uploaded documents.",
    "what are you": "I'm your local RAG assistant for answering questions about uploaded documents.",
}


def small_talk_answer(query: str) -> str | None:
    normalized = re.sub(r"\s+", " ", query.strip().lower().rstrip(".!?"))
    if normalized in SMALL_TALK_RESPONSES:
        return SMALL_TALK_RESPONSES[normalized]
    if normalized.startswith(("where are you", "where do you live")):
        return SMALL_TALK_RESPONSES["where are you"]
    if normalized.startswith(("who are you", "what are you")):
        return SMALL_TALK_RESPONSES["who are you"]
    return None


def score_from_result(item: dict) -> float | None:
    for key in ("score", "_relevance_score", "_score", "_distance"):
        value = item.get(key)
        if value is not None:
            return float(value)
    return None


def source_from_result(item: dict) -> Source:
    return Source(
        text=item["text"],
        chunk_id=item.get("chunk_id"),
        file_id=item.get("file_id"),
        filename=item.get("filename"),
        page=item.get("page"),
        group_id=item.get("group_id"),
        score=score_from_result(item),
    )


def grounding_status(
    sources: list[Source],
    require_citations: bool,
    citations: list[int],
    insufficient: bool,
    raw_answer: str | None = None,
) -> dict:
    if not sources:
        return {
            "mode": "no_retrieval",
            "sources_supplied": 0,
            "citations_required": require_citations,
            "citations_found": [],
            "status": "no_retrieval",
        }

    valid_cites = sorted({
        int(c) for c in citations if 1 <= int(c) <= len(sources)
    })

    if insufficient:
        status = "insufficient"
    elif require_citations and not valid_cites:
        status = "rejected_uncited"
    elif valid_cites:
        status = "cited"
    else:
        status = "uncited"

    grounding = {
        "mode": "document",
        "sources_supplied": len(sources),
        "citations_required": require_citations,
        "citations_found": valid_cites,
        "status": status,
    }
    if raw_answer is not None:
        grounding["raw_answer"] = raw_answer
    return grounding


@app.post("/upload")
async def upload(
    file: UploadFile = File(...),
    group_id: str = Form(...),
):
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Only PDF files are supported")

    if not group_id.strip():
        raise HTTPException(400, "group_id is required")

    if not GROUP_ID_REGEX.match(group_id):
        raise HTTPException(
            400,
            "group_id must contain only letters, digits, underscores, dots, and hyphens",
        )

    file_bytes = await file.read()

    try:
        task = celery_app.send_task(
            INGESTION_TASK,
            args=[file_bytes, file.filename or "uploaded.pdf", group_id],
        )
    except Exception as e:
        raise HTTPException(500, f"Failed to enqueue ingestion task: {e}")

    return {"task_id": task.id}


@app.get("/status/{task_id}")
def status(task_id: str):
    task = celery_app.AsyncResult(task_id)
    body: dict[str, object] = {"task_id": task_id, "state": task.state}

    if task.successful():
        body["result"] = task.result
    elif task.failed():
        body["error"] = str(task.result)

    return body


@app.get("/groups", response_model=list[GroupSummary])
def list_groups(store: VectorStoreBase = Depends(get_vector_store)):
    return store.list_groups()


@app.get("/groups/{group_id}", response_model=GroupSummary)
def get_group(group_id: str, store: VectorStoreBase = Depends(get_vector_store)):
    try:
        group = store.get_group(group_id)
    except ValueError as e:
        raise HTTPException(422, str(e))
    if group is None:
        raise HTTPException(404, "Group not found")
    return group


@app.delete("/groups/{group_id}", response_model=DeleteResponse)
def delete_group(group_id: str, store: VectorStoreBase = Depends(get_vector_store)):
    try:
        deleted = store.delete_group(group_id)
    except ValueError as e:
        raise HTTPException(422, str(e))
    return DeleteResponse(deleted_chunks=deleted)


@app.get("/groups/{group_id}/files", response_model=list[FileSummary])
def list_files(group_id: str, store: VectorStoreBase = Depends(get_vector_store)):
    try:
        return store.list_files(group_id)
    except ValueError as e:
        raise HTTPException(422, str(e))


@app.delete("/groups/{group_id}/files/{file_id:path}", response_model=DeleteResponse)
def delete_file(
    group_id: str,
    file_id: str,
    store: VectorStoreBase = Depends(get_vector_store),
):
    try:
        deleted = store.delete_file(group_id, file_id)
    except ValueError as e:
        raise HTTPException(422, str(e))
    return DeleteResponse(deleted_chunks=deleted)


@app.post("/chat", response_model=ChatResponse)
def chat(
    payload: ChatRequest,
    embedder: EmbeddingEngineBase = Depends(get_embedding_engine),
    store: VectorStoreBase = Depends(get_vector_store),
    llm: LLMClientBase = Depends(get_llm_client),
):
    try:
        direct_answer = small_talk_answer(payload.query)
        if direct_answer:
            return ChatResponse(
                query=payload.query,
                group_id=payload.group_id,
                answer=direct_answer,
                sources=[],
                grounding=grounding_status([], payload.require_citations, [], False),
            )

        query_vector = embedder.embed_text(payload.query)
        results = store.search(
            query_vector=query_vector,
            query_text=payload.query,
            group_id=payload.group_id,
            limit=payload.limit,
        )
        sources = [source_from_result(item) for item in results]
        context = [
            f"{source.filename or 'source'}"
            f"{f' p.{source.page}' if source.page else ''}\n{source.text}"
            for source in sources
        ]
        llm_result = llm.generate_response(
            payload.query,
            context,
            require_citations=payload.require_citations,
        )
        answer = llm_result["answer"]
        citations = llm_result["citations"]
        insufficient = llm_result["insufficient"]

        # Filter valid citations
        valid_cites = sorted({
            int(c) for c in citations if 1 <= int(c) <= len(sources)
        })

        if payload.require_citations and (insufficient or not valid_cites):
            raw_answer = answer
            answer = "I don't have enough information in the provided documents."
            grounding = grounding_status(
                sources,
                payload.require_citations,
                citations,
                insufficient,
                raw_answer=raw_answer,
            )
        else:
            grounding = grounding_status(
                sources,
                payload.require_citations,
                citations,
                insufficient,
            )
    except Exception as e:
        raise HTTPException(500, f"Chat query failed: {e}")

    return ChatResponse(
        query=payload.query,
        group_id=payload.group_id,
        answer=answer,
        sources=sources,
        grounding=grounding,
    )


@app.post("/debug/search", response_model=DebugSearchResponse)
def debug_search(
    payload: DebugSearchRequest,
    embedder: EmbeddingEngineBase = Depends(get_embedding_engine),
    store: VectorStoreBase = Depends(get_vector_store),
):
    try:
        query_vector = embedder.embed_text(payload.query)
        results = store.search(
            query_vector=query_vector,
            query_text=payload.query,
            group_id=payload.group_id,
            limit=payload.limit,
        )
    except Exception as e:
        raise HTTPException(500, f"Debug search failed: {e}")

    return DebugSearchResponse(
        query=payload.query,
        group_id=payload.group_id,
        results=results,
    )
