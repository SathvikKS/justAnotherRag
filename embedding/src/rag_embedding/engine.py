from rag_core.config import get_settings
from rag_core.interfaces import EmbeddingEngineBase


def _load_embedding_cls():
    from langchain_huggingface import HuggingFaceEmbeddings

    return HuggingFaceEmbeddings


class LangChainEmbeddingEngine(EmbeddingEngineBase):
    def __init__(self, model_name: str | None = None):
        embedding_model = model_name or get_settings().embedding_model
        HuggingFaceEmbeddings = _load_embedding_cls()
        self.model = HuggingFaceEmbeddings(
            model_name=embedding_model,
            encode_kwargs={"normalize_embeddings": True},
        )

    def _coerce_vectors(self, values: list[list[float]]) -> list[list[float]]:
        coerced = [[float(x) for x in vector] for vector in values]
        for vector in coerced:
            if len(vector) != 384:
                raise ValueError(f"Expected 384 dimensions, got {len(vector)}")
        return coerced

    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        return self._coerce_vectors(self.model.embed_documents(texts))

    def embed_text(self, text: str) -> list[float]:
        return self.embed_texts([text])[0]


class SentenceTransformerEngine(LangChainEmbeddingEngine):
    pass


def get_embedding_engine() -> EmbeddingEngineBase:
    return LangChainEmbeddingEngine()
