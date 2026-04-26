from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "Aequitas FI"
    database_url: str = (
        "postgresql+asyncpg://aequitas:aequitas_dev@localhost:5432/aequitas"
    )
    # Model routing (configure keys in .env; names reflect product choice)
    sql_model: str = "o3-mini"
    synthesis_model: str = "claude-3-5-sonnet-20241022"
    # Shadow analyst (APScheduler, Z-score, notifications)
    shadow_analyst_enabled: bool = True
    news_api_key: str | None = None
    news_api_url: str = "https://newsapi.org/v2/everything"
    # Ingestion / RAG (keys optional; features degrade gracefully)
    openai_api_key: str | None = None
    anthropic_api_key: str | None = None
    llamaparse_api_key: str | None = None
    # LlamaCloud also reads LLAMA_CLOUD_API_KEY; we map from llamaparse_api_key in code
    supabase_url: str | None = None
    supabase_service_key: str | None = None
    embedding_model: str = "text-embedding-3-small"
    vision_provider: str = "openai"  # openai | anthropic
    vision_openai_model: str = "gpt-4o"
    vision_anthropic_model: str = "claude-3-5-sonnet-20241022"
    debate_bull_bear_model: str = "claude-3-5-sonnet-20241022"
    debate_w1: float = 0.5
    debate_w2: float = 0.5
    # Auth / RBAC: none | dev | supabase | clerk
    # dev: trust X-User-Id, X-User-Role (local + integration tests)
    # supabase: HS256 with SUPABASE_JWT_SECRET; role in app_metadata.role
    # clerk: RS256 via Clerk JWKS; role in public_metadata["aequitas_role"] or o.claims
    auth_provider: str = "dev"
    supabase_jwt_secret: str | None = None
    clerk_jwks_url: str | None = None
    clerk_authorized_parties: str = ""
    # Comma list; empty → executive, admin, superuser
    rbac_elevated_roles: str = ""
    # Comma list of SQL table names (no schema); empty → salaries, m_and_a_plans
    rbac_executive_tables: str = ""
    # Local Presidio redaction around synthesis LLM (temporal narrative, etc.).
    # Requires a spaCy model, e.g. ``python -m spacy download en_core_web_sm``.
    pii_redaction_enabled: bool = True
    # LangGraph temporal agent: use Postgres checkpointer (langgraph-checkpoint-postgres)
    # when true; in-memory if false or on connection/setup failure (unless required).
    use_postgres_checkpointer: bool = True
    # If true, do not fall back to MemorySaver when Postgres checkpointer init fails.
    checkpointer_postgres_required: bool = False


settings = Settings()
