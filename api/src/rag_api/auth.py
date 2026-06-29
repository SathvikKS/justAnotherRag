import uuid
from datetime import datetime, timedelta
from typing import Optional
from jose import jwt, JWTError
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlmodel import Session

from rag_core.config import get_settings
from rag_api.database import get_session
from rag_api.models import User

settings = get_settings()

ALGORITHM = "HS256"
# Token validity: 7 days for local development
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7

import bcrypt
import hashlib

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")

def _pre_hash(password: str) -> str:
    """Pre-hashes the password to bypass bcrypt's 72-byte limit."""
    return hashlib.sha256(password.encode("utf-8")).hexdigest()

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verifies a plain password against its hashed version using native bcrypt."""
    try:
        return bcrypt.checkpw(_pre_hash(plain_password).encode("utf-8"), hashed_password.encode("utf-8"))
    except Exception:
        return False

def get_password_hash(password: str) -> str:
    """Hashes a password for secure storage using native bcrypt."""
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(_pre_hash(password).encode("utf-8"), salt)
    return hashed.decode("utf-8")

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """Creates a signed JSON Web Token (JWT)."""
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, settings.secret_key, algorithm=ALGORITHM)
    return encoded_jwt

def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_session)
) -> User:
    """Validates the JWT token and returns the current user."""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    # Query the user from SQLModel DB
    user = db.query(User).filter(User.username == username).first()
    if user is None:
        raise credentials_exception
    return user


# --- Original API Key Middleware for MCP ---
from secrets import compare_digest
from fastapi import Request
from fastapi.responses import JSONResponse

API_KEY_HEADER = "x-api-key"
MCP_PATH_PREFIX = "/mcp"
AUTH_EXEMPT_PATHS = {
    "/docs",
    "/docs/oauth2-redirect",
    "/openapi.json",
    "/redoc",
}

def _is_auth_exempt(request: Request) -> bool:
    if request.method == "OPTIONS":
        return True
    return request.url.path in AUTH_EXEMPT_PATHS

def _requires_api_key(request: Request) -> bool:
    return request.url.path == MCP_PATH_PREFIX or request.url.path.startswith(
        f"{MCP_PATH_PREFIX}/"
    )

async def require_api_key(request: Request, call_next):
    if _is_auth_exempt(request) or not _requires_api_key(request):
        return await call_next(request)

    expected_api_key = get_settings().api_key
    if expected_api_key:
        supplied_api_key = request.headers.get(API_KEY_HEADER, "")
        if not compare_digest(supplied_api_key, expected_api_key):
            return JSONResponse(
                status_code=401,
                content={
                    "detail": "Missing or invalid API key",
                    "header": API_KEY_HEADER,
                },
            )

    return await call_next(request)
