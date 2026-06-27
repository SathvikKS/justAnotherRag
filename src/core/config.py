from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    lancedb_uri: str = "./lancedb_data"
    lancedb_table: str = "document_chunks"
    embedding_model: str = "BAAI/bge-small-en-v1.5"
    celery_broker_url: str = "redis://localhost:6379/0"
    celery_result_backend: str = "redis://localhost:6379/0"
    llama_model_path: str = "model.gguf"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")


settings = Settings()
