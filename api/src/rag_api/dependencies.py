from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv

from rag_core.config import get_settings
from rag_core.interfaces import EmbeddingEngineBase, LLMClientBase, VectorStoreBase
from rag_grpc import EmbeddingClient, MockLlmGrpcClient, VllmGrpcClient
from rag_storage import LanceDBStore

load_dotenv(Path(__file__).resolve().parents[2] / ".env", encoding="utf-8-sig")


@lru_cache(maxsize=1)
def get_embedding_engine() -> EmbeddingEngineBase:
    settings = get_settings()
    return EmbeddingClient(settings.embedding_grpc_url)


@lru_cache(maxsize=1)
def get_vector_store() -> VectorStoreBase:
    return LanceDBStore()


@lru_cache(maxsize=1)
def get_llm_client() -> LLMClientBase:
    settings = get_settings()
    if settings.llm_provider == "mock":
        return MockLlmGrpcClient(settings.llm_grpc_url)
    return VllmGrpcClient()
