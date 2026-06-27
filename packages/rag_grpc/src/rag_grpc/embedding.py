import json
from concurrent import futures
from typing import Callable

import grpc


EMBED_METHOD = "/rag.embedding.Embedding/Embed"


def _dumps(value: dict) -> bytes:
    return json.dumps(value).encode("utf-8")


def _loads(value: bytes) -> dict:
    return json.loads(value.decode("utf-8"))


class EmbeddingClient:
    def __init__(self, target: str):
        self.target = target

    def embed_text(self, text: str) -> list[float]:
        return self.embed_texts([text])[0]

    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        with grpc.insecure_channel(self.target) as channel:
            call = channel.unary_unary(
                EMBED_METHOD,
                request_serializer=_dumps,
                response_deserializer=_loads,
            )
            body = call({"texts": texts})

        vectors = body["vectors"]
        for vector in vectors:
            if len(vector) != 384:
                raise ValueError(f"Expected 384 dimensions, got {len(vector)}")
        return [[float(x) for x in vector] for vector in vectors]


def serve_embedding(
    embed_texts: Callable[[list[str]], list[list[float]]],
    host: str = "0.0.0.0",
    port: int = 50051,
) -> grpc.Server:
    def embed(request: bytes, context: grpc.ServicerContext) -> bytes:
        texts = _loads(request).get("texts", [])
        vectors = embed_texts(texts)
        return _dumps({"vectors": vectors, "dimension": 384})

    handler = grpc.unary_unary_rpc_method_handler(
        embed,
        request_deserializer=lambda x: x,
        response_serializer=lambda x: x,
    )
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=4))
    server.add_generic_rpc_handlers(
        (grpc.method_handlers_generic_handler("rag.embedding.Embedding", {"Embed": handler}),)
    )
    server.add_insecure_port(f"{host}:{port}")
    server.start()
    return server
