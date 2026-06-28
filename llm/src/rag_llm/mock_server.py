import json
import os
import time
from concurrent import futures

import grpc


def serve_mock_llm(port: int) -> grpc.Server:
    def generate(request: bytes, context: grpc.ServicerContext) -> bytes:
        body = json.loads(request.decode("utf-8"))
        answer = f"Mock answer for: {body.get('prompt', '')}"
        response_dict = {
            "answer": answer,
            "citations": [],
            "insufficient": False,
        }
        return json.dumps({"text": json.dumps(response_dict)}).encode("utf-8")

    handler = grpc.unary_unary_rpc_method_handler(
        generate,
        request_deserializer=lambda x: x,
        response_serializer=lambda x: x,
    )
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=2))
    server.add_generic_rpc_handlers(
        (grpc.method_handlers_generic_handler("rag.llm.LLM", {"Generate": handler}),)
    )
    server.add_insecure_port(f"0.0.0.0:{port}")
    server.start()
    return server


def main() -> None:
    port = int(os.getenv("LLM_GRPC_PORT", "50052"))
    server = serve_mock_llm(port)
    print(f"mock llm_service listening on 0.0.0.0:{port}", flush=True)
    try:
        while True:
            time.sleep(86400)
    except KeyboardInterrupt:
        server.stop(5)


if __name__ == "__main__":
    main()
