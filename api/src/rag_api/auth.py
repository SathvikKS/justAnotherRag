from secrets import compare_digest

from fastapi import Request
from fastapi.responses import JSONResponse

from rag_core.config import get_settings

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
