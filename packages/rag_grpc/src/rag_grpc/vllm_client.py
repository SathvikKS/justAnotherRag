from rag_core.config import get_settings


class MockLlmGrpcClient:
    def __init__(self, target: str | None = None):
        self.target = target or get_settings().llm_grpc_url

    def generate_response(
        self,
        prompt: str,
        context: list[str],
        require_citations: bool = False,
    ) -> str:
        import json

        import grpc

        payload = {
            "prompt": prompt,
            "context": context,
            "require_citations": require_citations,
        }
        with grpc.insecure_channel(self.target) as channel:
            call = channel.unary_unary(
                "/rag.llm.LLM/Generate",
                request_serializer=lambda body: json.dumps(body).encode("utf-8"),
                response_deserializer=lambda body: json.loads(body.decode("utf-8")),
            )
            response = call(payload)
        return str(response["text"]).strip()


class VllmGrpcClient:
    def __init__(
        self,
        target: str | None = None,
        model: str | None = None,
        max_tokens: int | None = None,
    ):
        settings = get_settings()
        self.target = target or settings.llm_grpc_url
        self.model = model or settings.llm_model
        self.max_tokens = max_tokens or settings.llm_max_tokens
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
    ) -> str:
        if context:
            context_text = "\n\n".join(
                f"[{index}] {text}" for index, text in enumerate(context, start=1)
            )
        else:
            context_text = "No retrieved context was provided."

        user_content = (
            "Context:\n"
            f"{context_text}\n\n"
            "User request:\n"
            f"{prompt}\n\n"
            "Answer:"
        )
        citation_instruction = (
            " Cite document-backed claims using the provided source numbers "
            "like [1]. For meaning, definition, topic, or keyword requests, "
            "answer from what is directly stated or reasonably inferable from "
            "the surrounding context, then cite the source. Do not use "
            "background facts that are absent from the context."
        )
        strict_instruction = (
            " If the context does not mention the requested topic or does not "
            "provide enough surrounding information to answer with citations, "
            "respond exactly: I don't have enough information in the provided "
            "documents."
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
                    "or insufficient, say you do not have enough information. Do "
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

    def generate_response(
        self,
        prompt: str,
        context: list[str],
        require_citations: bool = False,
    ) -> str:
        import grpc

        from rag_grpc.vllm_proto import vllm_engine_pb2, vllm_engine_pb2_grpc

        prompt_text = self._render_prompt(prompt, context, require_citations)
        request = vllm_engine_pb2.GenerateRequest(
            request_id="rag-chat",
            text=prompt_text,
            sampling_params=vllm_engine_pb2.SamplingParams(
                max_tokens=self.max_tokens,
                temperature=0.2,
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
            return ""
        tokenizer = self._get_tokenizer()
        return tokenizer.decode(token_ids, skip_special_tokens=True).strip()
