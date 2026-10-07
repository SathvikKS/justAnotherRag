from pathlib import Path
from typing import TypedDict

from mcp.server.fastmcp import FastMCP

from rag_api.dependencies import get_embedding_engine, get_vector_store
from rag_api.ingestion import enqueue_upload, get_task_status, validate_group_id


class GroupRecord(TypedDict):
    group_id: str
    chunks: int
    files: int
    created_at: str | None


class FileRecord(TypedDict):
    file_id: str
    filename: str
    group_id: str
    chunks: int
    pages: list[int]
    created_at: str | None
    legacy: bool


class ChunkRecord(TypedDict):
    chunk_id: str
    text: str
    filename: str | None
    page: int | None
    file_id: str | None
    group_id: str | None
    score: float | None
    text_quality: str | None


class SearchRecord(TypedDict):
    chunk_id: str | None
    text: str
    filename: str | None
    page: int | None
    file_id: str | None
    group_id: str | None
    score: float | None


class SearchKnowledgeBaseResult(TypedDict):
    query: str
    group_id: str
    results: list[SearchRecord]


class ListGroupsResult(TypedDict):
    groups: list[GroupRecord]


class ListFilesResult(TypedDict):
    group_id: str
    files: list[FileRecord]


class GetChunkResult(TypedDict):
    chunk: ChunkRecord | None


class UploadDocumentResult(TypedDict):
    task_id: str


class CheckUploadStatusResult(TypedDict):
    task_id: str
    state: str
    result: object | None
    error: str | None


def _score_from_result(item: dict) -> float | None:
    for key in ("score", "_relevance_score", "_score", "_distance"):
        value = item.get(key)
        if value is not None:
            return float(value)
    return None


def _normalize_limit(limit: int) -> int:
    if limit < 1 or limit > 20:
        raise ValueError("limit must be between 1 and 20")
    return limit


def _to_group_record(item: dict) -> GroupRecord:
    return GroupRecord(
        group_id=item["group_id"],
        chunks=int(item["chunks"]),
        files=int(item["files"]),
        created_at=item.get("created_at"),
    )


def _to_file_record(item: dict) -> FileRecord:
    return FileRecord(
        file_id=item["file_id"],
        filename=item["filename"],
        group_id=item["group_id"],
        chunks=int(item["chunks"]),
        pages=[int(page) for page in item.get("pages", [])],
        created_at=item.get("created_at"),
        legacy=bool(item.get("legacy", False)),
    )


def _to_chunk_record(item: dict) -> ChunkRecord:
    return ChunkRecord(
        chunk_id=item.get("chunk_id", ""),
        text=item.get("text", ""),
        filename=item.get("filename"),
        page=item.get("page"),
        file_id=item.get("file_id"),
        group_id=item.get("group_id"),
        score=item.get("score"),
        text_quality=item.get("text_quality"),
    )


def _to_search_record(item: dict) -> SearchRecord:
    return SearchRecord(
        chunk_id=item.get("chunk_id"),
        text=item.get("text", ""),
        filename=item.get("filename"),
        page=item.get("page"),
        file_id=item.get("file_id"),
        group_id=item.get("group_id"),
        score=_score_from_result(item),
    )


mcp = FastMCP(
    "Local RAG Pipeline",
    stateless_http=True,
    json_response=True,
    streamable_http_path="/",
)


@mcp.tool()
def search_knowledge_base(
    query: str,
    group_id: str,
    limit: int = 5,
) -> SearchKnowledgeBaseResult:
    """Search indexed document chunks for one group without invoking the LLM."""
    safe_group_id = validate_group_id(group_id)
    safe_limit = _normalize_limit(limit)
    embedder = get_embedding_engine()
    store = get_vector_store()
    query_vector = embedder.embed_text(query)
    results = store.search(
        query_vector=query_vector,
        query_text=query,
        group_id=safe_group_id,
        limit=safe_limit,
    )
    return SearchKnowledgeBaseResult(
        query=query,
        group_id=safe_group_id,
        results=[_to_search_record(item) for item in results],
    )


@mcp.tool()
def list_groups() -> ListGroupsResult:
    """List all indexed groups known to the vector store."""
    store = get_vector_store()
    return ListGroupsResult(groups=[_to_group_record(item) for item in store.list_groups()])


@mcp.tool()
def list_files(group_id: str) -> ListFilesResult:
    """List indexed files for one group."""
    safe_group_id = validate_group_id(group_id)
    store = get_vector_store()
    return ListFilesResult(
        group_id=safe_group_id,
        files=[_to_file_record(item) for item in store.list_files(safe_group_id)],
    )


@mcp.tool()
def get_chunk(chunk_id: str) -> GetChunkResult:
    """Fetch one indexed chunk by id."""
    store = get_vector_store()
    chunk = store.get_chunk(chunk_id)
    return GetChunkResult(chunk=_to_chunk_record(chunk) if chunk is not None else None)


@mcp.tool()
def upload_document(file_path: str, group_id: str) -> UploadDocumentResult:
    """Queue a supported local document file for ingestion into one group."""
    path = Path(file_path).expanduser()
    if not path.exists() or not path.is_file():
        raise ValueError("file_path must point to an existing file")

    task_id = enqueue_upload(path.read_bytes(), path.name, group_id)
    return UploadDocumentResult(task_id=task_id)


@mcp.tool()
def check_upload_status(task_id: str) -> CheckUploadStatusResult:
    """Check the Celery ingestion task state for an uploaded document."""
    body = get_task_status(task_id)
    return CheckUploadStatusResult(
        task_id=str(body["task_id"]),
        state=str(body["state"]),
        result=body.get("result"),
        error=str(body["error"]) if body.get("error") is not None else None,
    )
