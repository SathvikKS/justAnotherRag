from sentence_transformers import SentenceTransformer

from rag_core.config import settings


class SentenceTransformerEngine:
    def __init__(self, model_name: str = settings.embedding_model):
        self.model = SentenceTransformer(model_name)

    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        vectors = self.model.encode(texts, normalize_embeddings=True)
        values = vectors.tolist()

        for vector in values:
            if len(vector) != 384:
                raise ValueError(f"Expected 384 dimensions, got {len(vector)}")

        return [[float(x) for x in vector] for vector in values]

    def embed_text(self, text: str) -> list[float]:
        return self.embed_texts([text])[0]
