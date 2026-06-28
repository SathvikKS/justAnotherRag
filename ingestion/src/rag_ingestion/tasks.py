import uuid
from datetime import UTC, datetime
from functools import lru_cache
from pathlib import Path

from celery import Celery
from celery.signals import worker_process_init, worker_ready
from dotenv import load_dotenv

from rag_core.config import get_settings
from rag_grpc import EmbeddingClient
from rag_core.interfaces import DocumentParserBase
from rag_ingestion.parser_docling import DoclingParser
from rag_storage import LanceDBStore

load_dotenv(Path(__file__).resolve().parents[2] / ".env", encoding="utf-8-sig")
settings = get_settings()

celery_app = Celery(
    "ingestion_worker",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
)


_embedder = None
_parser_warmed = False


WARMUP_PDF_BYTES = b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 144]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length 44>>stream\nBT /F1 18 Tf 72 96 Td (Warmup OCR text) Tj ET\nendstream\nendobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\nxref\n0 6\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n0000000241 00000 n \n0000000336 00000 n \ntrailer<</Size 6/Root 1 0 R>>\nstartxref\n406\n%%EOF\n"


@lru_cache(maxsize=1)
def get_document_parser() -> DocumentParserBase:
    return DoclingParser()


def get_embedder() -> EmbeddingClient:
    global _embedder
    if _embedder is None:
        _embedder = EmbeddingClient(settings.embedding_grpc_url)
    return _embedder


def warm_document_parser() -> bool:
    global _parser_warmed
    if _parser_warmed or not settings.docling_warmup_enabled:
        return False

    parser = get_document_parser()
    parser.extract_text(WARMUP_PDF_BYTES, "warmup.pdf")
    _parser_warmed = True
    return True


@worker_process_init.connect
def warm_parser_for_worker_process(*args, **kwargs) -> None:
    warm_document_parser()


@worker_ready.connect
def warm_parser_for_solo_worker(*args, **kwargs) -> None:
    warm_document_parser()


@celery_app.task(name="rag_ingestion.tasks.process_document_task")
def process_document_task(file_bytes: bytes, filename: str, group_id: str) -> dict:
    parser = get_document_parser()
    embedder = get_embedder()
    store = LanceDBStore()

    file_id = str(uuid.uuid4())
    created_at = datetime.now(UTC).isoformat()
    parsed_chunks = parser.extract_text(file_bytes, filename)
    vectors = embedder.embed_texts([chunk["text"] for chunk in parsed_chunks])
    records = []
    for chunk_index, (chunk, vector) in enumerate(zip(parsed_chunks, vectors, strict=True)):
        metadata = chunk.get("metadata", {})
        records.append(
            {
                "chunk_id": str(uuid.uuid4()),
                "file_id": file_id,
                "vector": vector,
                "text": chunk["text"],
                "group_id": group_id,
                "filename": metadata.get("filename", filename),
                "page": metadata.get("page"),
                "created_at": created_at,
                "chunk_index": chunk_index,
                "text_quality": metadata.get("text_quality", "ok"),
            }
        )

    store.upsert(records)
    return {
        "file_id": file_id,
        "filename": filename,
        "group_id": group_id,
        "chunks_indexed": len(records),
        "chunks_skipped": getattr(parser, "last_skipped", 0),
    }
