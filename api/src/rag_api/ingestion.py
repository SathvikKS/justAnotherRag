import re
from pathlib import Path

from celery import Celery
from dotenv import load_dotenv

from rag_core.config import get_settings

load_dotenv(Path(__file__).resolve().parents[2] / ".env", encoding="utf-8-sig")
settings = get_settings()

GROUP_ID_REGEX = re.compile(r"^[A-Za-z0-9_.-]+$")
INGESTION_TASK = "rag_ingestion.tasks.process_document_task"
celery_app = Celery(
    "rag_api",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
)


def validate_group_id(group_id: str) -> str:
    normalized = group_id.strip()
    if not normalized:
        raise ValueError("group_id is required")
    if not GROUP_ID_REGEX.match(normalized):
        raise ValueError(
            "group_id must contain only letters, digits, underscores, dots, and hyphens"
        )
    return normalized


def validate_pdf_filename(filename: str | None) -> str:
    if not filename or not filename.lower().endswith(".pdf"):
        raise ValueError("Only PDF files are supported")
    return filename


def enqueue_upload(file_bytes: bytes, filename: str | None, group_id: str) -> str:
    safe_filename = validate_pdf_filename(filename)
    safe_group_id = validate_group_id(group_id)

    try:
        task = celery_app.send_task(
            INGESTION_TASK,
            args=[file_bytes, safe_filename, safe_group_id],
        )
    except Exception as e:
        raise RuntimeError(f"Failed to enqueue ingestion task: {e}") from e

    return task.id


def get_task_status(task_id: str) -> dict[str, object]:
    task = celery_app.AsyncResult(task_id)
    body: dict[str, object] = {"task_id": task_id, "state": task.state}

    if task.successful():
        body["result"] = task.result
    elif task.failed():
        body["error"] = str(task.result)

    return body
