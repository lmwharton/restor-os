from supabase import Client, create_client

from api.config import settings


def get_supabase_client() -> Client:
    """Supabase client using anon key (respects RLS)."""
    return create_client(settings.supabase_url, settings.supabase_key)


def get_supabase_admin_client() -> Client:
    """Supabase client using service role key (bypasses RLS).
    Use only for admin operations like public report access."""
    return create_client(
        settings.supabase_url, settings.supabase_service_role_key.get_secret_value()
    )
