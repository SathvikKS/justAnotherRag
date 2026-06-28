import re
from collections import defaultdict
from datetime import UTC, datetime, timedelta

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
    file_id: str | None = None
    created_at: str | None = None
    chunk_index: int | None = None
    text_quality: str | None = None


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
        self.db = lancedb.connect(
            uri,
            storage_options=storage_options,
            read_consistency_interval=timedelta(seconds=0),
        )
        self.table_name = table_name
        self.table = self._get_or_create_table()
        self._ensure_metadata_columns()
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

    def _ensure_metadata_columns(self) -> None:
        names = set(self.table.schema.names)
        missing = {
            "file_id": "CAST(NULL AS utf8)",
            "created_at": "CAST(NULL AS utf8)",
            "chunk_index": "CAST(NULL AS int64)",
            "text_quality": "CAST(NULL AS utf8)",
        }
        columns = [
            {"name": name, "value_sql": value_sql}
            for name, value_sql in missing.items()
            if name not in names
        ]
        if columns:
            self.table.add_columns(columns)

    def _validate_group_id(self, group_id: str) -> None:
        if not GROUP_ID_REGEX.match(group_id):
            raise ValueError(
                f"Invalid group_id: {group_id!r}. "
                "Must contain only letters, digits, underscores, dots, and hyphens."
            )

    def _quote(self, value: str) -> str:
        return value.replace("'", "''")

    def _rows(self, where: str | None = None) -> list[dict]:
        query = self.table.search().limit(1_000_000)
        if where:
            query = query.where(where)
        return query.to_list()

    def _score(self, item: dict) -> float | None:
        for key in ("_relevance_score", "_score", "_distance"):
            value = item.get(key)
            if value is not None:
                return float(value)
        return None

    def upsert(self, chunks: list[dict]) -> bool:
        if not chunks:
            return False

        now = datetime.now(UTC).isoformat()
        for index, chunk in enumerate(chunks):
            chunk.setdefault("created_at", now)
            chunk.setdefault("chunk_index", index)
            chunk.setdefault("text_quality", "ok")

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
            self.table.search(query_type="hybrid").vector(query_vector).text(query_text)
        )

        if group_id:
            self._validate_group_id(group_id)
            query = query.where(f"group_id = '{self._quote(group_id)}'", prefilter=True)

        results = query.limit(limit).to_list()
        for item in results:
            item["score"] = self._score(item)
        return results

    def list_groups(self) -> list[dict]:
        groups: dict[str, dict] = {}
        for row in self._rows():
            group_id = row.get("group_id")
            if not group_id:
                continue
            group = groups.setdefault(
                group_id,
                {
                    "group_id": group_id,
                    "chunks": 0,
                    "files": set(),
                    "created_at": row.get("created_at"),
                },
            )
            group["chunks"] += 1
            group["files"].add(
                row.get("file_id") or f"legacy:{row.get('filename', '')}"
            )
            created_at = row.get("created_at")
            if created_at and (
                not group["created_at"] or created_at < group["created_at"]
            ):
                group["created_at"] = created_at

        return [
            {
                "group_id": group["group_id"],
                "chunks": group["chunks"],
                "files": len(group["files"]),
                "created_at": group["created_at"],
            }
            for group in sorted(groups.values(), key=lambda item: item["group_id"])
        ]

    def get_group(self, group_id: str) -> dict | None:
        self._validate_group_id(group_id)
        for group in self.list_groups():
            if group["group_id"] == group_id:
                return group
        return None

    def list_files(self, group_id: str) -> list[dict]:
        self._validate_group_id(group_id)
        rows = self._rows(f"group_id = '{self._quote(group_id)}'")
        files: dict[str, dict] = {}
        pages_by_file: dict[str, set[int]] = defaultdict(set)
        for row in rows:
            filename = row.get("filename") or "unknown"
            file_id = row.get("file_id") or f"legacy:{filename}"
            item = files.setdefault(
                file_id,
                {
                    "file_id": file_id,
                    "filename": filename,
                    "group_id": group_id,
                    "chunks": 0,
                    "pages": [],
                    "created_at": row.get("created_at"),
                    "legacy": row.get("file_id") is None,
                },
            )
            item["chunks"] += 1
            page = row.get("page")
            if page is not None:
                pages_by_file[file_id].add(int(page))
            created_at = row.get("created_at")
            if created_at and (
                not item["created_at"] or created_at < item["created_at"]
            ):
                item["created_at"] = created_at

        for file_id, item in files.items():
            item["pages"] = sorted(pages_by_file[file_id])

        return sorted(
            files.values(), key=lambda item: (item["filename"], item["file_id"])
        )

    def delete_group(self, group_id: str) -> int:
        self._validate_group_id(group_id)
        where = f"group_id = '{self._quote(group_id)}'"
        deleted = len(self._rows(where))
        if deleted:
            self.table.delete(where)
            self._ensure_fts_index()
        return deleted

    def delete_file(self, group_id: str, file_id: str) -> int:
        self._validate_group_id(group_id)
        if file_id.startswith("legacy:"):
            filename = file_id.removeprefix("legacy:")
            where = (
                f"group_id = '{self._quote(group_id)}' "
                f"AND filename = '{self._quote(filename)}' "
                "AND file_id IS NULL"
            )
        else:
            where = (
                f"group_id = '{self._quote(group_id)}' "
                f"AND file_id = '{self._quote(file_id)}'"
            )
        deleted = len(self._rows(where))
        if deleted:
            self.table.delete(where)
            self._ensure_fts_index()
        return deleted
