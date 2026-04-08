"""
Shared Supabase client for all pipeline scripts.

Usage:
    from pipeline.utils.supabase_client import get_client

    supabase = get_client()
    result = supabase.table('candidates').select('*').execute()

The client is initialized once per process from environment variables.
Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env (locally) or
as GitHub Actions secrets (in CI).

Service role key (not anon key) is required for pipeline scripts —
they write to the database and need to bypass RLS.
"""

import os
from functools import lru_cache

from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()


@lru_cache(maxsize=1)
def get_client() -> Client:
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

    if not url or not key:
        raise EnvironmentError(
            "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set. "
            "Copy .env.example to .env and fill in your Supabase project credentials."
        )

    return create_client(url, key)
