import pytest
from fastapi.testclient import TestClient

from src.api.routes import app

client = TestClient(app)


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
