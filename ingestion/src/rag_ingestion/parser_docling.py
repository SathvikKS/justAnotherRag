import os
from pathlib import Path
from tempfile import NamedTemporaryFile

from rag_core.config import get_settings
from rag_core.interfaces import DocumentParserBase

MOJIBAKE_CHARS = set("ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖ×ØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõö÷øùúûüýþÿ")


def _load_docling_components():
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import (
        OcrAutoOptions,
        PdfPipelineOptions,
        RapidOcrOptions,
        TesseractCliOcrOptions,
        TesseractOcrOptions,
    )
    from docling.chunking import HybridChunker
    from docling.document_converter import DocumentConverter, PdfFormatOption
    from docling_core.transforms.chunker.tokenizer.huggingface import HuggingFaceTokenizer
    from langchain_docling.loader import DoclingLoader, ExportType
    from transformers import AutoTokenizer

    return (
        InputFormat,
        OcrAutoOptions,
        PdfPipelineOptions,
        RapidOcrOptions,
        TesseractCliOcrOptions,
        TesseractOcrOptions,
        HybridChunker,
        DocumentConverter,
        PdfFormatOption,
        HuggingFaceTokenizer,
        DoclingLoader,
        ExportType,
        AutoTokenizer,
    )


def _build_ocr_options(settings):
    langs = settings.docling_ocr_lang_list
    engine = settings.docling_ocr_engine.strip().lower()

    components = _load_docling_components()
    OcrAutoOptions = components[1]
    RapidOcrOptions = components[3]
    TesseractCliOcrOptions = components[4]
    TesseractOcrOptions = components[5]

    if engine == "auto":
        return OcrAutoOptions(lang=langs)
    if engine == "rapidocr":
        return RapidOcrOptions(
            lang=langs or ["english"],
            backend=settings.docling_rapidocr_backend,
        )
    if engine == "tesseract_cli":
        return TesseractCliOcrOptions(lang=langs or ["eng"])
    if engine == "tesseract":
        return TesseractOcrOptions(lang=langs or ["eng"])

    raise ValueError(
        f"Unsupported DOCLING_OCR_ENGINE: {settings.docling_ocr_engine!r}. "
        "Expected one of: auto, rapidocr, tesseract_cli, tesseract."
    )


def text_quality(text: str) -> str:
    stripped = text.strip()
    if not stripped:
        return "empty"

    printable = [char for char in stripped if not char.isspace()]
    if not printable:
        return "empty"

    mojibake_ratio = sum(char in MOJIBAKE_CHARS for char in printable) / len(printable)
    letters = [char for char in printable if char.isalpha()]
    ascii_word_chars = sum(char.isascii() and char.isalpha() for char in letters)
    ascii_letter_ratio = ascii_word_chars / len(letters) if letters else 0

    if mojibake_ratio > 0.2 and ascii_letter_ratio < 0.5:
        return "mojibake"
    if len(stripped) < 20 and ascii_letter_ratio < 0.4:
        return "low_signal"
    return "ok"


def _page_from_metadata(metadata: dict) -> int | None:
    dl_meta = metadata.get("dl_meta")
    if isinstance(dl_meta, dict):
        pages: set[int] = set()
        for item in dl_meta.get("doc_items", []):
            if not isinstance(item, dict):
                continue
            for prov in item.get("prov", []):
                if not isinstance(prov, dict):
                    continue
                page_no = prov.get("page_no")
                if page_no is not None:
                    pages.add(int(page_no))
        if pages:
            return min(pages)

    page = metadata.get("page")
    if page is None:
        return None
    return int(page)


class DoclingParser(DocumentParserBase):
    def __init__(self):
        self.last_skipped = 0
        os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

        (
            InputFormat,
            _,
            PdfPipelineOptions,
            _,
            _,
            _,
            HybridChunker,
            DocumentConverter,
            PdfFormatOption,
            HuggingFaceTokenizer,
            DoclingLoader,
            ExportType,
            AutoTokenizer,
        ) = (
            _load_docling_components()
        )
        settings = get_settings()
        model_name = settings.embedding_model
        tokenizer = HuggingFaceTokenizer(
            tokenizer=AutoTokenizer.from_pretrained(model_name)
        )
        pipeline_options = PdfPipelineOptions()
        pipeline_options.do_ocr = settings.docling_ocr_enabled
        pipeline_options.force_backend_text = settings.docling_force_backend_text
        if settings.docling_ocr_enabled:
            pipeline_options.ocr_options = _build_ocr_options(settings)
        converter = DocumentConverter(
            format_options={
                InputFormat.PDF: PdfFormatOption(pipeline_options=pipeline_options)
            }
        )
        self.loader_cls = DoclingLoader
        self.export_type = ExportType.DOC_CHUNKS
        self.chunker = HybridChunker(tokenizer=tokenizer)
        self.converter = converter

    def extract_text(self, file_bytes: bytes, filename: str) -> list[dict]:
        suffix = Path(filename).suffix or ".pdf"
        with NamedTemporaryFile(suffix=suffix, delete=False) as temp_file:
            temp_file.write(file_bytes)
            temp_path = Path(temp_file.name)

        try:
            loader = self.loader_cls(
                file_path=str(temp_path),
                converter=self.converter,
                export_type=self.export_type,
                chunker=self.chunker,
            )
            docs = loader.load()
        finally:
            temp_path.unlink(missing_ok=True)

        self.last_skipped = 0
        chunks = []
        for doc in docs:
            cleaned = (getattr(doc, "page_content", "") or "").strip()
            quality = text_quality(cleaned)
            if cleaned and quality == "ok":
                metadata = getattr(doc, "metadata", {}) or {}
                chunks.append(
                    {
                        "text": cleaned,
                        "metadata": {
                            "filename": filename,
                            "page": _page_from_metadata(metadata),
                            "text_quality": quality,
                        },
                    }
                )
            elif cleaned:
                self.last_skipped += 1

        if not chunks:
            raise ValueError("No extractable text found")

        return chunks
