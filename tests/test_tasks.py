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

    monkeypatch.setattr(tasks, "get_document_parser", lambda: FakeParser())
    monkeypatch.setattr(tasks, "EmbeddingClient", lambda url: FakeEmbedder())
    monkeypatch.setattr(tasks, "LanceDBStore", FakeStore)
    tasks._embedder = None

    result = tasks.process_document_task.run(b"%PDF", "doc.pdf", "group-a")

    assert result["filename"] == "doc.pdf"
    assert result["group_id"] == "group-a"
    assert result["chunks_indexed"] == 2
    assert result["chunks_skipped"] == 0
    assert isinstance(result["file_id"], str)
    assert len(stores[0].records) == 2
    assert stores[0].records[0]["group_id"] == "group-a"
    assert stores[0].records[0]["file_id"] == result["file_id"]
    assert stores[0].records[0]["chunk_index"] == 0
    assert stores[0].records[0]["text_quality"] == "ok"
    assert stores[0].records[0]["vector"] == [5.0] * 384


def test_warm_document_parser_only_runs_once(monkeypatch):
    calls = []

    class FakeParser:
        def extract_text(self, file_bytes, filename):
            calls.append((file_bytes, filename))
            return [{"text": "warm", "metadata": {"filename": filename}}]

    monkeypatch.setattr(tasks, "settings", type("S", (), {"docling_warmup_enabled": True})())
    monkeypatch.setattr(tasks, "get_document_parser", lambda: FakeParser())
    tasks._parser_warmed = False

    assert tasks.warm_document_parser() is True
    assert tasks.warm_document_parser() is False
    assert calls == [(tasks.WARMUP_PDF_BYTES, "warmup.pdf")]


def test_warm_document_parser_respects_disabled_setting(monkeypatch):
    monkeypatch.setattr(tasks, "settings", type("S", (), {"docling_warmup_enabled": False})())
    tasks._parser_warmed = False

    assert tasks.warm_document_parser() is False
