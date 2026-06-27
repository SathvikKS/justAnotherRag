from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    lancedb_uri: str = "./lancedb_data"
    lancedb_table: str = "document_chunks"
    embedding_model: str = "BAAI/bge-small-en-v1.5"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")


settings = Settings()
