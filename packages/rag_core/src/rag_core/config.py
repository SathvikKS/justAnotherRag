from functools import lru_cache
from urllib.parse import urlsplit

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    lancedb_uri: str = "s3://app-vector-bucket"
    lancedb_table: str = "document_chunks"
    embedding_model: str = "BAAI/bge-small-en-v1.5"
    embedding_grpc_url: str = "localhost:50051"
    docling_ocr_enabled: bool = True
    docling_ocr_engine: str = "auto"
    docling_ocr_langs: str = ""
    docling_rapidocr_backend: str = "onnxruntime"
    docling_force_backend_text: bool = True
    docling_warmup_enabled: bool = True
    llm_provider: str = "vllm"
    llm_grpc_url: str = "localhost:50052"
    llm_model: str = "Qwen/Qwen2.5-3B-Instruct"
    llm_max_tokens: int = 512
    celery_broker_url: str = "redis://localhost:6379/0"
    celery_result_backend: str = "redis://localhost:6379/0"
    api_key: str | None = None
    cors_origins: str = "http://localhost:3000,http://localhost:5173"
    aws_access_key_id: str | None = None
    aws_secret_access_key: str | None = None
    aws_session_token: str | None = None
    aws_region: str | None = None
    aws_endpoint_url: str | None = None
    database_url: str = "postgresql+psycopg://postgres:postgres@localhost:5432/postgres"
    secret_key: str = "your-super-secret-key-change-this-in-prod"

    model_config = SettingsConfigDict(extra="ignore")

    @property
    def cors_origin_list(self) -> list[str]:
        return [
            origin.strip()
            for origin in self.cors_origins.split(",")
            if origin.strip()
        ]

    @property
    def docling_ocr_lang_list(self) -> list[str]:
        return [
            lang.strip()
            for lang in self.docling_ocr_langs.split(",")
            if lang.strip()
        ]

    @property
    def lancedb_storage_options(self) -> dict[str, str] | None:
        options = {
            key: value
            for key, value in {
                "aws_access_key_id": self.aws_access_key_id,
                "aws_secret_access_key": self.aws_secret_access_key,
                "aws_session_token": self.aws_session_token,
                "aws_region": self.aws_region,
                "aws_endpoint": self.aws_endpoint_url,
            }.items()
            if value
        }
        if (
            self.lancedb_uri.lower().startswith("s3://")
            and self.aws_endpoint_url
            and urlsplit(self.aws_endpoint_url).scheme.lower() == "http"
        ):
            options["allow_http"] = "true"
        return options or None

@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
