import socket

from rag_grpc.embedding import EmbeddingClient, serve_embedding


def test_embedding_grpc_service_returns_384_dim_vectors():
    def fake_embed(texts):
        return [[float(len(text))] * 384 for text in texts]

    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    server = serve_embedding(fake_embed, host="127.0.0.1", port=port)
    try:
        vectors = EmbeddingClient(f"127.0.0.1:{port}").embed_texts(["abc", "hello"])
    finally:
        server.stop(0)

    assert vectors == [[3.0] * 384, [5.0] * 384]
