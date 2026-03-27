from supabase import Client, create_client

from api.config import settings


def get_supabase_client() -> Client:
    """Supabase client using anon key, for unauthenticated operations.
    Does NOT carry a user JWT, so RLS policies that check auth.uid() will block access.
    Use this only for operations that don't require user context (e.g., public lookups)."""
    return create_client(settings.supabase_url, settings.supabase_key)


def get_authenticated_client(token: str) -> Client:
    """Supabase client with the user's JWT set, so RLS enforces tenant isolation.
    Use this for ALL normal user operations — every query runs as the authenticated user,
    and RLS policies automatically filter by company_id via auth.uid().

    Args:
        token: The user's Supabase JWT (from Authorization header).
    """
    client = create_client(settings.supabase_url, settings.supabase_key)
    client.auth.set_session(token, token)
    return client


def get_supabase_admin_client() -> Client:
    """Supabase client using service role key (bypasses RLS).
    Use ONLY for platform admin operations and onboarding (e.g., creating initial
    company/user records, public share link access). Never use for normal user queries."""
    return create_client(
        settings.supabase_url, settings.supabase_service_role_key.get_secret_value()
    )
