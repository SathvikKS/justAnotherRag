import importlib

from rag_core.config import get_settings


def test_api_dependencies_load_service_env(monkeypatch):
    monkeypatch.delenv("LANCEDB_URI", raising=False)
    get_settings.cache_clear()

    import rag_api.dependencies as dependencies

    importlib.reload(dependencies)
    get_settings.cache_clear()
    settings = get_settings()

    assert settings.lancedb_uri == "../lancedb_data"


def test_ingestion_tasks_load_service_env(monkeypatch):
    monkeypatch.delenv("LANCEDB_URI", raising=False)
    get_settings.cache_clear()

    import rag_ingestion.tasks as tasks

    importlib.reload(tasks)
    get_settings.cache_clear()
    settings = get_settings()

    assert settings.lancedb_uri == "../lancedb_data"
