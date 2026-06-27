import os
import time

from rag_grpc.embedding import serve_embedding
from rag_embedding.engine import SentenceTransformerEngine


def main() -> None:
    engine = SentenceTransformerEngine()
    port = int(os.getenv("EMBEDDING_GRPC_PORT", "50051"))
    server = serve_embedding(engine.embed_texts, port=port)
    print(f"embedding_service listening on 0.0.0.0:{port}", flush=True)
    try:
        while True:
            time.sleep(86400)
    except KeyboardInterrupt:
        server.stop(5)


if __name__ == "__main__":
    main()
