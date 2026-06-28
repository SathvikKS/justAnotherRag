import re

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field, field_validator

from rag_api.dependencies import (
    get_embedding_engine,
    get_llm_client,
    get_vector_store,
)
from rag_api.ingestion import get_task_status, enqueue_upload, GROUP_ID_REGEX
from rag_core.interfaces import EmbeddingEngineBase, LLMClientBase, VectorStoreBase

router = APIRouter()


class ChatRequest(BaseModel):
    query: str = Field(..., min_length=1)
    group_id: str
    limit: int = Field(5, ge=1, le=20)
    require_citations: bool = False

    @field_validator("group_id")
    @classmethod
    def validate_group_id(cls, v: str) -> str:
        if not GROUP_ID_REGEX.match(v):
            raise ValueError(
                "group_id must contain only letters, digits, underscores, dots, and hyphens"
            )
        return v


class Snippet(BaseModel):
    text: str
    match_positions: list[list[int]] = []
    full_length: int


class Source(BaseModel):
    snippet: Snippet | None = None
    chunk_id: str | None = None
    file_id: str | None = None
    filename: str | None = None
    page: int | None = None
    group_id: str | None = None
    score: float | None = None


class ChunkDetail(BaseModel):
    chunk_id: str
    text: str
    filename: str | None = None
    page: int | None = None
    file_id: str | None = None
    group_id: str | None = None
    score: float | None = None
    text_quality: str | None = None
    match_positions: list[list[int]] | None = None


class ChatResponse(BaseModel):
    query: str
    group_id: str
    answer: str
    sources: list[Source]
    grounding: dict


class GroupSummary(BaseModel):
    group_id: str
    chunks: int
    files: int
    created_at: str | None = None


class FileSummary(BaseModel):
    file_id: str
    filename: str
    group_id: str
    chunks: int
    pages: list[int]
    created_at: str | None = None
    legacy: bool = False


class DeleteResponse(BaseModel):
    deleted_chunks: int


class DebugSearchRequest(ChatRequest):
    pass


class DebugSearchResponse(BaseModel):
    query: str
    group_id: str
    results: list[Source]


SMALL_TALK_RESPONSES = {
    "hi": "Hi! Ask me a question about your uploaded documents.",
    "hello": "Hello! Ask me a question about your uploaded documents.",
    "hey": "Hey! Ask me a question about your uploaded documents.",
    "thanks": "You're welcome. Ask me another document question when you're ready.",
    "thank you": "You're welcome. Ask me another document question when you're ready.",
    "where are you": "I'm running locally as your document assistant. Ask me a question about your uploaded documents when you're ready.",
    "where do you live": "I'm running locally as your document assistant. Ask me a question about your uploaded documents when you're ready.",
    "who are you": "I'm your local RAG assistant for answering questions about uploaded documents.",
    "what are you": "I'm your local RAG assistant for answering questions about uploaded documents.",
}


def small_talk_answer(query: str) -> str | None:
    normalized = re.sub(r"\s+", " ", query.strip().lower().rstrip(".!?"))
    if normalized in SMALL_TALK_RESPONSES:
        return SMALL_TALK_RESPONSES[normalized]
    if normalized.startswith(("where are you", "where do you live")):
        return SMALL_TALK_RESPONSES["where are you"]
    if normalized.startswith(("who are you", "what are you")):
        return SMALL_TALK_RESPONSES["who are you"]
    return None


SNIPPET_WINDOW = 300
STOP_WORDS: set[str] = {
    "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "from", "is", "are", "was", "were", "be", "been",
    "being", "have", "has", "had", "do", "does", "did", "will", "would",
    "could", "should", "may", "might", "can", "shall", "you", "your",
    "yours", "he", "she", "it", "they", "them", "their", "we", "us",
    "our", "me", "my", "mine", "i", "this", "that", "these", "those",
    "not", "no", "so", "very", "just", "how", "what", "which", "who",
    "whom", "when", "where", "why", "all", "each", "every", "both",
    "few", "more", "some", "any", "much", "many", "if", "then", "than",
    "too", "also", "as", "its", "into", "over", "about", "up", "out",
    "here", "there", "only", "other",
}


def _extract_terms(query: str) -> list[str]:
    tokens = re.findall(r"[a-zA-Z0-9]+", query.lower())
    return [t for t in tokens if t not in STOP_WORDS and len(t) >= 2]


def _find_all_positions(text: str, term: str) -> list[tuple[int, int]]:
    lower = text.lower()
    positions: list[tuple[int, int]] = []
    idx = 0
    while True:
        idx = lower.find(term, idx)
        if idx == -1:
            break
        positions.append((idx, idx + len(term)))
        idx += 1
    return positions


def _bigrams(terms: list[str]) -> list[str]:
    if len(terms) < 2:
        return []
    return [" ".join(terms[i:i + 2]) for i in range(len(terms) - 1)]


def _best_window(all_positions: list[tuple[int, int]], full_text: str, terms_count: int) -> int | None:
    clusters: list[list[tuple[int, int]]] = []
    sorted_pos = sorted(all_positions, key=lambda p: p[0])
    current: list[tuple[int, int]] = []
    for p in sorted_pos:
        if current and p[0] - current[-1][1] > 100:
            clusters.append(current)
            current = []
        current.append(p)
    if current:
        clusters.append(current)

    best_window: int | None = None
    best_score = 0.0
    text_len = len(full_text)

    for cluster in clusters:
        center = (cluster[0][0] + cluster[-1][1]) // 2
        window_start = max(0, center - SNIPPET_WINDOW // 2)
        window_end = min(text_len, window_start + SNIPPET_WINDOW)
        if window_end - window_start < SNIPPET_WINDOW:
            window_start = max(0, window_end - SNIPPET_WINDOW)

        unique_terms = len({p[0] for p in all_positions if window_start <= p[0] < window_end})
        window_len = window_end - window_start
        score = unique_terms / max(window_len, 1)
        if score > best_score:
            best_score = score
            best_window = window_start

    return best_window


def _build_match_positions(text_slice: str, query_terms: list[str]) -> list[list[int]]:
    positions: list[list[int]] = []
    lower = text_slice.lower()
    for term in query_terms:
        idx = 0
        while True:
            idx = lower.find(term, idx)
            if idx == -1:
                break
            positions.append([idx, idx + len(term)])
            idx += 1
    return sorted(positions, key=lambda p: p[0])


def _expand_to_word(text: str, start: int, end: int) -> tuple[int, int]:
    if start > 0 and text[start - 1] != " ":
        new_start = max(0, text.rfind(" ", 0, start))
        if new_start != -1:
            start = new_start + 1
    if end < len(text) and text[end] != " ":
        new_end = text.find(" ", end)
        if new_end != -1:
            end = new_end
    return start, end


def _fallback_snippet(text: str, query_terms: list[str]) -> Snippet | None:
    text_slice = text[:SNIPPET_WINDOW]
    match_positions = _build_match_positions(text_slice, query_terms)
    return Snippet(
        text=text_slice.strip(),
        match_positions=match_positions,
        full_length=len(text),
    )


def build_snippet(query: str, full_text: str) -> Snippet | None:
    if not query or not full_text:
        return None

    terms = _extract_terms(query)
    if not terms:
        return None

    all_positions: list[tuple[int, int]] = []
    for term in terms:
        all_positions.extend(_find_all_positions(full_text, term))

    if all_positions:
        window_start = _best_window(all_positions, full_text, len(terms))
        if window_start is not None:
            window_end = min(len(full_text), window_start + SNIPPET_WINDOW)
            window_start, window_end = _expand_to_word(full_text, window_start, window_end)
            text_slice = full_text[window_start:window_end].strip()
            match_positions = _build_match_positions(text_slice, terms)
            return Snippet(
                text=text_slice,
                match_positions=match_positions,
                full_length=len(full_text),
            )
        return _fallback_snippet(full_text, terms)

    bigram_terms = _bigrams(terms)
    if bigram_terms:
        for term in bigram_terms:
            positions = _find_all_positions(full_text, term)
            if positions:
                window_start = _best_window(positions, full_text, 1)
                if window_start is not None:
                    window_end = min(len(full_text), window_start + SNIPPET_WINDOW)
                    window_start, window_end = _expand_to_word(full_text, window_start, window_end)
                    text_slice = full_text[window_start:window_end].strip()
                    match_positions = _build_match_positions(text_slice, terms)
                    return Snippet(
                        text=text_slice,
                        match_positions=match_positions,
                        full_length=len(full_text),
                    )

    return _fallback_snippet(full_text, terms)


def score_from_result(item: dict) -> float | None:
    for key in ("score", "_relevance_score", "_score", "_distance"):
        value = item.get(key)
        if value is not None:
            return float(value)
    return None


def source_from_result(item: dict, query: str | None = None) -> Source:
    text = item.get("text", "")
    snippet = build_snippet(query, text) if query else None
    return Source(
        snippet=snippet,
        chunk_id=item.get("chunk_id"),
        file_id=item.get("file_id"),
        filename=item.get("filename"),
        page=item.get("page"),
        group_id=item.get("group_id"),
        score=score_from_result(item),
    )


def grounding_status(
    sources: list[Source],
    require_citations: bool,
    citations: list[int],
    insufficient: bool,
    raw_answer: str | None = None,
) -> dict:
    if not sources:
        return {
            "mode": "no_retrieval",
            "sources_supplied": 0,
            "citations_required": require_citations,
            "citations_found": [],
            "status": "no_retrieval",
        }

    valid_cites = sorted({
        int(c) for c in citations if 1 <= int(c) <= len(sources)
    })

    if insufficient:
        status = "insufficient"
    elif require_citations and not valid_cites:
        status = "rejected_uncited"
    elif valid_cites:
        status = "cited"
    else:
        status = "uncited"

    grounding = {
        "mode": "document",
        "sources_supplied": len(sources),
        "citations_required": require_citations,
        "citations_found": valid_cites,
        "status": status,
    }
    if raw_answer is not None:
        grounding["raw_answer"] = raw_answer
    return grounding


@router.post("/upload")
async def upload(
    file: UploadFile = File(...),
    group_id: str = Form(...),
):
    file_bytes = await file.read()

    try:
        task_id = enqueue_upload(file_bytes, file.filename, group_id)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except RuntimeError as e:
        raise HTTPException(500, str(e))

    return {"task_id": task_id}


@router.get("/status/{task_id}")
def status(task_id: str):
    return get_task_status(task_id)


@router.get("/groups", response_model=list[GroupSummary])
def list_groups(store: VectorStoreBase = Depends(get_vector_store)):
    return store.list_groups()


@router.get("/groups/{group_id}", response_model=GroupSummary)
def get_group(group_id: str, store: VectorStoreBase = Depends(get_vector_store)):
    try:
        group = store.get_group(group_id)
    except ValueError as e:
        raise HTTPException(422, str(e))
    if group is None:
        raise HTTPException(404, "Group not found")
    return group


@router.delete("/groups/{group_id}", response_model=DeleteResponse)
def delete_group(group_id: str, store: VectorStoreBase = Depends(get_vector_store)):
    try:
        deleted = store.delete_group(group_id)
    except ValueError as e:
        raise HTTPException(422, str(e))
    return DeleteResponse(deleted_chunks=deleted)


@router.get("/groups/{group_id}/files", response_model=list[FileSummary])
def list_files(group_id: str, store: VectorStoreBase = Depends(get_vector_store)):
    try:
        return store.list_files(group_id)
    except ValueError as e:
        raise HTTPException(422, str(e))


@router.delete("/groups/{group_id}/files/{file_id:path}", response_model=DeleteResponse)
def delete_file(
    group_id: str,
    file_id: str,
    store: VectorStoreBase = Depends(get_vector_store),
):
    try:
        deleted = store.delete_file(group_id, file_id)
    except ValueError as e:
        raise HTTPException(422, str(e))
    return DeleteResponse(deleted_chunks=deleted)


@router.post("/chat", response_model=ChatResponse, response_model_exclude_none=True)
def chat(
    payload: ChatRequest,
    embedder: EmbeddingEngineBase = Depends(get_embedding_engine),
    store: VectorStoreBase = Depends(get_vector_store),
    llm: LLMClientBase = Depends(get_llm_client),
):
    try:
        direct_answer = small_talk_answer(payload.query)
        if direct_answer:
            return ChatResponse(
                query=payload.query,
                group_id=payload.group_id,
                answer=direct_answer,
                sources=[],
                grounding=grounding_status([], payload.require_citations, [], False),
            )

        query_vector = embedder.embed_text(payload.query)
        results = store.search(
            query_vector=query_vector,
            query_text=payload.query,
            group_id=payload.group_id,
            limit=payload.limit,
        )
        sources = [source_from_result(item, payload.query) for item in results]
        context = [
            f"{item.get('filename') or 'source'}"
            + (f" p.{item.get('page')}" if item.get('page') else "")
            + f"\n{item.get('text', '')}"
            for item in results
        ]
        llm_result = llm.generate_response(
            payload.query,
            context,
            require_citations=payload.require_citations,
        )
        answer = llm_result["answer"]
        citations = llm_result["citations"]
        insufficient = llm_result["insufficient"]

        # Filter valid citations
        valid_cites = sorted({
            int(c) for c in citations if 1 <= int(c) <= len(sources)
        })

        if payload.require_citations and (insufficient or not valid_cites):
            raw_answer = answer
            answer = "I don't have enough information in the provided documents."
            grounding = grounding_status(
                sources,
                payload.require_citations,
                citations,
                insufficient,
                raw_answer=raw_answer,
            )
        else:
            grounding = grounding_status(
                sources,
                payload.require_citations,
                citations,
                insufficient,
            )
    except Exception as e:
        raise HTTPException(500, f"Chat query failed: {e}")

    return ChatResponse(
        query=payload.query,
        group_id=payload.group_id,
        answer=answer,
        sources=sources,
        grounding=grounding,
    )


@router.post("/debug/search", response_model=DebugSearchResponse, response_model_exclude_none=True)
def debug_search(
    payload: DebugSearchRequest,
    embedder: EmbeddingEngineBase = Depends(get_embedding_engine),
    store: VectorStoreBase = Depends(get_vector_store),
):
    try:
        query_vector = embedder.embed_text(payload.query)
        results = store.search(
            query_vector=query_vector,
            query_text=payload.query,
            group_id=payload.group_id,
            limit=payload.limit,
        )
    except Exception as e:
        raise HTTPException(500, f"Debug search failed: {e}")

    return DebugSearchResponse(
        query=payload.query,
        group_id=payload.group_id,
        results=[source_from_result(item, payload.query) for item in results],
    )


@router.get("/chunks/{chunk_id}", response_model=ChunkDetail, response_model_exclude_none=True)
def get_chunk_detail(
    chunk_id: str,
    q: str | None = Query(None, description="Optional query term for match highlighting"),
    store: VectorStoreBase = Depends(get_vector_store),
):
    try:
        chunk = store.get_chunk(chunk_id)
    except Exception as e:
        raise HTTPException(500, f"Failed to retrieve chunk: {e}")

    if chunk is None:
        raise HTTPException(404, "Chunk not found")

    match_positions: list[list[int]] | None = None
    if q:
        terms = _extract_terms(q)
        if terms:
            pos: list[list[int]] = []
            lower = chunk.get("text", "").lower()
            for term in terms:
                idx = 0
                while True:
                    idx = lower.find(term, idx)
                    if idx == -1:
                        break
                    pos.append([idx, idx + len(term)])
                    idx += 1
            if pos:
                match_positions = sorted(pos, key=lambda p: p[0])

    return ChunkDetail(
        chunk_id=chunk.get("chunk_id", chunk_id),
        text=chunk.get("text", ""),
        filename=chunk.get("filename"),
        page=chunk.get("page"),
        file_id=chunk.get("file_id"),
        group_id=chunk.get("group_id"),
        score=chunk.get("score"),
        text_quality=chunk.get("text_quality"),
        match_positions=match_positions,
    )
