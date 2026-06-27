from sentence_transformers import SentenceTransformer

from src.core.config import settings
from src.core.interfaces import EmbeddingEngineBase


class SentenceTransformerEngine(EmbeddingEngineBase):
    def __init__(self, model_name: str = settings.embedding_model):
        self.model = SentenceTransformer(model_name)

    def embed_text(self, text: str) -> list[float]:
        vector = self.model.encode(text, normalize_embeddings=True)
        values = vector.tolist()

        if len(values) != 384:
            raise ValueError(f"Expected 384 dimensions, got {len(values)}")

        return [float(x) for x in values]
