import importlib

import pytest

from rag_core.config import Settings, get_settings


@pytest.fixture
def isolated_aws_environment(monkeypatch):
    for name in (
        "AWS_ACCESS_KEY_ID",
        "AWS_SECRET_ACCESS_KEY",
        "AWS_SESSION_TOKEN",
        "AWS_REGION",
        "AWS_ENDPOINT_URL",
    ):
        monkeypatch.delenv(name, raising=False)


@pytest.mark.parametrize(
    "endpoint",
    ["http://minio:9000", "HtTp://minio:9000"],
)
def test_lancedb_storage_options_allow_http_for_http_s3_endpoint(
    isolated_aws_environment, endpoint
):
    settings = Settings(
        lancedb_uri="s3://bucket",
        aws_endpoint_url=endpoint,
    )

    assert settings.lancedb_storage_options == {
        "aws_endpoint": endpoint,
        "allow_http": "true",
    }


@pytest.mark.parametrize("endpoint", ["https://minio:9000", None])
def test_lancedb_storage_options_do_not_allow_http_for_https_or_missing_endpoint(
    isolated_aws_environment, endpoint
):
    settings = Settings(
        lancedb_uri="s3://bucket",
        aws_endpoint_url=endpoint,
    )

    options = settings.lancedb_storage_options

    expected = None if endpoint is None else {"aws_endpoint": endpoint}
    assert options == expected


def test_lancedb_storage_options_preserve_aws_credentials_and_region(
    isolated_aws_environment,
):
    settings = Settings(
        lancedb_uri="s3://bucket",
        aws_endpoint_url="http://minio:9000",
        aws_access_key_id="access-key",
        aws_secret_access_key="secret-key",
        aws_session_token="session-token",
        aws_region="test-region",
    )

    assert settings.lancedb_storage_options == {
        "aws_access_key_id": "access-key",
        "aws_secret_access_key": "secret-key",
        "aws_session_token": "session-token",
        "aws_region": "test-region",
        "aws_endpoint": "http://minio:9000",
        "allow_http": "true",
    }


def test_lancedb_storage_options_do_not_allow_http_for_filesystem_uri(
    isolated_aws_environment,
):
    settings = Settings(
        lancedb_uri="./lancedb_data",
        aws_endpoint_url="http://minio:9000",
    )

    assert settings.lancedb_storage_options == {"aws_endpoint": "http://minio:9000"}


def test_api_dependencies_load_service_env(monkeypatch):
    monkeypatch.setenv("LANCEDB_URI", "../lancedb_data")
    get_settings.cache_clear()

    import rag_api.dependencies as dependencies

    importlib.reload(dependencies)
    get_settings.cache_clear()
    settings = get_settings()

    assert settings.lancedb_uri == "../lancedb_data"


def test_ingestion_tasks_load_service_env(monkeypatch):
    monkeypatch.setenv("LANCEDB_URI", "../lancedb_data")
    get_settings.cache_clear()

    import rag_ingestion.tasks as tasks

    importlib.reload(tasks)
    get_settings.cache_clear()
    settings = get_settings()

    assert settings.lancedb_uri == "../lancedb_data"
