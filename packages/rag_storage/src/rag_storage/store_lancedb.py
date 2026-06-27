import re

import lancedb
from lancedb.pydantic import LanceModel, Vector

from rag_core.config import get_settings
from rag_core.interfaces import VectorStoreBase

GROUP_ID_REGEX = re.compile(r"^[A-Za-z0-9_.-]+$")


class DocumentChunk(LanceModel):
    chunk_id: str
    vector: Vector(384)
    text: str
    group_id: str
    filename: str
    page: int | None = None


class LanceDBStore(VectorStoreBase):
    def __init__(
        self,
        uri: str | None = None,
        table_name: str | None = None,
        storage_options: dict[str, str] | None = None,
    ):
        settings = get_settings()
        uri = uri or settings.lancedb_uri
        table_name = table_name or settings.lancedb_table
        if storage_options is None and str(uri).startswith("s3://"):
            storage_options = settings.lancedb_storage_options
        self.db = lancedb.connect(uri, storage_options=storage_options)
        self.table_name = table_name
        self.table = self._get_or_create_table()
        self._ensure_fts_index()

    def _get_or_create_table(self):
        try:
            return self.db.open_table(self.table_name)
        except Exception:
            return self.db.create_table(self.table_name, schema=DocumentChunk)

    def _has_text_fts_index(self) -> bool:
        return any(
            getattr(index, "index_type", None) == "FTS"
            and "text" in getattr(index, "columns", [])
            for index in self.table.list_indices()
        )

    def _ensure_fts_index(self) -> None:
        if not self._has_text_fts_index():
            self.table.create_fts_index("text")

    def upsert(self, chunks: list[dict]) -> bool:
        if not chunks:
            return False

        self.table.add(chunks)
        self._ensure_fts_index()
        return True

    def search(
        self,
        query_vector: list[float],
        query_text: str,
        group_id: str | None = None,
        limit: int = 5,
    ) -> list[dict]:
        self._ensure_fts_index()

        query = (
            self.table.search(query_type="hybrid")
            .vector(query_vector)
            .text(query_text)
        )

        if group_id:
            if not GROUP_ID_REGEX.match(group_id):
                raise ValueError(
                    f"Invalid group_id: {group_id!r}. "
                    "Must contain only letters, digits, underscores, dots, and hyphens."
                )
            query = query.where(f"group_id = '{group_id}'", prefilter=True)

        return query.limit(limit).to_list()
