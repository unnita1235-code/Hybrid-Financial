"""SQL graph accessor used by API routers."""

from __future__ import annotations

from fastapi import FastAPI


def get_sql_graph(app: FastAPI):
    return getattr(app.state, "sql_graph", None)
