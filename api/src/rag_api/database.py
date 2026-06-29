import psycopg
from sqlmodel import create_engine, Session
from rag_core.config import get_settings

settings = get_settings()

# Use the environment-configured DATABASE_URL
engine = create_engine(
    settings.database_url,
    echo=False,  # Set to True if we need detailed SQL debug logging
)

def get_session():
    """Yields a SQLModel transaction session."""
    with Session(engine) as session:
        yield session

def get_psycopg_conn():
    """Yields a raw psycopg Connection (needed for PostgresChatMessageHistory)."""
    conn_url = settings.database_url.replace("postgresql+psycopg://", "postgresql://")
    conn = psycopg.connect(conn_url)
    try:
        yield conn
    finally:
        conn.close()
