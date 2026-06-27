from rag_ingestion import tasks


def test_process_document_task_runs_pipeline(monkeypatch):
    stores = []

    class FakeParser:
        def extract_text(self, file_bytes, filename):
            assert file_bytes == b"%PDF"
            assert filename == "doc.pdf"
            return [
                {"text": "first", "metadata": {"filename": "doc.pdf", "page": 1}},
                {"text": "second", "metadata": {"filename": "doc.pdf", "page": 2}},
            ]

    class FakeEmbedder:
        def embed_texts(self, texts):
            return [[float(len(text))] * 384 for text in texts]

    class FakeStore:
        def __init__(self):
            self.records = []
            stores.append(self)

        def upsert(self, records):
            self.records = records
            return True

    monkeypatch.setattr(tasks, "PyPDFParser", FakeParser)
    monkeypatch.setattr(tasks, "EmbeddingClient", lambda url: FakeEmbedder())
    monkeypatch.setattr(tasks, "LanceDBStore", FakeStore)

    result = tasks.process_document_task.run(b"%PDF", "doc.pdf", "group-a")

    assert result == {
        "filename": "doc.pdf",
        "group_id": "group-a",
        "chunks_indexed": 2,
    }
    assert len(stores[0].records) == 2
    assert stores[0].records[0]["group_id"] == "group-a"
    assert stores[0].records[0]["vector"] == [5.0] * 384
