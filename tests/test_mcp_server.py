from pathlib import Path

import pytest

from rag_api.mcp_server import (
    check_upload_status,
    get_chunk,
    list_files,
    list_groups,
    search_knowledge_base,
    upload_document,
)


@pytest.fixture(autouse=True)
def fake_mcp_dependencies(monkeypatch):
    class FakeEmbedder:
        def embed_text(self, text):
            assert text == "test query"
            return [0.01] * 384

    class FakeStore:
        def search(self, query_vector, query_text, group_id=None, limit=5):
            assert query_text == "test query"
            assert group_id == "safe-id"
            assert limit == 5
            return [
                {
                    "chunk_id": "chunk-1",
                    "text": "matched text",
                    "filename": "doc.pdf",
                    "page": 1,
                    "file_id": "file-1",
                    "group_id": group_id,
                    "score": 0.9,
                }
            ]

        def list_groups(self):
            return [{"group_id": "safe-id", "chunks": 1, "files": 1, "created_at": None}]

        def list_files(self, group_id):
            assert group_id == "safe-id"
            return [
                {
                    "file_id": "file-1",
                    "filename": "doc.pdf",
                    "group_id": group_id,
                    "chunks": 1,
                    "pages": [1],
                    "created_at": None,
                    "legacy": False,
                }
            ]

        def get_chunk(self, chunk_id):
            if chunk_id == "missing":
                return None
            return {
                "chunk_id": chunk_id,
                "text": "matched text",
                "filename": "doc.pdf",
                "page": 1,
                "file_id": "file-1",
                "group_id": "safe-id",
                "score": 0.9,
                "text_quality": "ok",
            }

    monkeypatch.setattr("rag_api.mcp_server.get_embedding_engine", lambda: FakeEmbedder())
    monkeypatch.setattr("rag_api.mcp_server.get_vector_store", lambda: FakeStore())


def test_search_knowledge_base_returns_hits():
    result = search_knowledge_base("test query", "safe-id")
    assert result["group_id"] == "safe-id"
    assert result["results"][0]["chunk_id"] == "chunk-1"
    assert result["results"][0]["score"] == 0.9


def test_list_groups_returns_groups():
    result = list_groups()
    assert result == {
        "groups": [{"group_id": "safe-id", "chunks": 1, "files": 1, "created_at": None}]
    }


def test_list_files_returns_files():
    result = list_files("safe-id")
    assert result["group_id"] == "safe-id"
    assert result["files"][0]["file_id"] == "file-1"


def test_get_chunk_returns_chunk():
    result = get_chunk("chunk-1")
    assert result["chunk"]["chunk_id"] == "chunk-1"
    assert result["chunk"]["text_quality"] == "ok"


def test_get_chunk_returns_none_for_missing_chunk():
    assert get_chunk("missing") == {"chunk": None}


def test_upload_document_enqueues_file(monkeypatch, tmp_path: Path):
    calls = {}

    class FakeCelery:
        def send_task(self, name, args):
            calls["name"] = name
            calls["args"] = tuple(args)
            return type("Result", (), {"id": "task-123"})()

    monkeypatch.setattr("rag_api.ingestion.celery_app", FakeCelery())
    pdf_path = tmp_path / "doc.pdf"
    pdf_path.write_bytes(b"%PDF-1.4 fake")

    result = upload_document(str(pdf_path), "safe-id")

    assert result == {"task_id": "task-123"}
    assert calls["name"] == "rag_ingestion.tasks.process_document_task"
    assert calls["args"] == (b"%PDF-1.4 fake", "doc.pdf", "safe-id")


def test_upload_document_rejects_missing_file():
    with pytest.raises(ValueError, match="existing file"):
        upload_document("missing.pdf", "safe-id")


def test_check_upload_status_returns_body(monkeypatch):
    class FakeResult:
        state = "SUCCESS"
        result = {"chunks_indexed": 2}

        def successful(self):
            return True

        def failed(self):
            return False

    class FakeCelery:
        def AsyncResult(self, task_id):
            assert task_id == "task-123"
            return FakeResult()

    monkeypatch.setattr("rag_api.ingestion.celery_app", FakeCelery())

    result = check_upload_status("task-123")

    assert result == {
        "task_id": "task-123",
        "state": "SUCCESS",
        "result": {"chunks_indexed": 2},
        "error": None,
    }
