import json
import time
import uuid

from rag_core.config import get_settings


LLM_RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "answer": {"type": "string"},
        "citations": {
            "type": "array",
            "items": {"type": "integer"},
        },
        "insufficient": {"type": "boolean"},
    },
    "required": ["answer", "citations", "insufficient"],
    "additionalProperties": False,
}

SEARCH_QUESTIONS_SCHEMA = {
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

_INVALID_RESPONSE_MESSAGE = (
    "I couldn't read a complete answer from the model. Please try again."
)
_TRUNCATED_RESPONSE_MESSAGE = "The response was cut off before a complete answer was produced."
_INTERRUPTED_RESPONSE_MESSAGE = "The response ended before completion. Please try again."


def _response_result(
    answer: str,
    citations: list[int] | None = None,
    insufficient: bool = False,
    metrics: dict | None = None,
    completion_status: str = "complete",
) -> dict:
    return {
        "answer": answer,
        "citations": citations or [],
        "insufficient": insufficient,
        "metrics": metrics,
        "completion_status": completion_status,
    }


def _decode_json_string_prefix(text: str, start: int) -> str:
    """Decode a JSON string from its opening quote, preserving a safe prefix.

    A truncated escape or surrogate pair ends extraction at the preceding valid
    text. This deliberately does not invent a closing quote or other JSON syntax.
    """
    decoded: list[str] = []
    index = start + 1
    simple_escapes = {
        '"': '"',
        "\\": "\\",
        "/": "/",
        "b": "\b",
        "f": "\f",
        "n": "\n",
        "r": "\r",
        "t": "\t",
    }

    while index < len(text):
        char = text[index]
        if char == '"':
            return "".join(decoded)
        if char == "\\":
            if index + 1 >= len(text):
                break
            escaped = text[index + 1]
            if escaped in simple_escapes:
                decoded.append(simple_escapes[escaped])
                index += 2
                continue
            if escaped != "u":
                break

            hex_digits = text[index + 2:index + 6]
            if len(hex_digits) != 4 or any(
                digit not in "0123456789abcdefABCDEF" for digit in hex_digits
            ):
                break
            codepoint = int(hex_digits, 16)
            if 0xD800 <= codepoint <= 0xDBFF:
                # JSON encodes non-BMP characters as a high/low surrogate pair.
                low_start = index + 6
                low_digits = text[low_start + 2:low_start + 6]
                if (
                    text[low_start:low_start + 2] != "\\u"
                    or len(low_digits) != 4
                    or any(
                        digit not in "0123456789abcdefABCDEF"
                        for digit in low_digits
                    )
                ):
                    break
                low_codepoint = int(low_digits, 16)
                if not 0xDC00 <= low_codepoint <= 0xDFFF:
                    break
                combined = 0x10000 + ((codepoint - 0xD800) << 10) + (
                    low_codepoint - 0xDC00
                )
                decoded.append(chr(combined))
                index = low_start + 6
                continue
            if 0xDC00 <= codepoint <= 0xDFFF:
                break
            decoded.append(chr(codepoint))
            index += 6
            continue

        codepoint = ord(char)
        if codepoint < 0x20 or 0xD800 <= codepoint <= 0xDFFF:
            break
        decoded.append(char)
        index += 1

    return "".join(decoded)


def _extract_top_level_answer_prefix(text: str) -> str | None:
    """Extract only a top-level answer string from a partial JSON object."""
    index = 0
    while index < len(text) and text[index].isspace():
        index += 1
    if index >= len(text) or text[index] != "{":
        return None
    index += 1
    decoder = json.JSONDecoder()

    while index < len(text):
        while index < len(text) and text[index].isspace():
            index += 1
        if index >= len(text) or text[index] == "}":
            return None
        if text[index] != '"':
            return None
        try:
            key, key_end = decoder.raw_decode(text, index)
        except json.JSONDecodeError:
            return None
        if not isinstance(key, str):
            return None
        index = key_end
        while index < len(text) and text[index].isspace():
            index += 1
        if index >= len(text) or text[index] != ":":
            return None
        index += 1
        while index < len(text) and text[index].isspace():
            index += 1

        if key == "answer":
            if index >= len(text) or text[index] != '"':
                return None
            answer = _decode_json_string_prefix(text, index)
            return answer if answer.strip() else None

        try:
            _, index = decoder.raw_decode(text, index)
        except json.JSONDecodeError:
            return None
        while index < len(text) and text[index].isspace():
            index += 1
        if index >= len(text) or text[index] != ",":
            return None
        index += 1

    return None


def _normalize_unicode_scalars(value: str) -> str | None:
    """Convert valid surrogate pairs and reject unpaired surrogate code points."""
    normalized: list[str] = []
    index = 0
    while index < len(value):
        codepoint = ord(value[index])
        if 0xD800 <= codepoint <= 0xDBFF:
            if index + 1 >= len(value):
                return None
            low_codepoint = ord(value[index + 1])
            if not 0xDC00 <= low_codepoint <= 0xDFFF:
                return None
            combined = 0x10000 + ((codepoint - 0xD800) << 10) + (
                low_codepoint - 0xDC00
            )
            normalized.append(chr(combined))
            index += 2
            continue
        if 0xDC00 <= codepoint <= 0xDFFF:
            return None
        normalized.append(value[index])
        index += 1
    return "".join(normalized)


def _validated_response_payload(
    decoded: str, context: list[str]
) -> tuple[dict | None, str | None]:
    """Return a schema-valid payload and/or a safely recovered answer string."""
    try:
        parsed = json.loads(decoded)
    except json.JSONDecodeError:
        return None, _extract_top_level_answer_prefix(decoded)

    if not isinstance(parsed, dict):
        return None, None

    answer_value = parsed.get("answer")
    answer = (
        _normalize_unicode_scalars(answer_value)
        if isinstance(answer_value, str)
        else None
    )
    safe_answer = answer or _extract_top_level_answer_prefix(decoded)
    required_keys = {"answer", "citations", "insufficient"}
    if set(parsed) != required_keys:
        return None, safe_answer
    citations_value = parsed["citations"]
    if (
        not isinstance(citations_value, list)
        or any(type(citation) is not int for citation in citations_value)
        or answer is None
        or not isinstance(parsed["insufficient"], bool)
    ):
        return None, safe_answer

    citations = sorted({
        citation for citation in citations_value
        if 1 <= citation <= len(context)
    })
    return {
        "answer": answer,
        "citations": citations,
        "insufficient": parsed["insufficient"],
    }, answer


def _incomplete_answer(status: str) -> str:
    if status == "truncated":
        return _TRUNCATED_RESPONSE_MESSAGE
    if status == "interrupted":
        return _INTERRUPTED_RESPONSE_MESSAGE
    return _INVALID_RESPONSE_MESSAGE


class MockLlmGrpcClient:
    def __init__(self, target: str | None = None):
        self.target = target or get_settings().llm_grpc_url

    def generate_response(
        self,
        prompt: str,
        context: list[str],
        require_citations: bool = False,
        history: str = "",
    ) -> dict:
        import json

        import grpc

        payload = {
            "prompt": prompt,
            "context": context,
            "require_citations": require_citations,
            "history": history,
        }
        with grpc.insecure_channel(self.target) as channel:
            call = channel.unary_unary(
                "/rag.llm.LLM/Generate",
                request_serializer=lambda body: json.dumps(body).encode("utf-8"),
                response_deserializer=lambda body: json.loads(body.decode("utf-8")),
            )
            response = call(payload)
        text_response = response.get("text") if isinstance(response, dict) else None
        if not isinstance(text_response, str):
            return _response_result(
                _INVALID_RESPONSE_MESSAGE,
                completion_status="invalid",
            )
        text_response = text_response.strip()
        if not text_response:
            return _response_result(
                _incomplete_answer("invalid"),
                completion_status="invalid",
            )
        try:
            parsed = json.loads(text_response)
        except json.JSONDecodeError:
            # The mock gRPC contract normally returns plain answer text. Treat
            # JSON-looking output as a malformed structured response instead.
            if text_response.startswith(("{", "[")):
                partial_answer = _extract_top_level_answer_prefix(text_response)
                return _response_result(
                    partial_answer or _incomplete_answer("invalid"),
                    completion_status="invalid",
                )
            return _response_result(text_response)

        valid_payload, safe_answer = _validated_response_payload(
            text_response, context
        )
        if valid_payload is None:
            return _response_result(
                safe_answer or _incomplete_answer("invalid"),
                completion_status="invalid",
            )
        return _response_result(**valid_payload)

    def generate_search_questions(self, query: str) -> list[str]:
        import json

        import grpc

        payload = {"operation": "generate_search_questions", "prompt": query}
        with grpc.insecure_channel(self.target) as channel:
            call = channel.unary_unary(
                "/rag.llm.LLM/Generate",
                request_serializer=lambda body: json.dumps(body).encode("utf-8"),
                response_deserializer=lambda body: json.loads(body.decode("utf-8")),
            )
            response = call(payload)
        try:
            parsed = json.loads(str(response["text"]).strip())
        except (KeyError, TypeError, json.JSONDecodeError):
            return []
        questions = parsed.get("questions", []) if isinstance(parsed, dict) else []
        if not isinstance(questions, list):
            return []
        return [question for question in questions if isinstance(question, str)]


class VllmGrpcClient:
    def __init__(
        self,
        target: str | None = None,
        model: str | None = None,
    ):
        settings = get_settings()
        self.target = target or settings.llm_grpc_url
        self.model = model or settings.llm_model
        self._tokenizer = None

    def _get_tokenizer(self):
        if self._tokenizer is None:
            from transformers import AutoTokenizer
            self._tokenizer = AutoTokenizer.from_pretrained(self.model)
        return self._tokenizer

    def _render_prompt(
        self,
        prompt: str,
        context: list[str],
        require_citations: bool = False,
        history: str = "",
    ) -> str:
        if context:
            context_text = "\n\n".join(
                f"[{index}] {text}" for index, text in enumerate(context, start=1)
            )
        else:
            context_text = "No retrieved context was provided."

        history_text = f"\n\nConversation History:\n{history}\n" if history else ""

        user_content = (
            "Context:\n"
            f"{context_text}\n\n"
            f"{history_text}"
            "User request:\n"
            f"{prompt}\n\n"
            "Answer:"
        )
        citation_instruction = (
            " Return JSON matching the required schema. Put the plain user-facing "
            "answer in answer without inline citation markers. Put supporting source "
            "numbers in citations. Set insufficient to true when the retrieved context "
            "is not enough to answer. For meaning, definition, topic, or keyword requests, "
            "answer from what is directly stated or reasonably inferable from the "
            "surrounding context, then cite the source. Do not use background facts "
            "that are absent from the context."
        )
        strict_instruction = (
            " If the context does not mention the requested topic or does not "
            "provide enough surrounding information to answer with citations, "
            "set insufficient to true."
            if require_citations
            else ""
        )
        messages = [
            {
                "role": "system",
                "content": (
                    "You are a document QA assistant. Use only the provided "
                    "context to answer the user's request. If the user provides "
                    "only a topic or keyword, summarize what the context says "
                    "about that topic. For definition-style questions, explain "
                    "the term using the surrounding context instead of requiring "
                    "a dictionary-style definition. If the context is irrelevant "
                    "or insufficient, set insufficient to true. Do "
                    "not translate, summarize unrelated content, or invent facts "
                    "unless the user asks."
                    f"{citation_instruction}"
                    f"{strict_instruction}"
                ),
            },
            {"role": "user", "content": user_content},
        ]
        tokenizer = self._get_tokenizer()
        if getattr(tokenizer, "chat_template", None):
            return tokenizer.apply_chat_template(
                messages,
                tokenize=False,
                add_generation_prompt=True,
            )
        return "\n\n".join(
            [
                f"System: {messages[0]['content']}",
                f"User: {messages[1]['content']}",
                "Assistant:",
            ]
        )

    def _render_search_questions_prompt(self, query: str) -> str:
        messages = [
            {
                "role": "system",
                "content": (
                    "Generate exactly five distinct, concise questions that can be "
                    "used independently to search a document collection for material "
                    "relevant to the user's query. Preserve the query's intent, cover "
                    "useful facets, and do not answer it. Return only JSON matching "
                    "the required schema."
                ),
            },
            {"role": "user", "content": f"User query:\n{query}"},
        ]
        tokenizer = self._get_tokenizer()
        if getattr(tokenizer, "chat_template", None):
            return tokenizer.apply_chat_template(
                messages,
                tokenize=False,
                add_generation_prompt=True,
            )
        return "\n\n".join(
            [
                f"System: {messages[0]['content']}",
                f"User: {messages[1]['content']}",
                "Assistant:",
            ]
        )

    def generate_response(
        self,
        prompt: str,
        context: list[str],
        require_citations: bool = False,
        history: str = "",
    ) -> dict:
        import grpc

        from rag_grpc.vllm_proto import vllm_engine_pb2, vllm_engine_pb2_grpc

        prompt_text = self._render_prompt(prompt, context, require_citations, history)
        tokenizer = self._get_tokenizer()
        prompt_token_count = len(tokenizer.encode(prompt_text))
        request = vllm_engine_pb2.GenerateRequest(
            request_id=f"rag-chat-{uuid.uuid4()}",
            text=prompt_text,
            sampling_params=vllm_engine_pb2.SamplingParams(
                temperature=0.2,
                json_schema=json.dumps(LLM_RESPONSE_SCHEMA),
            ),
            stream=False,
        )
        started_at = time.perf_counter()
        with grpc.insecure_channel(self.target) as channel:
            stub = vllm_engine_pb2_grpc.VllmEngineStub(channel)
            token_ids = []
            completion = None
            received_output_chunk = False
            try:
                for response in stub.Generate(request):
                    if response.HasField("complete"):
                        completion = response.complete
                        token_ids = list(response.complete.output_ids)
                        break
                    if response.HasField("chunk"):
                        received_output_chunk = True
                        token_ids.extend(response.chunk.token_ids)
            except grpc.RpcError:
                # Keep chunks already received, but do not claim completion
                # unless the final frame arrived.
                if not received_output_chunk:
                    raise
        elapsed_seconds = time.perf_counter() - started_at
        completion_token_count = len(token_ids)
        metrics = {
            "session_tps": round(
                completion_token_count / elapsed_seconds, 1
            ) if elapsed_seconds > 0 else 0.0,
            "prompt_tokens": prompt_token_count,
            "completion_tokens": completion_token_count,
            "total_context_used": prompt_token_count + completion_token_count,
        }
        finish_reason = (
            getattr(completion, "finish_reason", "")
            if completion is not None
            else ""
        )
        if completion is None:
            completion_status = "interrupted"
        elif str(finish_reason).lower() == "length":
            completion_status = "truncated"
        elif str(finish_reason).lower() == "stop":
            completion_status = "complete"
        else:
            completion_status = "interrupted"

        decoded = tokenizer.decode(token_ids, skip_special_tokens=True).strip()
        valid_payload, safe_answer = _validated_response_payload(decoded, context)
        if completion_status == "complete" and valid_payload is None:
            completion_status = "invalid"

        if valid_payload is not None:
            return _response_result(
                **valid_payload,
                metrics=metrics,
                completion_status=completion_status,
            )

        return _response_result(
            safe_answer or _incomplete_answer(completion_status),
            metrics=metrics,
            completion_status=completion_status,
        )

    def generate_search_questions(self, query: str) -> list[str]:
        import grpc

        from rag_grpc.vllm_proto import vllm_engine_pb2, vllm_engine_pb2_grpc

        prompt_text = self._render_search_questions_prompt(query)
        tokenizer = self._get_tokenizer()
        request = vllm_engine_pb2.GenerateRequest(
            request_id=f"rag-query-expansion-{uuid.uuid4()}",
            text=prompt_text,
            sampling_params=vllm_engine_pb2.SamplingParams(
                temperature=0.2,
                json_schema=json.dumps(SEARCH_QUESTIONS_SCHEMA),
            ),
            stream=False,
        )
        with grpc.insecure_channel(self.target) as channel:
            stub = vllm_engine_pb2_grpc.VllmEngineStub(channel)
            token_ids = []
            for response in stub.Generate(request):
                if response.HasField("complete"):
                    token_ids = list(response.complete.output_ids)
                    break
                if response.HasField("chunk"):
                    token_ids.extend(response.chunk.token_ids)
        if not token_ids:
            return []
        try:
            parsed = json.loads(tokenizer.decode(token_ids, skip_special_tokens=True).strip())
        except (TypeError, json.JSONDecodeError):
            return []
        questions = parsed.get("questions", []) if isinstance(parsed, dict) else []
        if not isinstance(questions, list):
            return []
        return [question for question in questions if isinstance(question, str)]


class AutoLlmGrpcClient:
    """Select the mock or vLLM gRPC contract exposed by the configured endpoint."""

    def __init__(
        self,
        target: str | None = None,
        model: str | None = None,
    ):
        self._mock_client = MockLlmGrpcClient(target)
        self._vllm_client = VllmGrpcClient(target, model)
        self._backend: str | None = None

    def generate_response(
        self,
        prompt: str,
        context: list[str],
        require_citations: bool = False,
        history: str = "",
    ) -> dict:
        if self._backend == "mock":
            return self._mock_client.generate_response(
                prompt,
                context,
                require_citations=require_citations,
                history=history,
            )
        if self._backend == "vllm":
            return self._vllm_client.generate_response(
                prompt,
                context,
                require_citations=require_citations,
                history=history,
            )

        import grpc

        try:
            response = self._mock_client.generate_response(
                prompt,
                context,
                require_citations=require_citations,
                history=history,
            )
        except grpc.RpcError:
            response = self._vllm_client.generate_response(
                prompt,
                context,
                require_citations=require_citations,
                history=history,
            )
            self._backend = "vllm"
        else:
            self._backend = "mock"
        return response

    def generate_search_questions(self, query: str) -> list[str]:
        if self._backend == "mock":
            return self._mock_client.generate_search_questions(query)
        if self._backend == "vllm":
            return self._vllm_client.generate_search_questions(query)

        import grpc

        try:
            questions = self._mock_client.generate_search_questions(query)
        except grpc.RpcError:
            questions = self._vllm_client.generate_search_questions(query)
            self._backend = "vllm"
        else:
            self._backend = "mock"
        return questions
