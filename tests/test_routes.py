import pytest
from fastapi.testclient import TestClient

from src.api.dependencies import get_embedding_engine, get_vector_store
from src.api.routes import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def fake_chat_dependencies():
    class FakeEmbedder:
        def embed_text(self, text):
            return [0.01] * 384

    class FakeStore:
        def search(self, query_vector, query_text, group_id=None, limit=5):
            return [
                {
                    "text": "matched text",
                    "filename": "doc.pdf",
                    "page": 1,
                    "group_id": group_id,
                    "_distance": 0.1,
                }
            ][:limit]

    app.dependency_overrides[get_embedding_engine] = lambda: FakeEmbedder()
    app.dependency_overrides[get_vector_store] = lambda: FakeStore()
    yield
    app.dependency_overrides.clear()


class TestUpload:
    def test_no_file_returns_422(self):
        response = client.post("/upload", data={"group_id": "test-group"})
        assert response.status_code == 422

    def test_non_pdf_file_returns_400(self):
        response = client.post(
            "/upload",
            files={"file": ("test.txt", b"hello", "text/plain")},
            data={"group_id": "test-group"},
        )
        assert response.status_code == 400
        assert "PDF" in response.json()["detail"]

    def test_blank_group_id_returns_400(self):
        response = client.post(
            "/upload",
            files={"file": ("doc.pdf", b"%PDF-1.4 fake", "application/pdf")},
            data={"group_id": "   "},
        )
        assert response.status_code == 400
        assert "group_id" in response.json()["detail"]

    def test_group_id_with_special_chars_returns_400(self):
        response = client.post(
            "/upload",
            files={"file": ("doc.pdf", b"%PDF-1.4 fake", "application/pdf")},
            data={"group_id": "bad'id"},
        )
        assert response.status_code == 400

    def test_empty_group_id_returns_422(self):
        response = client.post(
            "/upload",
            files={"file": ("doc.pdf", b"%PDF-1.4 fake", "application/pdf")},
            data={"group_id": ""},
        )
        assert response.status_code in (400, 422)

    def test_valid_pdf_dispatches_task(self, monkeypatch):
        calls = {}

        class FakeTask:
            def delay(self, file_bytes, filename, group_id):
                calls["args"] = (file_bytes, filename, group_id)
                return type("Result", (), {"id": "task-123"})()

        monkeypatch.setattr("src.api.routes.process_document_task", FakeTask())

        response = client.post(
            "/upload",
            files={"file": ("doc.pdf", b"%PDF-1.4 fake", "application/pdf")},
            data={"group_id": "test-group"},
        )

        assert response.status_code == 200
        assert response.json() == {"task_id": "task-123"}
        assert calls["args"] == (b"%PDF-1.4 fake", "doc.pdf", "test-group")

    def test_status_returns_success_result(self, monkeypatch):
        class FakeResult:
            state = "SUCCESS"
            result = {"chunks_indexed": 2}

            def successful(self):
                return True

            def failed(self):
                return False

        class FakeTask:
            def AsyncResult(self, task_id):
                assert task_id == "task-123"
                return FakeResult()

        monkeypatch.setattr("src.api.routes.process_document_task", FakeTask())

        response = client.get("/status/task-123")

        assert response.status_code == 200
        assert response.json() == {
            "task_id": "task-123",
            "state": "SUCCESS",
            "result": {"chunks_indexed": 2},
        }


class TestChat:
    def test_blank_query_returns_422(self):
        response = client.post(
            "/chat",
            json={"query": "", "group_id": "test-group", "limit": 5},
        )
        assert response.status_code == 422

    def test_limit_zero_returns_422(self):
        response = client.post(
            "/chat",
            json={"query": "test", "group_id": "test-group", "limit": 0},
        )
        assert response.status_code == 422

    def test_limit_negative_returns_422(self):
        response = client.post(
            "/chat",
            json={"query": "test", "group_id": "test-group", "limit": -1},
        )
        assert response.status_code == 422

    def test_limit_exceeds_max_returns_422(self):
        response = client.post(
            "/chat",
            json={"query": "test", "group_id": "test-group", "limit": 100},
        )
        assert response.status_code == 422

    def test_missing_group_id_returns_422(self):
        response = client.post(
            "/chat",
            json={"query": "test", "limit": 5},
        )
        assert response.status_code == 422

    def test_bad_group_id_chars_returns_422(self):
        response = client.post(
            "/chat",
            json={"query": "test", "group_id": "bad'id", "limit": 5},
        )
        assert response.status_code == 422

    def test_valid_chat_request_returns_200(self):
        response = client.post(
            "/chat",
            json={"query": "test query", "group_id": "safe-id", "limit": 5},
        )
        assert response.status_code == 200
        body = response.json()
        assert body["query"] == "test query"
        assert body["group_id"] == "safe-id"
        assert isinstance(body["results"], list)
