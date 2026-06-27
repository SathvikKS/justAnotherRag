from io import BytesIO

from langchain_text_splitters import RecursiveCharacterTextSplitter
from pypdf import PdfReader

from rag_core.interfaces import DocumentParserBase


class PyPDFParser(DocumentParserBase):
    def __init__(self):
        self.splitter = RecursiveCharacterTextSplitter(
            chunk_size=512,
            chunk_overlap=50,
        )

    def extract_text(self, file_bytes: bytes, filename: str) -> list[dict]:
        reader = PdfReader(BytesIO(file_bytes))
        pages = []

        for page_index, page in enumerate(reader.pages):
            page_text = page.extract_text() or ""
            if page_text.strip():
                pages.append((page_index + 1, page_text))

        chunks = []
        for page_number, page_text in pages:
            for chunk in self.splitter.split_text(page_text):
                cleaned = chunk.strip()
                if cleaned:
                    chunks.append({
                        "text": cleaned,
                        "metadata": {
                            "filename": filename,
                            "page": page_number,
                        },
                    })

        if not chunks:
            raise ValueError("No extractable text found")

        return chunks
