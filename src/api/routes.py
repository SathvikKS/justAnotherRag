import re
import uuid

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field, field_validator

from src.services.embedder_sentence import SentenceTransformerEngine
from src.services.parser_pypdf import PyPDFParser
from src.services.store_lancedb import LanceDBStore

app = FastAPI(title="Local RAG API")

parser = PyPDFParser()
embedder = SentenceTransformerEngine()
store = LanceDBStore()

GROUP_ID_REGEX = re.compile(r"^[A-Za-z0-9_.-]+$")


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


class ChatResponse(BaseModel):
    query: str
    group_id: str
    results: list[dict[str, object]]


@app.post("/upload")
async def upload(file: UploadFile = File(...), group_id: str = Form(...)):
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Only PDF files are supported in Phase 1")

    if not group_id.strip():
        raise HTTPException(400, "group_id is required")

    if not GROUP_ID_REGEX.match(group_id):
        raise HTTPException(
            400,
            "group_id must contain only letters, digits, underscores, dots, and hyphens",
        )

    file_bytes = await file.read()

    try:
        parsed_chunks = parser.extract_text(file_bytes, file.filename or "uploaded.pdf")
    except ValueError as e:
        raise HTTPException(422, str(e))
    except Exception as e:
        raise HTTPException(500, f"Ingestion failed: {e}")

    try:
        records = []
        for index, chunk in enumerate(parsed_chunks):
            text = chunk["text"]
            metadata = chunk.get("metadata", {})
            vector = embedder.embed_text(text)

            records.append({
                "chunk_id": str(uuid.uuid4()),
                "vector": vector,
                "text": text,
                "group_id": group_id,
                "filename": metadata.get("filename", file.filename or "uploaded.pdf"),
                "page": metadata.get("page"),
            })

        store.upsert(records)
    except Exception as e:
        raise HTTPException(500, f"Ingestion failed: {e}")

    return {
        "filename": file.filename,
        "group_id": group_id,
        "chunks_indexed": len(records),
    }


@app.post("/chat", response_model=ChatResponse)
def chat(payload: ChatRequest):
    try:
        query_vector = embedder.embed_text(payload.query)
        results = store.search(
            query_vector=query_vector,
            query_text=payload.query,
            group_id=payload.group_id,
            limit=payload.limit,
        )
    except Exception as e:
        raise HTTPException(500, f"Chat query failed: {e}")

    return ChatResponse(
        query=payload.query,
        group_id=payload.group_id,
        results=[
            {
                "text": item["text"],
                "filename": item.get("filename"),
                "page": item.get("page"),
                "group_id": item.get("group_id"),
                "score": item.get("_distance"),
            }
            for item in results
        ],
    )
