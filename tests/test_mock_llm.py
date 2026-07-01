import json
import socket
import sys
import types

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

    assert answer == {
        "answer": "Mock answer for: question?",
        "citations": [],
        "insufficient": False,
    }


def test_vllm_client_uses_tokenizer_chat_template():
    class FakeTokenizer:
        chat_template = "template"

        def apply_chat_template(self, messages, tokenize, add_generation_prompt):
            assert tokenize is False
            assert add_generation_prompt is True
            assert messages[0]["role"] == "system"
            assert "without inline citation markers." in messages[0]["content"]
            assert messages[1]["role"] == "user"
            assert "Context:" in messages[1]["content"]
            assert "User request:" in messages[1]["content"]
            return "rendered prompt"

    client = VllmGrpcClient.__new__(VllmGrpcClient)
    client._tokenizer = FakeTokenizer()

    assert client._render_prompt("What?", ["doc.pdf p.1\nContext"]) == "rendered prompt"


def test_vllm_client_citation_prompt_allows_contextual_definitions():
    class FakeTokenizer:
        chat_template = "template"

        def apply_chat_template(self, messages, tokenize, add_generation_prompt):
            system = messages[0]["content"]
            assert "definition-style questions" in system
            assert "reasonably inferable" in system
            assert "without inline citation markers." in system
            assert "set insufficient to true." in system
            assert "respond exactly" not in system
            return "rendered prompt"

    client = VllmGrpcClient.__new__(VllmGrpcClient)
    client._tokenizer = FakeTokenizer()

    assert (
        client._render_prompt(
            "what does somatosensory mean?",
            ["somatosensory.pdf p.1\nOur somatosensory system consists of sensors"],
            require_citations=True,
        )
        == "rendered prompt"
    )


def test_vllm_client_generates_unique_request_ids(monkeypatch):
    requests = []

    class FakeTokenizer:
        def decode(self, token_ids, skip_special_tokens=True):
            return json.dumps(
                {"answer": "ok", "citations": [], "insufficient": False}
            )

    class FakeGenerateRequest:
        def __init__(self, **kwargs):
            self.__dict__.update(kwargs)

    class FakeSamplingParams:
        def __init__(self, **kwargs):
            self.__dict__.update(kwargs)

    class FakeResponse:
        def __init__(self):
            self.complete = types.SimpleNamespace(output_ids=[1, 2, 3])

        def HasField(self, name):
            return name == "complete"

    class FakeStub:
        def __init__(self, channel):
            self.channel = channel

        def Generate(self, request):
            requests.append(request)
            return iter([FakeResponse()])

    class FakeChannel:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

    fake_grpc = types.SimpleNamespace(insecure_channel=lambda target: FakeChannel())
    fake_pb2 = types.SimpleNamespace(
        GenerateRequest=FakeGenerateRequest,
        SamplingParams=FakeSamplingParams,
    )
    fake_pb2_grpc = types.SimpleNamespace(VllmEngineStub=FakeStub)

    monkeypatch.setitem(sys.modules, "grpc", fake_grpc)
    monkeypatch.setitem(
        sys.modules,
        "rag_grpc.vllm_proto.vllm_engine_pb2",
        fake_pb2,
    )
    monkeypatch.setitem(
        sys.modules,
        "rag_grpc.vllm_proto.vllm_engine_pb2_grpc",
        fake_pb2_grpc,
    )

    client = VllmGrpcClient.__new__(VllmGrpcClient)
    client.target = "127.0.0.1:50051"
    client.max_tokens = 16
    client._tokenizer = FakeTokenizer()
    client._render_prompt = lambda *args: "rendered prompt"

    client.generate_response("What?", ["context"])
    client.generate_response("What else?", ["context"])

    assert len(requests) == 2
    assert requests[0].request_id != requests[1].request_id
    assert requests[0].request_id.startswith("rag-chat-")
    assert requests[1].request_id.startswith("rag-chat-")
