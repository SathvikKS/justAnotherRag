from rag_core.config import get_settings


class MockLlmGrpcClient:
    def __init__(self, target: str | None = None):
        self.target = target or get_settings().llm_grpc_url

    def generate_response(self, prompt: str, context: list[str]) -> str:
        import json

        import grpc

        payload = {"prompt": prompt, "context": context}
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

    def generate_response(self, prompt: str, context: list[str]) -> str:
        import grpc

        from rag_grpc.vllm_proto import vllm_engine_pb2, vllm_engine_pb2_grpc

        prompt_text = "\n\n".join([*context, prompt])
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
