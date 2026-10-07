import json
import socket
import sys
import types

import grpc
import pytest

from rag_grpc import AutoLlmGrpcClient, MockLlmGrpcClient
from rag_grpc.vllm_client import VllmGrpcClient
from rag_llm.mock_server import serve_mock_llm


class _FakeRpcError(Exception):
    pass


def _has_max_tokens(sampling_params):
    if hasattr(sampling_params, "HasField"):
        return sampling_params.HasField("max_tokens")
    return "max_tokens" in vars(sampling_params)


def _run_vllm_response(
    monkeypatch,
    decoded,
    *,
    finish_reason="stop",
    include_complete=True,
    chunk_token_ids=None,
    stream_error=False,
):
    requests = []

    class FakeTokenizer:
        def encode(self, text):
            return [101, 102]

        def decode(self, token_ids, skip_special_tokens=True):
            return decoded

    class FakeGenerateRequest:
        def __init__(self, **kwargs):
            self.__dict__.update(kwargs)

    class FakeSamplingParams:
        def __init__(self, **kwargs):
            self.__dict__.update(kwargs)

    class FakeComplete:
        def __init__(self):
            self.output_ids = [1, 2, 3]
            self.finish_reason = finish_reason

        def __bool__(self):
            return False

    class FakeResponse:
        def __init__(self, *, with_complete=False, with_chunk=False):
            if with_complete:
                self.complete = FakeComplete()
            if with_chunk:
                self.chunk = types.SimpleNamespace(token_ids=chunk_token_ids)

        def HasField(self, name):
            return hasattr(self, name)

    class FakeStub:
        def __init__(self, channel):
            self.channel = channel

        def Generate(self, request):
            requests.append(request)

            def frames():
                if chunk_token_ids is not None:
                    yield FakeResponse(with_chunk=True)
                if stream_error:
                    raise _FakeRpcError("generation stream interrupted")
                if include_complete:
                    yield FakeResponse(with_complete=True)

            return frames()

    class FakeChannel:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

    monkeypatch.setitem(
        sys.modules,
        "grpc",
        types.SimpleNamespace(
            insecure_channel=lambda target: FakeChannel(),
            RpcError=_FakeRpcError,
        ),
    )
    monkeypatch.setitem(
        sys.modules,
        "rag_grpc.vllm_proto.vllm_engine_pb2",
        types.SimpleNamespace(
            GenerateRequest=FakeGenerateRequest,
            SamplingParams=FakeSamplingParams,
        ),
    )
    monkeypatch.setitem(
        sys.modules,
        "rag_grpc.vllm_proto.vllm_engine_pb2_grpc",
        types.SimpleNamespace(VllmEngineStub=FakeStub),
    )

    client = VllmGrpcClient.__new__(VllmGrpcClient)
    client.target = "127.0.0.1:50051"
    client._tokenizer = FakeTokenizer()
    client._render_prompt = lambda *args: "rendered prompt"

    result = client.generate_response("What?", ["context"])
    return result, requests[0]


def _run_mock_response(monkeypatch, text):
    class FakeCall:
        def __call__(self, payload):
            return {"text": text}

    class FakeChannel:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def unary_unary(self, *args, **kwargs):
            return FakeCall()

    monkeypatch.setitem(
        sys.modules,
        "grpc",
        types.SimpleNamespace(insecure_channel=lambda target: FakeChannel()),
    )
    return MockLlmGrpcClient("127.0.0.1:50052").generate_response("question", [])


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


def test_llm_provider_auto_selects_auto_client(monkeypatch):
    from rag_api import dependencies
    from rag_core.config import get_settings

    monkeypatch.setenv("LLM_PROVIDER", "auto")
    get_settings.cache_clear()
    dependencies.get_llm_client.cache_clear()
    try:
        assert isinstance(dependencies.get_llm_client(), AutoLlmGrpcClient)
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
        "metrics": None,
        "completion_status": "complete",
    }


def test_mock_llm_client_marks_malformed_json_invalid_and_salvages_answer(monkeypatch):
    result = _run_mock_response(
        monkeypatch,
        '{"answer":"A safe prefix \\"quoted\\" and \\\\path',
    )

    assert result["answer"] == 'A safe prefix "quoted" and \\path'
    assert result["citations"] == []
    assert result["insufficient"] is False
    assert result["completion_status"] == "invalid"


def test_mock_llm_client_does_not_expose_raw_json_when_no_answer_is_safe(monkeypatch):
    raw_json = '{"citations":[1'
    result = _run_mock_response(monkeypatch, raw_json)

    assert result["completion_status"] == "invalid"
    assert raw_json not in result["answer"]
    assert result["citations"] == []
    assert result["insufficient"] is False


def test_mock_llm_client_generates_search_questions():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]

    server = serve_mock_llm(port)
    try:
        questions = MockLlmGrpcClient(f"127.0.0.1:{port}").generate_search_questions(
            "vector search"
        )
    finally:
        server.stop(0)

    assert len(questions) == 5
    assert len(set(questions)) == 5
    assert all("vector search" in question for question in questions)


def test_auto_llm_client_uses_mock_backend_and_caches_selection():
    class FakeMockClient:
        def __init__(self):
            self.calls = 0

        def generate_response(self, *args, **kwargs):
            self.calls += 1
            return {"answer": "mock", "citations": [], "insufficient": False}

    class FailingVllmClient:
        def generate_response(self, *args, **kwargs):
            raise AssertionError("vLLM backend should not be called")

    client = AutoLlmGrpcClient.__new__(AutoLlmGrpcClient)
    client._mock_client = FakeMockClient()
    client._vllm_client = FailingVllmClient()
    client._backend = None

    assert client.generate_response("question", [])["answer"] == "mock"
    assert client.generate_response("question again", [])["answer"] == "mock"
    assert client._mock_client.calls == 2
    assert client._backend == "mock"


def test_auto_llm_client_calls_mock_server():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]

    server = serve_mock_llm(port)
    try:
        answer = AutoLlmGrpcClient(f"127.0.0.1:{port}").generate_response(
            "question?",
            ["context"],
        )
    finally:
        server.stop(0)

    assert answer["answer"] == "Mock answer for: question?"


def test_auto_llm_client_falls_back_to_vllm_backend():
    class FailingMockClient:
        def __init__(self):
            self.calls = 0

        def generate_response(self, *args, **kwargs):
            self.calls += 1
            raise grpc.RpcError("mock protocol unavailable")

    class FakeVllmClient:
        def __init__(self):
            self.calls = 0

        def generate_response(self, *args, **kwargs):
            self.calls += 1
            return {"answer": "vllm", "citations": [], "insufficient": False}

    client = AutoLlmGrpcClient.__new__(AutoLlmGrpcClient)
    client._mock_client = FailingMockClient()
    client._vllm_client = FakeVllmClient()
    client._backend = None

    assert client.generate_response("question", [])["answer"] == "vllm"
    assert client.generate_response("question again", [])["answer"] == "vllm"
    assert client._mock_client.calls == 1
    assert client._vllm_client.calls == 2
    assert client._backend == "vllm"


def test_auto_llm_client_selects_backend_on_expansion_and_reuses_it():
    class FakeMockClient:
        def __init__(self):
            self.expansions = 0
            self.answers = 0

        def generate_search_questions(self, query):
            self.expansions += 1
            return [f"mock search for {query}"]

        def generate_response(self, *args, **kwargs):
            self.answers += 1
            return {"answer": "mock final", "citations": [], "insufficient": False}

    class FailingVllmClient:
        def generate_search_questions(self, query):
            raise AssertionError("vLLM backend should not be called")

        def generate_response(self, *args, **kwargs):
            raise AssertionError("vLLM backend should not be called")

    client = AutoLlmGrpcClient.__new__(AutoLlmGrpcClient)
    client._mock_client = FakeMockClient()
    client._vllm_client = FailingVllmClient()
    client._backend = None

    assert client.generate_search_questions("query") == ["mock search for query"]
    assert client._backend == "mock"
    assert client.generate_response("query", [])["answer"] == "mock final"
    assert client._mock_client.expansions == 1
    assert client._mock_client.answers == 1


def test_auto_llm_client_expansion_falls_back_to_vllm_and_caches_backend():
    class FailingMockClient:
        def __init__(self):
            self.expansions = 0
            self.answers = 0

        def generate_search_questions(self, query):
            self.expansions += 1
            raise grpc.RpcError("mock protocol unavailable")

        def generate_response(self, *args, **kwargs):
            self.answers += 1
            raise AssertionError("mock backend should remain unused")

    class FakeVllmClient:
        def __init__(self):
            self.expansions = 0
            self.answers = 0

        def generate_search_questions(self, query):
            self.expansions += 1
            return [f"vllm search for {query}"]

        def generate_response(self, *args, **kwargs):
            self.answers += 1
            return {"answer": "vllm final", "citations": [], "insufficient": False}

    client = AutoLlmGrpcClient.__new__(AutoLlmGrpcClient)
    client._mock_client = FailingMockClient()
    client._vllm_client = FakeVllmClient()
    client._backend = None

    assert client.generate_search_questions("query") == ["vllm search for query"]
    assert client._backend == "vllm"
    assert client.generate_response("query", [])["answer"] == "vllm final"
    assert client._mock_client.expansions == 1
    assert client._mock_client.answers == 0
    assert client._vllm_client.expansions == 1
    assert client._vllm_client.answers == 1


def test_vllm_client_has_no_application_output_cap(monkeypatch):
    monkeypatch.setattr(
        "rag_grpc.vllm_client.get_settings",
        lambda: types.SimpleNamespace(
            llm_grpc_url="localhost:50052",
            llm_model="example/model",
        ),
    )

    assert not hasattr(VllmGrpcClient(), "max_tokens")


def test_vllm_grpc_sampling_params_leave_output_limit_unset():
    from rag_grpc.vllm_proto import vllm_engine_pb2

    params = vllm_engine_pb2.SamplingParams(
        temperature=0.2,
        json_schema="{}",
    )
    assert not params.HasField("max_tokens")


def test_vllm_client_marks_length_finish_reason_truncated_even_for_valid_json(
    monkeypatch,
):
    result, request = _run_vllm_response(
        monkeypatch,
        json.dumps({"answer": "Partial answer", "citations": [1], "insufficient": False}),
        finish_reason="length",
    )

    assert result["answer"] == "Partial answer"
    assert result["citations"] == [1]
    assert result["insufficient"] is False
    assert result["completion_status"] == "truncated"
    assert not _has_max_tokens(request.sampling_params)


@pytest.mark.parametrize("finish_reason", ["", None, "unexpected"])
def test_vllm_client_marks_unknown_finish_reason_interrupted(
    monkeypatch, finish_reason
):
    result, _ = _run_vllm_response(
        monkeypatch,
        json.dumps({"answer": "Readable answer", "citations": [], "insufficient": False}),
        finish_reason=finish_reason,
    )

    assert result["answer"] == "Readable answer"
    assert result["completion_status"] == "interrupted"


def test_vllm_client_salvages_escaped_answer_prefix_from_cut_json(monkeypatch):
    result, _ = _run_vllm_response(
        monkeypatch,
        '{"answer":"Name: \\"East\\", path \\\\srv, emoji \\uD83D\\uDE42',
        finish_reason="length",
    )

    assert result["answer"] == 'Name: "East", path \\srv, emoji 🙂'
    assert result["citations"] == []
    assert result["insufficient"] is False
    assert result["completion_status"] == "truncated"


def test_vllm_client_salvages_markdown_newlines_from_top_level_answer(monkeypatch):
    answer = "| Item | Price |\n| --- | --- |\n| Paper | $3 |"
    decoded = (
        '{"metadata":{"answer":"misleading nested value"},"answer":'
        f'{json.dumps(answer)},"citations":['
    )

    result, _ = _run_vllm_response(
        monkeypatch,
        decoded,
        finish_reason="length",
    )

    assert result["answer"] == answer
    assert "\n| --- | --- |\n" in result["answer"]
    assert "misleading nested value" not in result["answer"]
    assert not result["answer"].startswith("{")
    assert result["completion_status"] == "truncated"


def test_vllm_client_drops_partial_unicode_escape_from_salvaged_answer(monkeypatch):
    result, _ = _run_vllm_response(
        monkeypatch,
        '{"answer":"Before emoji \\uD83D\\uD',
        finish_reason="length",
    )

    assert result["answer"] == "Before emoji "
    assert result["completion_status"] == "truncated"


def test_vllm_client_marks_missing_final_frame_interrupted(monkeypatch):
    result, _ = _run_vllm_response(
        monkeypatch,
        json.dumps({"answer": "Readable prefix", "citations": [1], "insufficient": False}),
        include_complete=False,
        chunk_token_ids=[1, 2, 3],
    )

    assert result["answer"] == "Readable prefix"
    assert result["completion_status"] == "interrupted"


def test_vllm_client_keeps_partial_answer_when_grpc_stream_raises(monkeypatch):
    result, _ = _run_vllm_response(
        monkeypatch,
        '{"answer":"Readable partial answer',
        chunk_token_ids=[1, 2, 3],
        stream_error=True,
    )

    assert result["answer"] == "Readable partial answer"
    assert result["citations"] == []
    assert result["insufficient"] is False
    assert result["completion_status"] == "interrupted"


def test_vllm_client_propagates_stream_error_before_any_tokens(
    monkeypatch,
):
    with pytest.raises(_FakeRpcError, match="generation stream interrupted"):
        _run_vllm_response(
            monkeypatch,
            "",
            stream_error=True,
        )


def test_vllm_client_rejects_schema_invalid_citations_without_synthesizing_fields(
    monkeypatch,
):
    result, _ = _run_vllm_response(
        monkeypatch,
        json.dumps({"answer": "Readable answer", "citations": [1, True], "insufficient": True}),
    )

    assert result["answer"] == "Readable answer"
    assert result["citations"] == []
    assert result["insufficient"] is False
    assert result["completion_status"] == "invalid"


def test_vllm_client_rejects_lone_surrogate_and_returns_safe_answer_prefix(
    monkeypatch,
):
    result, _ = _run_vllm_response(
        monkeypatch,
        r'{"answer":"prefix \ud800","citations":[],"insufficient":false}',
    )

    assert result["answer"] == "prefix "
    assert not any(0xD800 <= ord(char) <= 0xDFFF for char in result["answer"])
    assert result["completion_status"] == "invalid"


def test_vllm_client_drops_raw_lone_surrogate_from_salvaged_answer(monkeypatch):
    raw_surrogate = chr(0xD800)
    result, _ = _run_vllm_response(
        monkeypatch,
        '{"answer":"prefix ' + raw_surrogate + 'tail',
        finish_reason="length",
    )

    assert result["answer"] == "prefix "
    assert not any(0xD800 <= ord(char) <= 0xDFFF for char in result["answer"])
    assert result["completion_status"] == "truncated"


def test_vllm_client_normalizes_valid_surrogate_pair(monkeypatch):
    result, _ = _run_vllm_response(
        monkeypatch,
        r'{"answer":"emoji \ud83d\ude42","citations":[],"insufficient":false}',
    )

    assert result["answer"] == "emoji 🙂"
    assert result["completion_status"] == "complete"


def test_vllm_client_hides_unrecoverable_raw_json(monkeypatch):
    raw_json = '{"citations":[1'
    result, _ = _run_vllm_response(monkeypatch, raw_json)

    assert result["completion_status"] == "invalid"
    assert raw_json not in result["answer"]
    assert result["citations"] == []
    assert result["insufficient"] is False


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
        def encode(self, text):
            return [101, 102]

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
            self.complete = types.SimpleNamespace(
                output_ids=[1, 2, 3], finish_reason="stop"
            )

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
    client._tokenizer = FakeTokenizer()
    client._render_prompt = lambda *args: "rendered prompt"

    client.generate_response("What?", ["context"])
    client.generate_response("What else?", ["context"])

    assert len(requests) == 2
    assert requests[0].request_id != requests[1].request_id
    assert requests[0].request_id.startswith("rag-chat-")
    assert requests[1].request_id.startswith("rag-chat-")


def test_vllm_client_generates_search_questions_with_separate_schema(monkeypatch):
    requests = []
    rendered_messages = []

    class FakeTokenizer:
        chat_template = "template"

        def apply_chat_template(self, messages, tokenize, add_generation_prompt):
            rendered_messages.extend(messages)
            assert tokenize is False
            assert add_generation_prompt is True
            return "expanded query prompt"

        def decode(self, token_ids, skip_special_tokens=True):
            assert token_ids == [11, 12]
            return json.dumps(
                {
                    "questions": [
                        "first?", "second?", "third?", "fourth?", "fifth?",
                    ]
                }
            )

    class FakeGenerateRequest:
        def __init__(self, **kwargs):
            self.__dict__.update(kwargs)

    class FakeSamplingParams:
        def __init__(self, **kwargs):
            self.__dict__.update(kwargs)

    class FakeResponse:
        def __init__(self):
            self.complete = types.SimpleNamespace(output_ids=[11, 12])

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

    monkeypatch.setitem(
        sys.modules,
        "grpc",
        types.SimpleNamespace(insecure_channel=lambda target: FakeChannel()),
    )
    monkeypatch.setitem(
        sys.modules,
        "rag_grpc.vllm_proto.vllm_engine_pb2",
        types.SimpleNamespace(
            GenerateRequest=FakeGenerateRequest,
            SamplingParams=FakeSamplingParams,
        ),
    )
    monkeypatch.setitem(
        sys.modules,
        "rag_grpc.vllm_proto.vllm_engine_pb2_grpc",
        types.SimpleNamespace(VllmEngineStub=FakeStub),
    )

    client = VllmGrpcClient.__new__(VllmGrpcClient)
    client.target = "127.0.0.1:50051"
    client._tokenizer = FakeTokenizer()

    assert client.generate_search_questions("How does vector search work?") == [
        "first?", "second?", "third?", "fourth?", "fifth?",
    ]
    assert requests[0].text == "expanded query prompt"
    assert not _has_max_tokens(requests[0].sampling_params)
    assert requests[0].sampling_params.json_schema == json.dumps(
        {
            "type": "object",
            "properties": {
                "questions": {
                    "type": "array",
                    "items": {"type": "string"},
                    "minItems": 5,
                    "maxItems": 5,
                },
            },
            "required": ["questions"],
            "additionalProperties": False,
        }
    )
    system = rendered_messages[0]["content"]
    assert "exactly five distinct" in system
    assert "do not answer it" in system
    assert rendered_messages[1]["content"] == "User query:\nHow does vector search work?"


def test_vllm_client_reports_metrics(monkeypatch):
    class FakeTokenizer:
        def encode(self, text):
            assert text == "rendered prompt"
            return [101, 102, 103, 104]

        def decode(self, token_ids, skip_special_tokens=True):
            assert token_ids == [1, 2, 3]
            return json.dumps(
                {"answer": "ok", "citations": [1], "insufficient": False}
            )

    class FakeGenerateRequest:
        def __init__(self, **kwargs):
            self.__dict__.update(kwargs)

    class FakeSamplingParams:
        def __init__(self, **kwargs):
            self.__dict__.update(kwargs)

    class FakeResponse:
        def __init__(self):
            self.complete = types.SimpleNamespace(
                output_ids=[1, 2, 3], finish_reason="stop"
            )

        def HasField(self, name):
            return name == "complete"

    class FakeStub:
        def __init__(self, channel):
            self.channel = channel

        def Generate(self, request):
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

    perf_counter_values = iter([10.0, 10.5])

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
    monkeypatch.setattr(
        "rag_grpc.vllm_client.time.perf_counter",
        lambda: next(perf_counter_values),
    )

    client = VllmGrpcClient.__new__(VllmGrpcClient)
    client.target = "127.0.0.1:50051"
    client._tokenizer = FakeTokenizer()
    client._render_prompt = lambda *args: "rendered prompt"

    result = client.generate_response("What?", ["context"])

    assert result == {
        "answer": "ok",
        "citations": [1],
        "insufficient": False,
        "metrics": {
            "session_tps": 6.0,
            "prompt_tokens": 4,
            "completion_tokens": 3,
            "total_context_used": 7,
        },
        "completion_status": "complete",
    }
