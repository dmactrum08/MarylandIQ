"""
generate_office_explainers.py

Stage 3 script — generate plain-English office explainers for each distinct
office type in the offices table.

One Gemini call per office (~12 offices total). Results are cached in
offices.explainer_text and never regenerated unless --force is passed.

Usage:
    python -m pipeline.generate_office_explainers                   # Gemini (default)
    python -m pipeline.generate_office_explainers --backend lmstudio
    python -m pipeline.generate_office_explainers --force           # re-generate all
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
import time

from dotenv import load_dotenv

from pipeline.utils.supabase_client import get_client

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger(__name__)

GEMINI_RATE_LIMIT_SLEEP = 4  # seconds between calls; keeps under 15 req/min free tier
LM_STUDIO_BASE_URL = "http://localhost:1234/v1"
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"

SYSTEM_PROMPT = (
    "You are writing plain-English explainers for a nonpartisan Maryland voter "
    "information platform. Your audience is a typical voter who may not know what a "
    "given local office does. Write clearly and factually. Do not editorialize. "
    "Do not mention political parties. Output only the explainer text — no title, "
    "no markdown, no preamble."
)

USER_PROMPT_TEMPLATE = (
    "Write a 2-3 sentence plain-English explanation of what the office of {office_name} "
    "does in Maryland local government. Focus on the responsibilities and powers of the "
    "role. Write for a voter who wants to know why this office matters before casting "
    "their ballot."
)


# ---------------------------------------------------------------------------
# Backends
# ---------------------------------------------------------------------------

class GeminiBackend:
    def __init__(self) -> None:
        import google.generativeai as genai
        api_key = os.environ.get("GOOGLE_AI_STUDIO_API_KEY")
        if not api_key:
            log.error("GOOGLE_AI_STUDIO_API_KEY not set in .env")
            sys.exit(1)
        genai.configure(api_key=api_key)
        self._model = genai.GenerativeModel(
            model_name="gemini-flash-latest",
            system_instruction=SYSTEM_PROMPT,
        )
        log.info("Backend: Gemini  model=gemini-flash-latest")

    def call(self, prompt: str) -> str:
        response = self._model.generate_content(prompt)
        return response.text

    def sleep_between_calls(self) -> None:
        time.sleep(GEMINI_RATE_LIMIT_SLEEP)


class LMStudioBackend:
    def __init__(self) -> None:
        from openai import OpenAI
        model = os.environ.get("LM_STUDIO_MODEL", "local-model")
        self._model = model
        self._client = OpenAI(base_url=LM_STUDIO_BASE_URL, api_key="lm-studio")
        log.info(f"Backend: LM Studio  model={model}  url={LM_STUDIO_BASE_URL}")

    def call(self, prompt: str) -> str:
        response = self._client.chat.completions.create(
            model=self._model,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            temperature=0.3,
        )
        return response.choices[0].message.content

    def sleep_between_calls(self) -> None:
        pass


class OpenRouterBackend:
    def __init__(self) -> None:
        from openai import OpenAI
        api_key = os.environ.get("OPENROUTER_API_KEY")
        if not api_key:
            log.error("OPENROUTER_API_KEY not set in .env")
            sys.exit(1)
        model = os.environ.get("OPENROUTER_MODEL", "google/gemini-2.5-flash-preview")
        self._model = model
        self._client = OpenAI(base_url=OPENROUTER_BASE_URL, api_key=api_key)
        log.info(f"Backend: OpenRouter  model={model}")

    def call(self, prompt: str) -> str:
        response = self._client.chat.completions.create(
            model=self._model,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            temperature=0.3,
        )
        return response.choices[0].message.content

    def sleep_between_calls(self) -> None:
        time.sleep(1)  # light throttle; adjust if hitting rate limits


def make_backend(name: str):
    if name == "lmstudio":
        return LMStudioBackend()
    if name == "openrouter":
        return OpenRouterBackend()
    return GeminiBackend()


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

def fetch_offices(supabase, force: bool = False) -> list[dict]:
    """Return offices that still need an explainer (or all if --force)."""
    query = supabase.table("offices").select("id, slug, name, explainer_text")
    if not force:
        query = query.is_("explainer_text", "null")
    return query.execute().data


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def generate_office_explainers(backend_name: str = "gemini", force: bool = False) -> dict[str, int]:
    backend = make_backend(backend_name)
    supabase = get_client()

    offices = fetch_offices(supabase, force=force)
    log.info(f"Found {len(offices)} offices to process")

    if not offices:
        log.info("All offices already have explainers. Use --force to regenerate.")
        return {"generated": 0, "errors": 0}

    generated = 0
    errors = 0
    now_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    for i, office in enumerate(offices):
        if i > 0:
            backend.sleep_between_calls()

        name = office["name"]
        log.info(f"[{i+1}/{len(offices)}] {name}")

        prompt = USER_PROMPT_TEMPLATE.format(office_name=name)

        try:
            raw = backend.call(prompt)
        except Exception as exc:
            log.error(f"API error for {name}: {exc}")
            errors += 1
            continue

        explainer = raw.strip().strip("`").strip()
        if not explainer:
            log.warning(f"Empty response for {name} — skipping")
            errors += 1
            continue

        try:
            supabase.table("offices").update({
                "explainer_text": explainer,
                "explainer_source": "ai_generated",
                "explainer_generated_at": now_iso,
            }).eq("id", office["id"]).execute()

            generated += 1
            log.info(f"  → {explainer[:100]}{'...' if len(explainer) > 100 else ''}")
        except Exception as exc:
            log.error(f"DB write error for {name}: {exc}")
            errors += 1

    supabase.table("pipeline_runs").insert({
        "script_name": "generate_office_explainers.py",
        "candidates_processed": generated,
        "errors": errors,
        "notes": f"backend={backend_name} force={force}",
    }).execute()

    return {"generated": generated, "errors": errors}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Generate plain-English office explainers via Gemini."
    )
    parser.add_argument(
        "--backend",
        choices=["gemini", "lmstudio", "openrouter"],
        default="gemini",
        help="AI backend to use (default: gemini)",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-generate explainers even if already set.",
    )
    args = parser.parse_args()

    log.info(f"=== generate_office_explainers.py  backend={args.backend} ===")
    try:
        result = generate_office_explainers(backend_name=args.backend, force=args.force)
        log.info(f"Done. {result}")
        sys.exit(0)
    except Exception as exc:
        log.error(f"Fatal error: {exc}")
        raise
