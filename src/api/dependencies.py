from functools import lru_cache

from src.core.interfaces import (
    DocumentParserBase,
    EmbeddingEngineBase,
    VectorStoreBase,
)
from src.services.embedder_sentence import SentenceTransformerEngine
from src.services.parser_pypdf import PyPDFParser
from src.services.store_lancedb import LanceDBStore


@lru_cache(maxsize=1)
def get_document_parser() -> DocumentParserBase:
    return PyPDFParser()


@lru_cache(maxsize=1)
def get_embedding_engine() -> EmbeddingEngineBase:
    return SentenceTransformerEngine()


@lru_cache(maxsize=1)
def get_vector_store() -> VectorStoreBase:
    return LanceDBStore()
