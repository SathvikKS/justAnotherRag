import socket

from rag_grpc import MockLlmGrpcClient
from rag_grpc.vllm_client import VllmGrpcClient
from rag_llm.mock_server import serve_mock_llm


def test_llm_provider_mock_selects_mock_client(monkeypatch):
    from rag_api import dependencies
    from rag_core.config import get_settings

    monkeypatch.setenv("LLM_PROVIDER", "mock")
    get_settings.cache_clear()
    dependencies.get_llm_client.cache_clear()
    try:
        assert isinstance(dependencies.get_llm_client(), MockLlmGrpcClient)
    finally:
        dependencies.get_llm_client.cache_clear()
        get_settings.cache_clear()


def test_mock_llm_client_calls_mock_server():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]

    server = serve_mock_llm(port)
    try:
        answer = MockLlmGrpcClient(f"127.0.0.1:{port}").generate_response(
            "question?",
            ["context"],
        )
    finally:
        server.stop(0)

    assert answer == "Mock answer for: question?"


def test_vllm_client_uses_tokenizer_chat_template():
    class FakeTokenizer:
        chat_template = "template"

        def apply_chat_template(self, messages, tokenize, add_generation_prompt):
            assert tokenize is False
            assert add_generation_prompt is True
            assert messages[0]["role"] == "system"
            assert messages[1]["role"] == "user"
            assert "Context:" in messages[1]["content"]
            assert "User request:" in messages[1]["content"]
            return "rendered prompt"

    client = VllmGrpcClient.__new__(VllmGrpcClient)
    client._tokenizer = FakeTokenizer()

    assert client._render_prompt("What?", ["doc.pdf p.1\nContext"]) == "rendered prompt"
