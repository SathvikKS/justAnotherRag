from functools import lru_cache

from rag_core.config import settings
from rag_core.interfaces import EmbeddingEngineBase, LLMClientBase, VectorStoreBase
from rag_grpc import EmbeddingClient, MockLlmGrpcClient, VllmGrpcClient
from rag_storage import LanceDBStore


@lru_cache(maxsize=1)
def get_embedding_engine() -> EmbeddingEngineBase:
    return EmbeddingClient(settings.embedding_grpc_url)


@lru_cache(maxsize=1)
def get_vector_store() -> VectorStoreBase:
    return LanceDBStore()


@lru_cache(maxsize=1)
def get_llm_client() -> LLMClientBase:
    if settings.llm_provider == "mock":
        return MockLlmGrpcClient(settings.llm_grpc_url)
    return VllmGrpcClient()
