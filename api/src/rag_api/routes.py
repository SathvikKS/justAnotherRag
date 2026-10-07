import re
import uuid
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel, Field, field_validator
from sqlmodel import Session

from langchain_postgres import PostgresChatMessageHistory
from langchain_core.messages import HumanMessage, AIMessage

from rag_api.dependencies import (
    get_embedding_engine,
    get_llm_client,
    get_vector_store,
)
from rag_api.database import get_session, get_psycopg_conn
from rag_api.models import User, ChatSession
from rag_api.auth import (
    get_current_user,
    create_access_token,
    get_password_hash,
    verify_password,
)
from rag_api.ingestion import get_task_status, enqueue_upload, GROUP_ID_REGEX
from rag_core.interfaces import EmbeddingEngineBase, LLMClientBase, VectorStoreBase

router = APIRouter()


class ChatRequest(BaseModel):
    query: str = Field(..., min_length=1)
    group_id: str
    limit: int = Field(5, ge=1, le=20)
    require_citations: bool = False
    expand_query: bool = True
    session_id: str = "11111111-1111-1111-1111-111111111111"

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
    metrics: dict | None = None
    completion_status: Literal["complete", "truncated", "interrupted", "invalid"] = "complete"


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


def _normalize_search_questions(value: object, original_query: str) -> list[str]:
    if not isinstance(value, (list, tuple)):
        return [original_query]

    questions: list[str] = []
    seen: set[str] = set()
    for candidate in value:
        if not isinstance(candidate, str):
            continue
        question = candidate.strip()
        normalized = question.casefold()
        if not question or normalized in seen:
            continue
        seen.add(normalized)
        questions.append(question)
        if len(questions) == 5:
            break

    return questions or [original_query]


def _result_score(item: dict) -> tuple[float | None, bool]:
    """Return a comparable score and whether smaller values are better."""
    for key in ("_relevance_score", "_score"):
        value = item.get(key)
        if value is not None:
            return float(value), False
    value = item.get("_distance")
    if value is not None:
        return float(value), True
    value = item.get("score")
    if value is not None:
        return float(value), False
    return None, False


def _result_rank(item: dict) -> float | None:
    score, is_distance = _result_score(item)
    if score is None:
        return None
    return -score if is_distance else score


def _merge_search_results(result_sets: list[list[dict]]) -> list[dict]:
    """Deduplicate chunks, keeping best scores and stable ranking ties."""
    merged: list[dict] = []
    positions: dict[str, int] = {}
    for results in result_sets:
        for item in results:
            chunk_id = item.get("chunk_id")
            if not isinstance(chunk_id, str) or not chunk_id:
                merged.append(item)
                continue

            existing_position = positions.get(chunk_id)
            if existing_position is None:
                positions[chunk_id] = len(merged)
                merged.append(item)
                continue

            current = merged[existing_position]
            current_score, current_is_distance = _result_score(current)
            candidate_score, candidate_is_distance = _result_score(item)
            if candidate_score is None:
                continue
            if current_score is None:
                merged[existing_position] = item
                continue

            # A vector-store search uses one metric for all its query results. Keep
            # the first item if score metadata unexpectedly changes shape.
            if candidate_is_distance != current_is_distance:
                continue
            is_better = (
                candidate_score < current_score
                if candidate_is_distance
                else candidate_score > current_score
            )
            if is_better:
                merged[existing_position] = item

    # Python's sort is stable, so equal-ranked chunks retain their first-seen order.
    return sorted(
        merged,
        key=lambda item: (
            _result_rank(item) is None,
            -_result_rank(item) if _result_rank(item) is not None else 0.0,
        ),
    )


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


class RegisterRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    password: str = Field(..., min_length=4)


class SessionCreateRequest(BaseModel):
    title: str | None = None


@router.post("/auth/register")
def register(payload: RegisterRequest, db: Session = Depends(get_session)):
    existing = db.query(User).filter(User.username == payload.username).first()
    if existing:
        raise HTTPException(status_code=400, detail="Username already registered")

    password_hash = get_password_hash(payload.password)
    user = User(username=payload.username, password_hash=password_hash)
    db.add(user)
    db.commit()
    db.refresh(user)
    return {"message": "Registration successful", "username": user.username}


@router.post("/auth/login")
def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_session)
):
    user = db.query(User).filter(User.username == form_data.username).first()
    if not user or not verify_password(form_data.password, user.password_hash):
        raise HTTPException(status_code=400, detail="Incorrect username or password")

    access_token = create_access_token(data={"sub": user.username})
    return {"access_token": access_token, "token_type": "bearer", "username": user.username}


@router.get("/chat/sessions", response_model=list[dict])
def list_sessions(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_session)
):
    sessions = db.query(ChatSession).filter(ChatSession.user_id == current_user.id).order_by(ChatSession.created_at.desc()).all()
    return [
        {
            "id": str(s.id),
            "title": s.title or "Untitled Session",
            "created_at": s.created_at.isoformat()
        } for s in sessions
    ]


@router.post("/chat/sessions", response_model=dict)
def create_session(
    payload: SessionCreateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_session)
):
    session = ChatSession(user_id=current_user.id, title=payload.title)
    db.add(session)
    db.commit()
    db.refresh(session)
    return {
        "id": str(session.id),
        "title": session.title or "Untitled Session",
        "created_at": session.created_at.isoformat()
    }


@router.delete("/chat/sessions/{session_id}")
def delete_session(
    session_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
    db_conn = Depends(get_psycopg_conn)
):
    try:
        session_uuid = uuid.UUID(session_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid session_id format")

    session = db.query(ChatSession).filter(
        ChatSession.id == session_uuid,
        ChatSession.user_id == current_user.id
    ).first()

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Delete session
    db.delete(session)
    db.commit()

    # Clean up associated messages in message_store
    with db_conn.cursor() as cur:
        cur.execute("DELETE FROM message_store WHERE session_id = %s", (session_id,))

    return {"message": "Session deleted successfully"}


@router.get("/chat/sessions/{session_id}/messages")
def get_session_messages(
    session_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
    db_conn = Depends(get_psycopg_conn)
):
    try:
        session_uuid = uuid.UUID(session_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid session_id format")

    session = db.query(ChatSession).filter(
        ChatSession.id == session_uuid,
        ChatSession.user_id == current_user.id
    ).first()

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    history = PostgresChatMessageHistory(
        "message_store",
        str(session_id),
        sync_connection=db_conn
    )

    messages = []
    for i, msg in enumerate(history.messages):
        additional = getattr(msg, "additional_kwargs", {})
        entry = {
            "id": f"msg-{i}",
            "role": "user" if getattr(msg, "type", "") == "human" else "assistant",
            "content": getattr(msg, "content", ""),
            "sources": additional.get("sources", []),
            "grounding": additional.get("grounding", {}),
        }
        if additional.get("completion_status") in {
            "complete", "truncated", "interrupted", "invalid"
        }:
            entry["completion_status"] = additional["completion_status"]
        messages.append(entry)
    return messages


@router.post("/upload")
async def upload(
    file: UploadFile = File(...),
    group_id: str = Form(...),
):
    file_bytes = await file.read()
    if len(file_bytes) > 50 * 1024 * 1024:
        raise HTTPException(400, "File size exceeds 50MB limit.")

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
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
    db_conn = Depends(get_psycopg_conn),
    embedder: EmbeddingEngineBase = Depends(get_embedding_engine),
    store: VectorStoreBase = Depends(get_vector_store),
    llm: LLMClientBase = Depends(get_llm_client),
):
    try:
        session_uuid = uuid.UUID(payload.session_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid session_id format")

    session = db.query(ChatSession).filter(
        ChatSession.id == session_uuid,
        ChatSession.user_id == current_user.id
    ).first()

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Update session title dynamically on the first query
    if not session.title or session.title == "Untitled Session":
        session.title = payload.query[:40] + ("..." if len(payload.query) > 40 else "")
        db.add(session)
        db.commit()

    # Initialize LangChain history
    history = PostgresChatMessageHistory(
        "message_store",
        str(payload.session_id),
        sync_connection=db_conn
    )

    # Fetch and trim history (last 4 messages starting with human query)
    past_messages = history.messages
    trimmed = past_messages[-4:]
    if trimmed and getattr(trimmed[0], "type", "") != "human":
        trimmed = trimmed[1:]

    formatted_history = "\n".join(
        f"User: {m.content}"
        if getattr(m, "type", "") == "human"
        else (
            f"Assistant (incomplete response): {m.content}"
            if getattr(m, "additional_kwargs", {}).get("completion_status")
            in {"truncated", "interrupted", "invalid"}
            else f"Assistant: {m.content}"
        )
        for m in trimmed
    )

    try:
        direct_answer = small_talk_answer(payload.query)
        if direct_answer:
            grounding = grounding_status([], payload.require_citations, [], False)
            history.add_message(HumanMessage(content=payload.query))
            history.add_message(AIMessage(
                content=direct_answer,
                additional_kwargs={
                    "sources": [],
                    "grounding": grounding,
                    "completion_status": "complete",
                }
            ))
            return ChatResponse(
                query=payload.query,
                group_id=payload.group_id,
                answer=direct_answer,
                sources=[],
                grounding=grounding,
                metrics=None,
                completion_status="complete",
            )

        if payload.expand_query:
            try:
                generated_questions = llm.generate_search_questions(payload.query)
            except Exception:
                generated_questions = []
            search_queries = _normalize_search_questions(
                generated_questions,
                payload.query,
            )
        else:
            search_queries = [payload.query]

        if len(search_queries) == 1:
            query_vectors = [embedder.embed_text(search_queries[0])]
        else:
            query_vectors = embedder.embed_texts(search_queries)
        if len(query_vectors) != len(search_queries):
            raise ValueError(
                "Embedding engine returned a different number of vectors than queries"
            )

        result_sets = [
            store.search(
                query_vector=query_vector,
                query_text=search_query,
                group_id=payload.group_id,
                limit=payload.limit,
            )
            for search_query, query_vector in zip(search_queries, query_vectors)
        ]
        results = _merge_search_results(result_sets)
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
            history=formatted_history
        )
        answer = llm_result["answer"]
        citations = llm_result["citations"]
        insufficient = llm_result["insufficient"]
        metrics = llm_result.get("metrics")
        completion_status = llm_result.get("completion_status", "complete")
        if completion_status not in {"complete", "truncated", "interrupted", "invalid"}:
            raise ValueError("LLM returned an invalid completion status")

        # Filter valid citations
        valid_cites = sorted({
            int(c) for c in citations if 1 <= int(c) <= len(sources)
        })

        if payload.require_citations and completion_status != "complete":
            raw_answer = answer
            answer = "I couldn't complete a verifiable answer. Please try again."
            grounding = grounding_status(
                sources,
                payload.require_citations,
                [],
                False,
                raw_answer=raw_answer,
            )
            grounding["status"] = "rejected_incomplete"
        elif payload.require_citations and (insufficient or not valid_cites):
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

        # Save conversation turn to database history
        history.add_message(HumanMessage(content=payload.query))
        history.add_message(AIMessage(
            content=answer,
            additional_kwargs={
                "sources": [s.model_dump() for s in sources],
                "grounding": grounding,
                "completion_status": completion_status,
            }
        ))
    except Exception as e:
        raise HTTPException(500, f"Chat query failed: {e}")

    return ChatResponse(
        query=payload.query,
        group_id=payload.group_id,
        answer=answer,
        sources=sources,
        grounding=grounding,
        metrics=metrics,
        completion_status=completion_status,
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
