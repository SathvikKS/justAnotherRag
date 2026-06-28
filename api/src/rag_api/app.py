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
