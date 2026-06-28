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
    def generate_response(
        self,
        prompt: str,
        context: list[str],
        require_citations: bool = False,
    ) -> dict:
        ...
