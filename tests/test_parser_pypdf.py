from types import SimpleNamespace

from rag_ingestion.parser_docling import DoclingParser, _build_ocr_options, text_quality


def test_text_quality_accepts_normal_english():
    assert text_quality("This is a normal English syllabus paragraph.") == "ok"


def test_text_quality_rejects_obvious_mojibake():
    assert text_quality("¸ÀÀA¥ÁzÀPÀgÀÄ ¥ÉÆæ. «. PÉÃ±ÀªÀªÀÄÆwð") == "mojibake"


def test_docling_parser_extracts_chunk_metadata(monkeypatch):
    fake_docs = [
        SimpleNamespace(
            page_content="Useful document text that is definitely long enough.",
            metadata={
                "dl_meta": {
                    "doc_items": [
                        {
                            "prov": [
                                {"page_no": 3},
                            ]
                        }
                    ]
                }
            },
        ),
        SimpleNamespace(page_content="123", metadata={}),
    ]

    class FakeLoader:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

        def load(self):
            return fake_docs

    class FakeHybridChunker:
        def __init__(self, tokenizer):
            self.tokenizer = tokenizer

    class FakeTokenizer:
        def __init__(self, tokenizer):
            self.tokenizer = tokenizer

    class FakeAutoTokenizer:
        @staticmethod
        def from_pretrained(model_name):
            return model_name

    class FakePdfPipelineOptions:
        def __init__(self):
            self.do_ocr = True
            self.force_backend_text = False
            self.ocr_options = None

    class FakePdfFormatOption:
        def __init__(self, pipeline_options):
            self.pipeline_options = pipeline_options

    class FakeDocumentConverter:
        def __init__(self, format_options):
            self.format_options = format_options

    monkeypatch.setattr(
        "rag_ingestion.parser_docling._load_docling_components",
        lambda: (
            SimpleNamespace(PDF="pdf"),
            lambda lang: SimpleNamespace(lang=lang),
            FakePdfPipelineOptions,
            lambda lang, backend: SimpleNamespace(lang=lang, backend=backend),
            lambda lang: SimpleNamespace(lang=lang),
            lambda lang: SimpleNamespace(lang=lang),
            FakeHybridChunker,
            FakeDocumentConverter,
            FakePdfFormatOption,
            FakeTokenizer,
            FakeLoader,
            SimpleNamespace(DOC_CHUNKS="doc_chunks"),
            FakeAutoTokenizer,
        ),
    )

    monkeypatch.setattr(
        "rag_ingestion.parser_docling.get_settings",
        lambda: SimpleNamespace(
            embedding_model="BAAI/bge-small-en-v1.5",
            docling_ocr_enabled=True,
            docling_ocr_engine="auto",
            docling_ocr_lang_list=["eng"],
            docling_rapidocr_backend="onnxruntime",
            docling_force_backend_text=True,
        ),
    )

    parser = DoclingParser()
    chunks = parser.extract_text(b"%PDF", "doc.pdf")

    pipeline_options = parser.converter.format_options["pdf"].pipeline_options
    assert pipeline_options.do_ocr is True
    assert pipeline_options.force_backend_text is True
    assert pipeline_options.ocr_options.lang == ["eng"]

    assert chunks == [
        {
            "text": "Useful document text that is definitely long enough.",
            "metadata": {
                "filename": "doc.pdf",
                "page": 3,
                "text_quality": "ok",
            },
        }
    ]
    assert parser.last_skipped == 1


def test_build_ocr_options_supports_rapidocr_backend(monkeypatch):
    class FakeAutoOptions:
        def __init__(self, lang):
            self.lang = lang

    class FakeRapidOptions:
        def __init__(self, lang, backend):
            self.lang = lang
            self.backend = backend

    class FakeTesseractCliOptions:
        def __init__(self, lang):
            self.lang = lang

    class FakeTesseractOptions:
        def __init__(self, lang):
            self.lang = lang

    monkeypatch.setattr(
        "rag_ingestion.parser_docling._load_docling_components",
        lambda: (
            None,
            FakeAutoOptions,
            None,
            FakeRapidOptions,
            FakeTesseractCliOptions,
            FakeTesseractOptions,
            None,
            None,
            None,
            None,
            None,
        ),
    )

    settings = SimpleNamespace(
        docling_ocr_engine="rapidocr",
        docling_ocr_lang_list=["english"],
        docling_rapidocr_backend="onnxruntime",
    )
    options = _build_ocr_options(settings)

    assert options.lang == ["english"]
    assert options.backend == "onnxruntime"
