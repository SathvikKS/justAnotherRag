import uuid

from celery import Celery

from src.core.config import settings
from src.services.embedder_sentence import SentenceTransformerEngine
from src.services.parser_pypdf import PyPDFParser
from src.services.store_lancedb import LanceDBStore

celery_app = Celery(
    "rag_worker",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
)


@celery_app.task(name="src.workers.tasks.process_document_task")
def process_document_task(file_bytes: bytes, filename: str, group_id: str) -> dict:
    parser = PyPDFParser()
    embedder = SentenceTransformerEngine()
    store = LanceDBStore()

    parsed_chunks = parser.extract_text(file_bytes, filename)
    records = []
    for chunk in parsed_chunks:
        text = chunk["text"]
        metadata = chunk.get("metadata", {})
        records.append(
            {
                "chunk_id": str(uuid.uuid4()),
                "vector": embedder.embed_text(text),
                "text": text,
                "group_id": group_id,
                "filename": metadata.get("filename", filename),
                "page": metadata.get("page"),
            }
        )

    store.upsert(records)
    return {
        "filename": filename,
        "group_id": group_id,
        "chunks_indexed": len(records),
    }
