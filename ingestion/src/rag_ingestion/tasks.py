import uuid

from celery import Celery

from rag_core.config import settings
from rag_grpc import EmbeddingClient
from rag_ingestion.parser_pypdf import PyPDFParser
from rag_storage import LanceDBStore

celery_app = Celery(
    "ingestion_worker",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
)


_embedder = None


def get_embedder() -> EmbeddingClient:
    global _embedder
    if _embedder is None:
        _embedder = EmbeddingClient(settings.embedding_grpc_url)
    return _embedder


@celery_app.task(name="rag_ingestion.tasks.process_document_task")
def process_document_task(file_bytes: bytes, filename: str, group_id: str) -> dict:
    parser = PyPDFParser()
    embedder = get_embedder()
    store = LanceDBStore()

    parsed_chunks = parser.extract_text(file_bytes, filename)
    vectors = embedder.embed_texts([chunk["text"] for chunk in parsed_chunks])
    records = []
    for chunk, vector in zip(parsed_chunks, vectors, strict=True):
        metadata = chunk.get("metadata", {})
        records.append(
            {
                "chunk_id": str(uuid.uuid4()),
                "vector": vector,
                "text": chunk["text"],
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
