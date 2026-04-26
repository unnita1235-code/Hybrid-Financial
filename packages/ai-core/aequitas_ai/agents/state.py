from typing import Annotated, Any, TypedDict

from langgraph.graph.message import add_messages
from langchain_core.messages import BaseMessage


class AequitasGraphState(TypedDict, total=False):
    """Shared LangGraph state for SQL + RAG hybrid flows."""

    messages: Annotated[list[BaseMessage], add_messages]
    user_query: str
    schema_context: str
    generated_sql: str | None
    sql_result_rows: list[dict[str, Any]]
    retrieved_chunks: list[dict[str, Any]]
    final_answer: str | None
    error: str | None
