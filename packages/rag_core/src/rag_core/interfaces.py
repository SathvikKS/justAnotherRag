from abc import ABC, abstractmethod
from typing import TypedDict


class ChatMetrics(TypedDict):
    session_tps: float
    prompt_tokens: int
    completion_tokens: int
    total_context_used: int


class LLMResponse(TypedDict):
    answer: str
    citations: list[int]
    insufficient: bool
    metrics: ChatMetrics | None


class DocumentParserBase(ABC):
    @abstractmethod
    def extract_text(self, file_bytes: bytes, filename: str) -> list[dict]:
        ...


class EmbeddingEngineBase(ABC):
    @abstractmethod
    def embed_text(self, text: str) -> list[float]:
        ...

    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        """Embed multiple texts, with a compatibility-preserving scalar fallback."""
        return [self.embed_text(text) for text in texts]


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

    @abstractmethod
    def get_chunk(self, chunk_id: str) -> dict | None:
        ...

    @abstractmethod
    def list_groups(self) -> list[dict]:
        ...

    @abstractmethod
    def get_group(self, group_id: str) -> dict | None:
        ...

    @abstractmethod
    def list_files(self, group_id: str) -> list[dict]:
        ...

    @abstractmethod
    def delete_group(self, group_id: str) -> int:
        ...

    @abstractmethod
    def delete_file(self, group_id: str, file_id: str) -> int:
        ...


class LLMClientBase(ABC):
    @abstractmethod
    def generate_search_questions(self, query: str) -> list[str]:
        """Generate document-retrieval questions derived from a user query."""
        ...

    @abstractmethod
    def generate_response(
        self,
        prompt: str,
        context: list[str],
        require_citations: bool = False,
        history: str = "",
    ) -> LLMResponse:
        ...
