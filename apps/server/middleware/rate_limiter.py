from __future__ import annotations

import asyncio
import math
import time
from collections import deque
from dataclasses import dataclass

import jwt
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.config import settings


@dataclass(slots=True)
class RateLimitConfig:
    requests_per_minute: int = 30
    requests_per_hour: int = 300


class RateLimiterMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, config: RateLimitConfig | None = None) -> None:
        super().__init__(app)
        self.config = config or RateLimitConfig(
            requests_per_minute=settings.rate_limit_rpm,
            requests_per_hour=settings.rate_limit_rph,
        )
        self._timestamps: dict[str, deque[float]] = {}
        self._lock = asyncio.Lock()

    async def dispatch(self, request: Request, call_next) -> Response:
        path = request.url.path
        if path.startswith("/health") or path.startswith("/docs"):
            return await call_next(request)

        key = self._identity_key(request)
        now = time.time()
        retry_after_seconds: int | None = None

        async with self._lock:
            timestamps = self._timestamps.setdefault(key, deque())
            hour_cutoff = now - 3600
            while timestamps and timestamps[0] < hour_cutoff:
                timestamps.popleft()

            minute_cutoff = now - 60
            minute_count = 0
            minute_oldest = now
            for ts in reversed(timestamps):
                if ts < minute_cutoff:
                    break
                minute_count += 1
                minute_oldest = ts

            if minute_count >= self.config.requests_per_minute:
                retry_after_seconds = max(1, math.ceil((minute_oldest + 60) - now))
            elif len(timestamps) >= self.config.requests_per_hour:
                retry_after_seconds = max(1, math.ceil((timestamps[0] + 3600) - now))
            else:
                timestamps.append(now)

        if retry_after_seconds is not None:
            return JSONResponse(
                {"detail": f"Rate limit exceeded. Try again in {retry_after_seconds}s."},
                status_code=429,
                headers={"Retry-After": str(retry_after_seconds)},
            )
        return await call_next(request)

    def _identity_key(self, request: Request) -> str:
        token = self._bearer_token(request)
        if token:
            sub = self._sub_from_jwt(token)
            if sub:
                return f"user:{sub}"
        return f"ip:{self._client_ip(request)}"

    @staticmethod
    def _bearer_token(request: Request) -> str | None:
        auth_header = request.headers.get("Authorization") or request.headers.get("authorization")
        if not auth_header or not auth_header.lower().startswith("bearer "):
            return None
        return auth_header[7:].strip() or None

    @staticmethod
    def _sub_from_jwt(token: str) -> str | None:
        try:
            payload = jwt.decode(
                token,
                settings.supabase_jwt_secret or "",
                algorithms=["HS256"],
                options={"verify_signature": bool(settings.supabase_jwt_secret)},
            )
        except jwt.PyJWTError:
            try:
                payload = jwt.decode(
                    token,
                    options={"verify_signature": False},
                    algorithms=["HS256"],
                )
            except jwt.PyJWTError:
                return None
        sub = payload.get("sub")
        return str(sub) if sub else None

    @staticmethod
    def _client_ip(request: Request) -> str:
        forwarded = request.headers.get("X-Forwarded-For")
        if forwarded:
            first_ip = forwarded.split(",")[0].strip()
            if first_ip:
                return first_ip
        if request.client and request.client.host:
            return request.client.host
        return "unknown"
