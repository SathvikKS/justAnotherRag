import re

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator
from celery import Celery

from rag_api.dependencies import (
    get_embedding_engine,
    get_llm_client,
    get_vector_store,
)
from rag_core.config import settings
from rag_core.interfaces import EmbeddingEngineBase, LLMClientBase, VectorStoreBase

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
    filename: str | None = None
    page: int | None = None
    group_id: str | None = None
    score: float | None = None


class ChatResponse(BaseModel):
    query: str
    group_id: str
    answer: str
    sources: list[Source]


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


@app.post("/chat", response_model=ChatResponse)
def chat(
    payload: ChatRequest,
    embedder: EmbeddingEngineBase = Depends(get_embedding_engine),
    store: VectorStoreBase = Depends(get_vector_store),
    llm: LLMClientBase = Depends(get_llm_client),
):
    try:
        query_vector = embedder.embed_text(payload.query)
        results = store.search(
            query_vector=query_vector,
            query_text=payload.query,
            group_id=payload.group_id,
            limit=payload.limit,
        )
        sources = [
            Source(
                text=item["text"],
                filename=item.get("filename"),
                page=item.get("page"),
                group_id=item.get("group_id"),
                score=item.get("_distance"),
            )
            for item in results
        ]
        answer = llm.generate_response(payload.query, [source.text for source in sources])
    except Exception as e:
        raise HTTPException(500, f"Chat query failed: {e}")

    return ChatResponse(
        query=payload.query,
        group_id=payload.group_id,
        answer=answer,
        sources=sources,
    )
