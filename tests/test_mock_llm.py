import socket

from rag_grpc import MockLlmGrpcClient
from rag_llm.mock_server import serve_mock_llm


def test_llm_provider_mock_selects_mock_client(monkeypatch):
    from rag_api import dependencies

    monkeypatch.setattr(dependencies.settings, "llm_provider", "mock")
    dependencies.get_llm_client.cache_clear()
    try:
        assert isinstance(dependencies.get_llm_client(), MockLlmGrpcClient)
    finally:
        dependencies.get_llm_client.cache_clear()


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
