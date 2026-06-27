from abc import ABC, abstractmethod


class DocumentParserBase(ABC):
    @abstractmethod
    def extract_text(self, file_bytes: bytes, filename: str) -> list[dict]:
        ...


class EmbeddingEngineBase(ABC):
    @abstractmethod
    def embed_text(self, text: str) -> list[float]:
        ...


class VectorStoreBase(ABC):
    @abstractmethod
    def upsert(self, chunks: list[dict]) -> bool:
        ...

    @abstractmethod
    def search(
        self,
        query_vector: list[float],
        query_text: str,
        group_id: str | None = None,
        limit: int = 5,
    ) -> list[dict]:
        ...


class LLMClientBase(ABC):
    @abstractmethod
    def generate_response(self, prompt: str, context: list[str]) -> str:
        ...
