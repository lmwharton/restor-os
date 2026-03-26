from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", ".env.local"),  # .env.local overrides .env
        env_file_encoding="utf-8",
    )

    # Environment
    environment: str = "development"

    # Supabase
    supabase_url: str = ""
    supabase_key: str = ""  # anon key (respects RLS)
    supabase_service_role_key: SecretStr = SecretStr("")  # service role key (bypasses RLS)
    supabase_jwt_secret: str = ""  # JWT secret for verifying Supabase auth tokens

    # CORS
    cors_origins: list[str] = ["http://localhost:3000"]

    # Database (used by Alembic migrations — not by app queries)
    database_url: str = ""

    # Server
    port: int = 8000


settings = Settings()
