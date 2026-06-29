import pytest
import uuid
from fastapi.testclient import TestClient

import rag_api.app as app_module
from rag_api.dependencies import get_embedding_engine, get_llm_client, get_vector_store
from rag_api.app import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def mock_db_and_auth(monkeypatch):
    from sqlmodel import SQLModel, create_engine, Session
    from rag_api.auth import get_current_user
    from rag_api.database import get_session, get_psycopg_conn
    from rag_api.models import User, ChatSession
    from unittest.mock import MagicMock

    import os
    db_file = "test.db"
    if os.path.exists(db_file):
        try:
            os.remove(db_file)
        except OSError:
            pass

    engine = create_engine(
        f"sqlite:///{db_file}",
        connect_args={"check_same_thread": False}
    )
    SQLModel.metadata.create_all(engine)

    session = Session(engine)
    try:
        session.query(ChatSession).delete()
        session.query(User).delete()
        session.commit()
    except Exception:
        session.rollback()

    user = User(username="testuser", password_hash="hashed_pw")
    session.add(user)
    session.commit()
    session.refresh(user)

    chat_session = ChatSession(
        id=uuid.UUID("11111111-1111-1111-1111-111111111111"),
        user_id=user.id,
        title="Test Session",
    )
    session.add(chat_session)
    session.commit()
    session.close()

    def override_get_session():
        with Session(engine) as s:
            yield s

    from fastapi import Depends
    app.dependency_overrides[get_session] = override_get_session
    app.dependency_overrides[get_current_user] = lambda db=Depends(get_session): db.query(User).first()
    app.dependency_overrides[get_psycopg_conn] = lambda: MagicMock()

    class FakeChatMessageHistory:
        def __init__(self, table_name, session_id, sync_connection=None):
            self.messages = []

        def add_message(self, message):
            self.messages.append(message)

        def add_user_message(self, message):
            from langchain_core.messages import HumanMessage
            self.messages.append(HumanMessage(content=message))

        def add_ai_message(self, message):
            from langchain_core.messages import AIMessage
            self.messages.append(AIMessage(content=message))

    monkeypatch.setattr(
        "rag_api.routes.PostgresChatMessageHistory",
        FakeChatMessageHistory,
    )

    yield

    app.dependency_overrides.pop(get_session, None)
    app.dependency_overrides.pop(get_current_user, None)
    app.dependency_overrides.pop(get_psycopg_conn, None)

    import os
    if os.path.exists("test.db"):
        try:
            os.remove("test.db")
        except OSError:
            pass


@pytest.fixture(autouse=True)
def clear_api_key(monkeypatch):
    monkeypatch.setattr(app_module.settings, "api_key", None)


@pytest.fixture(autouse=True)
def fake_chat_dependencies():
    class FakeEmbedder:
        def embed_text(self, text):
            return [0.01] * 384

    class FakeStore:
        def __init__(self):
            self.search_calls = []

        def search(self, query_vector, query_text, group_id=None, limit=5):
            self.search_calls.append(query_text)
            return [
                {
                    "chunk_id": "chunk-1",
                    "file_id": "file-1",
                    "vector": [0.01] * 384,
                    "text": "matched text",
                    "filename": "doc.pdf",
                    "page": 1,
                    "group_id": group_id,
                    "score": 0.9,
                }
            ][:limit]

        def list_groups(self):
            return [{"group_id": "safe-id", "chunks": 1, "files": 1}]

        def get_group(self, group_id):
            if group_id == "missing":
                return None
            return {"group_id": group_id, "chunks": 1, "files": 1}

        def list_files(self, group_id):
            return [
                {
                    "file_id": "file-1",
                    "filename": "doc.pdf",
                    "group_id": group_id,
                    "chunks": 1,
                    "pages": [1],
                    "legacy": False,
                }
            ]

        def delete_group(self, group_id):
            return 1

        def delete_file(self, group_id, file_id):
            return 1

    class FakeLLM:
        def generate_response(self, prompt, context, require_citations=False, history=""):
            assert prompt == "test query"
            assert context == ["doc.pdf p.1\nmatched text"]
            assert require_citations is False
            return {
                "answer": "generated answer",
                "citations": [],
                "insufficient": False,
            }

    app.dependency_overrides[get_embedding_engine] = lambda: FakeEmbedder()
    app.dependency_overrides[get_vector_store] = lambda: FakeStore()
    app.dependency_overrides[get_llm_client] = lambda: FakeLLM()
    yield
    app.dependency_overrides.clear()


class TestUpload:
    def test_requires_api_key_when_configured(self, monkeypatch):
        monkeypatch.setattr(app_module.settings, "api_key", "secret-key")

        response = client.post("/upload", data={"group_id": "test-group"})

        assert response.status_code == 422

    def test_accepts_api_key_when_configured(self, monkeypatch):
        monkeypatch.setattr(app_module.settings, "api_key", "secret-key")

        class FakeCelery:
            def send_task(self, name, args):
                return type("Result", (), {"id": "task-123"})()

        monkeypatch.setattr("rag_api.ingestion.celery_app", FakeCelery())

        response = client.post(
            "/upload",
            files={"file": ("doc.pdf", b"%PDF-1.4 fake", "application/pdf")},
            data={"group_id": "test-group"},
        )

        assert response.status_code == 200

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

        class FakeCelery:
            def send_task(self, name, args):
                calls["name"] = name
                calls["args"] = tuple(args)
                return type("Result", (), {"id": "task-123"})()

        monkeypatch.setattr("rag_api.ingestion.celery_app", FakeCelery())

        response = client.post(
            "/upload",
            files={"file": ("doc.pdf", b"%PDF-1.4 fake", "application/pdf")},
            data={"group_id": "test-group"},
        )

        assert response.status_code == 200
        assert response.json() == {"task_id": "task-123"}
        assert calls["name"] == "rag_ingestion.tasks.process_document_task"
        assert calls["args"] == (b"%PDF-1.4 fake", "doc.pdf", "test-group")

    def test_status_returns_success_result(self, monkeypatch):
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

        response = client.get("/status/task-123")

        assert response.status_code == 200
        assert response.json() == {
            "task_id": "task-123",
            "state": "SUCCESS",
            "result": {"chunks_indexed": 2},
        }


class TestChat:
    def test_mcp_mount_requires_api_key_when_configured(self, monkeypatch):
        monkeypatch.setattr(app_module.settings, "api_key", "secret-key")

        response = client.post("/mcp")

        assert response.status_code == 401

    def test_docs_remain_public_when_api_key_is_enabled(self, monkeypatch):
        monkeypatch.setattr(app_module.settings, "api_key", "secret-key")

        response = client.get("/docs")

        assert response.status_code == 200

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
        assert body["answer"] == "generated answer"
        assert isinstance(body["sources"], list)
        assert body["sources"][0]["file_id"] == "file-1"
        assert body["sources"][0]["score"] == 0.9
        assert body["grounding"]["status"] == "uncited"
        assert body["grounding"]["citations_required"] is False

    def test_greeting_bypasses_retrieval(self):
        response = client.post(
            "/chat",
            json={"query": "hi", "group_id": "safe-id", "limit": 5},
        )
        assert response.status_code == 200
        body = response.json()
        assert body["answer"] == "Hi! Ask me a question about your uploaded documents."
        assert body["sources"] == []
        assert body["grounding"]["status"] == "no_retrieval"

    def test_assistant_location_bypasses_retrieval(self):
        response = client.post(
            "/chat",
            json={
                "query": "where are you",
                "group_id": "safe-id",
                "limit": 5,
                "require_citations": False,
            },
        )
        assert response.status_code == 200
        body = response.json()
        assert body["answer"].startswith("I'm running locally")
        assert body["sources"] == []
        assert body["grounding"]["status"] == "no_retrieval"

    def test_required_citations_rejects_uncited_answer(self):
        class FakeLLM:
            def generate_response(self, prompt, context, require_citations=False, history=""):
                assert require_citations is True
                return {
                    "answer": "generated answer without citations",
                    "citations": [],
                    "insufficient": False,
                }

        app.dependency_overrides[get_llm_client] = lambda: FakeLLM()
        response = client.post(
            "/chat",
            json={
                "query": "test query",
                "group_id": "safe-id",
                "limit": 5,
                "require_citations": True,
            },
        )
        assert response.status_code == 200
        body = response.json()
        assert body["answer"] == "I don't have enough information in the provided documents."
        assert body["grounding"]["status"] == "rejected_uncited"
        assert body["grounding"]["raw_answer"] == "generated answer without citations"

    def test_required_citations_accepts_valid_citations(self):
        class FakeLLM:
            def generate_response(self, prompt, context, require_citations=False, history=""):
                assert require_citations is True
                return {
                    "answer": "The answer is supported by the document.",
                    "citations": [1],
                    "insufficient": False,
                }

        app.dependency_overrides[get_llm_client] = lambda: FakeLLM()
        response = client.post(
            "/chat",
            json={
                "query": "test query",
                "group_id": "safe-id",
                "limit": 5,
                "require_citations": True,
            },
        )
        assert response.status_code == 200
        body = response.json()
        assert body["answer"] == "The answer is supported by the document."
        assert body["grounding"]["status"] == "cited"
        assert body["grounding"]["citations_found"] == [1]

    def test_group_crud_endpoints(self):
        assert client.get("/groups").json() == [
            {"group_id": "safe-id", "chunks": 1, "files": 1, "created_at": None}
        ]

        group = client.get("/groups/safe-id")
        assert group.status_code == 200
        assert group.json()["group_id"] == "safe-id"

        files = client.get("/groups/safe-id/files")
        assert files.status_code == 200
        assert files.json()[0]["file_id"] == "file-1"

        deleted_file = client.delete("/groups/safe-id/files/file-1")
        assert deleted_file.status_code == 200
        assert deleted_file.json() == {"deleted_chunks": 1}

        deleted_group = client.delete("/groups/safe-id")
        assert deleted_group.status_code == 200
        assert deleted_group.json() == {"deleted_chunks": 1}

    def test_debug_search_returns_raw_results(self):
        response = client.post(
            "/debug/search",
            json={"query": "test query", "group_id": "safe-id", "limit": 5},
        )
        assert response.status_code == 200
        body = response.json()
        assert body["results"][0]["chunk_id"] == "chunk-1"
        assert "vector" not in body["results"][0]
