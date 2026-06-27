import shutil
from pathlib import Path

import pytest


@pytest.fixture
def temp_db(request):
    root = Path(".test_lancedb") / request.node.name
    shutil.rmtree(root, ignore_errors=True)
    root.mkdir(parents=True, exist_ok=True)
    yield str(root / "test_lancedb")
    shutil.rmtree(root, ignore_errors=True)


class TestLanceDBStore:
    def test_upsert_and_search(self, temp_db):
        from src.services.store_lancedb import LanceDBStore

        store = LanceDBStore(uri=temp_db, table_name="test_chunks")

        store.upsert(
            [
                {
                    "chunk_id": "c1",
                    "vector": [0.01] * 384,
                    "text": "Hello world",
                    "group_id": "group-a",
                    "filename": "doc1.pdf",
                    "page": 1,
                },
                {
                    "chunk_id": "c2",
                    "vector": [0.02] * 384,
                    "text": "Foo bar baz",
                    "group_id": "group-a",
                    "filename": "doc1.pdf",
                    "page": 2,
                },
                {
                    "chunk_id": "c3",
                    "vector": [0.99] * 384,
                    "text": "Other group content",
                    "group_id": "group-b",
                    "filename": "doc2.pdf",
                    "page": 1,
                },
            ]
        )

        results_all = store.search(
            query_vector=[0.01] * 384,
            query_text="hello",
            group_id=None,
            limit=5,
        )
        assert len(results_all) == 3

        results_filtered = store.search(
            query_vector=[0.01] * 384,
            query_text="hello",
            group_id="group-a",
            limit=5,
        )
        assert len(results_filtered) == 2
        assert all(r["group_id"] == "group-a" for r in results_filtered)

        results_single = store.search(
            query_vector=[0.01] * 384,
            query_text="hello",
            group_id="group-a",
            limit=1,
        )
        assert len(results_single) == 1

    def test_search_with_bad_group_id_rejected(self, temp_db):
        from src.services.store_lancedb import LanceDBStore

        store = LanceDBStore(uri=temp_db, table_name="test_chunks")

        with pytest.raises(ValueError, match="Invalid group_id"):
            store.search(
                query_vector=[0.01] * 384,
                query_text="hello",
                group_id="bad'id",
                limit=5,
            )
