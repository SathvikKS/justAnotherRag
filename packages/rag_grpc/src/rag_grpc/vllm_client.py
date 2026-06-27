from rag_core.config import settings


class MockLlmGrpcClient:
    def __init__(self, target: str = settings.llm_grpc_url):
        self.target = target

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
        target: str = settings.llm_grpc_url,
        model: str = settings.llm_model,
        max_tokens: int = settings.llm_max_tokens,
    ):
        self.target = target
        self.model = model
        self.max_tokens = max_tokens

    def generate_response(self, prompt: str, context: list[str]) -> str:
        # ponytail: vLLM's gRPC proto is owned by vLLM; keep imports lazy so API images do not install vLLM.
        try:
            import grpc
            from vllm.entrypoints.grpc import vllm_engine_pb2, vllm_engine_pb2_grpc
        except ImportError as exc:
            raise RuntimeError(
                "vLLM gRPC client stubs are unavailable. Install vLLM where this client runs "
                "or override get_llm_client in tests/local mock mode."
            ) from exc

        prompt_text = "\n\n".join([*context, prompt])
        request = vllm_engine_pb2.GenerateRequest(
            request_id="rag-chat",
            prompt=prompt_text,
            model=self.model,
            sampling_params={"max_tokens": self.max_tokens, "temperature": 0.2},
            stream=False,
        )
        with grpc.insecure_channel(self.target) as channel:
            stub = vllm_engine_pb2_grpc.VllmEngineStub(channel)
            response = stub.Generate(request)
        return getattr(response, "text", str(response)).strip()
