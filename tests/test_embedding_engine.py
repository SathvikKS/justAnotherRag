from rag_embedding.engine import LangChainEmbeddingEngine


def test_langchain_embedding_engine_batches_and_normalizes(monkeypatch):
    captured = {}

    class FakeEmbeddings:
        def __init__(self, model_name, encode_kwargs):
            captured["model_name"] = model_name
            captured["encode_kwargs"] = encode_kwargs

        def embed_documents(self, texts):
            return [[float(len(text))] * 384 for text in texts]

    monkeypatch.setattr(
        "rag_embedding.engine._load_embedding_cls",
        lambda: FakeEmbeddings,
    )

    engine = LangChainEmbeddingEngine("BAAI/bge-small-en-v1.5")
    vectors = engine.embed_texts(["abc", "hello"])

    assert captured == {
        "model_name": "BAAI/bge-small-en-v1.5",
        "encode_kwargs": {"normalize_embeddings": True},
    }
    assert vectors == [[3.0] * 384, [5.0] * 384]
    assert engine.embed_text("abc") == [3.0] * 384


def test_langchain_embedding_engine_rejects_wrong_dimension(monkeypatch):
    class FakeEmbeddings:
        def __init__(self, model_name, encode_kwargs):
            pass

        def embed_documents(self, texts):
            return [[1.0] * 10 for _ in texts]

    monkeypatch.setattr(
        "rag_embedding.engine._load_embedding_cls",
        lambda: FakeEmbeddings,
    )

    engine = LangChainEmbeddingEngine("BAAI/bge-small-en-v1.5")

    try:
        engine.embed_texts(["abc"])
        assert False, "Expected ValueError for wrong embedding dimension"
    except ValueError as exc:
        assert str(exc) == "Expected 384 dimensions, got 10"
