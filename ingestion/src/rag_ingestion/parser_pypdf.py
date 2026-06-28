from io import BytesIO

from langchain_text_splitters import RecursiveCharacterTextSplitter
from pypdf import PdfReader

from rag_core.interfaces import DocumentParserBase

MOJIBAKE_CHARS = set("ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖ×ØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõö÷øùúûüýþÿ")


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


class PyPDFParser(DocumentParserBase):
    def __init__(self):
        self.last_skipped = 0
        self.splitter = RecursiveCharacterTextSplitter(
            chunk_size=512,
            chunk_overlap=50,
        )

    def extract_text(self, file_bytes: bytes, filename: str) -> list[dict]:
        reader = PdfReader(BytesIO(file_bytes))
        pages = []
        self.last_skipped = 0

        for page_index, page in enumerate(reader.pages):
            page_text = page.extract_text() or ""
            if page_text.strip():
                pages.append((page_index + 1, page_text))

        chunks = []
        for page_number, page_text in pages:
            for chunk in self.splitter.split_text(page_text):
                cleaned = chunk.strip()
                quality = text_quality(cleaned)
                if cleaned and quality == "ok":
                    chunks.append({
                        "text": cleaned,
                        "metadata": {
                            "filename": filename,
                            "page": page_number,
                            "text_quality": quality,
                        },
                    })
                elif cleaned:
                    self.last_skipped += 1

        if not chunks:
            raise ValueError("No extractable text found")

        return chunks
