import re

import lancedb
from lancedb.pydantic import LanceModel, Vector

from src.core.config import settings
from src.core.interfaces import VectorStoreBase

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
        uri: str = settings.lancedb_uri,
        table_name: str = settings.lancedb_table,
    ):
        self.db = lancedb.connect(uri)
        self.table_name = table_name
        self.table = self._get_or_create_table()

    def _get_or_create_table(self):
        try:
            return self.db.open_table(self.table_name)
        except Exception:
            return self.db.create_table(self.table_name, schema=DocumentChunk)

    def upsert(self, chunks: list[dict]) -> bool:
        if not chunks:
            return False

        self.table.add(chunks)
        return True

    def search(
        self,
        query_vector: list[float],
        query_text: str,
        group_id: str | None = None,
        limit: int = 5,
    ) -> list[dict]:
        query = self.table.search(query_vector)

        if group_id:
            if not GROUP_ID_REGEX.match(group_id):
                raise ValueError(
                    f"Invalid group_id: {group_id!r}. "
                    "Must contain only letters, digits, underscores, dots, and hyphens."
                )
            query = query.where(f"group_id = '{group_id}'")

        return query.limit(limit).to_list()
