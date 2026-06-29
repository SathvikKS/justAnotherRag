from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from rag_api.auth import require_api_key
from rag_api.mcp_server import mcp
from rag_api.routes import router
from rag_core.config import get_settings

load_dotenv(Path(__file__).resolve().parents[2] / ".env", encoding="utf-8-sig")
settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create SQLModel tables (users, chat_sessions)
    from sqlmodel import SQLModel
    from rag_api.database import engine
    import rag_api.models  # load models to register them
    SQLModel.metadata.create_all(engine)

    # Create message store table for langchain
    from langchain_postgres import PostgresChatMessageHistory
    import psycopg
    conn_url = settings.database_url.replace("postgresql+psycopg://", "postgresql://")
    with psycopg.connect(conn_url) as conn:
        PostgresChatMessageHistory.create_tables(conn, "message_store")

    async with mcp.session_manager.run():
        yield


app = FastAPI(title="Local RAG API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def api_key_middleware(request, call_next):
    return await require_api_key(request, call_next)


app.include_router(router)
app.mount("/mcp", mcp.streamable_http_app())
