"""
enrich_candidates.py

Stage 2 script — send scraped candidate content to an AI model and store
AI-generated summary, issue tags, and source evidence in candidate_enrichment.

Algorithm per implementation strategy section 4.6:
    1. Query candidates where ai_generated_at IS NULL (or enrichment_version stale)
       AND (scraped_website_text IS NOT NULL OR social_inference_text IS NOT NULL)
    2. For each candidate, build a user prompt with full context
    3. Call AI model; parse JSON response
    4. Validate issue_tags against approved list
    5. Upsert candidate_enrichment; set ai_generated_at + enrichment_version

Backend options (--backend flag):
    lmstudio  (default) Local LM Studio at http://localhost:1234. Set LM_STUDIO_MODEL
              in .env to override the model identifier (default: "local-model").
    gemini    Google AI Studio. Requires GOOGLE_AI_STUDIO_API_KEY in .env.
              Rate limited to 15 req/min (free tier); sleeps 4s between calls.

Usage:
    python -m pipeline.enrich_candidates                  # LM Studio
    python -m pipeline.enrich_candidates --backend gemini # Gemini
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
import time
from dataclasses import dataclass
from typing import Optional, Protocol

from dotenv import load_dotenv

from pipeline.utils.supabase_client import get_client

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger(__name__)

# Increment when the prompt or schema changes; triggers re-enrichment of all rows.
CURRENT_VERSION = 1

LM_STUDIO_BASE_URL = "http://localhost:1234/v1"
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
GEMINI_RATE_LIMIT_SLEEP = 4  # seconds between calls; keeps under 15 req/min

APPROVED_ISSUE_TAGS = [
    "Education",
    "Housing",
    "Public Safety",
    "Transportation",
    "Environment",
    "Fiscal Policy",
    "Economic Development",
    "Healthcare",
    "Infrastructure",
    "Immigration",
    "Land Use",
    "Agriculture",
    "Criminal Justice",
    "Veterans",
    "Seniors",
    "Youth",
    "Small Business",
    "Tax Policy",
    "Government Ethics",
    "Community Development",
]

APPROVED_TAGS_LOWER = {t.lower(): t for t in APPROVED_ISSUE_TAGS}

SYSTEM_PROMPT = (
    "/no_think "
    "You are a factual summarizer for a nonpartisan voter information platform. "
    "You extract and summarize only what candidates have explicitly stated. "
    "You never invent positions. If information is insufficient, return null "
    "for that field. Always return valid JSON with no markdown fences or preamble."
)


# ---------------------------------------------------------------------------
# Backend abstraction
# ---------------------------------------------------------------------------

class AIBackend(Protocol):
    def call(self, prompt: str) -> str: ...
    def sleep_between_calls(self) -> None: ...


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
            temperature=0.2,
        )
        return response.choices[0].message.content

    def sleep_between_calls(self) -> None:
        pass  # no rate limit for local


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
            temperature=0.2,
        )
        return response.choices[0].message.content

    def sleep_between_calls(self) -> None:
        time.sleep(1)  # light throttle; adjust if hitting rate limits


class GeminiBackend:
    def __init__(self) -> None:
        import google.generativeai as genai
        api_key = os.environ.get("GOOGLE_AI_STUDIO_API_KEY")
        if not api_key:
            log.error("GOOGLE_AI_STUDIO_API_KEY not set")
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


def make_backend(name: str) -> AIBackend:
    if name == "gemini":
        return GeminiBackend()
    if name == "openrouter":
        return OpenRouterBackend()
    return LMStudioBackend()


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------

@dataclass
class EnrichmentTarget:
    candidate_id: str
    full_name: str
    office_name: str
    jurisdiction: str
    campaign_website_url: Optional[str]
    scraped_website_text: Optional[str]
    social_inference_text: Optional[str]


# ---------------------------------------------------------------------------
# Prompt building
# ---------------------------------------------------------------------------

def _truncate(text: str, max_chars: int) -> str:
    """Trim text to max_chars, appending a note if cut."""
    if len(text) <= max_chars:
        return text
    return text[:max_chars] + "\n[...truncated]"


def build_user_prompt(target: EnrichmentTarget) -> str:
    sources: list[str] = []
    if target.campaign_website_url:
        sources.append(target.campaign_website_url)

    source_line = ", ".join(sources) if sources else "none"
    # ~4 chars per token; reserve ~600 tokens for prompt scaffold + JSON response
    website_text = _truncate(target.scraped_website_text or "none", 6000)
    social_text = _truncate(target.social_inference_text or "none", 2000)

    return (
        f"Candidate: {target.full_name}\n"
        f"Office: {target.office_name}, {target.jurisdiction}\n"
        f"Sources provided: {source_line}\n\n"
        f"---- WEBSITE TEXT ----\n"
        f"{website_text}\n\n"
        f"---- SOCIAL MEDIA TEXT ----\n"
        f"{social_text}\n\n"
        f"----\n\n"
        f"Return JSON with these fields:\n"
        f'{{\n'
        f'  "summary": "string (2-4 sentences) | null",\n'
        f'  "issue_tags": ["string[] from approved list only"],\n'
        f'  "issue_tag_evidence": [{{"tag": "...", "quote_snippet": "...", "source_url": "..."}}],\n'
        f'  "inferred_from_social": false,\n'
        f'  "confidence": "high | medium | low"\n'
        f"}}"
    )


# ---------------------------------------------------------------------------
# Response parsing
# ---------------------------------------------------------------------------

def parse_response(raw: str) -> Optional[dict]:
    """Extract and parse JSON from the model's response text."""
    # Strip Qwen3 thinking blocks if thinking mode wasn't fully suppressed
    cleaned = re.sub(r"<think>.*?</think>", "", raw.strip(), flags=re.DOTALL)
    # Strip markdown code fences if the model added them despite instructions
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned.strip(), flags=re.IGNORECASE)
    cleaned = re.sub(r"\s*```$", "", cleaned.strip())
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError as exc:
        log.warning(f"JSON parse failed: {exc} — raw: {raw[:200]!r}")
        return None


def validate_tags(tags: list) -> list[str]:
    """Return only tags that appear in the approved list (case-insensitive)."""
    if not isinstance(tags, list):
        return []
    validated: list[str] = []
    for tag in tags:
        if not isinstance(tag, str):
            continue
        canonical = APPROVED_TAGS_LOWER.get(tag.lower().strip())
        if canonical:
            validated.append(canonical)
        else:
            log.debug(f"Dropping unapproved tag: {tag!r}")
    return validated


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

def fetch_targets(supabase) -> list[EnrichmentTarget]:
    """Return candidates that need enrichment (no AI output yet or stale version)."""
    rows = (
        supabase.table("candidate_enrichment")
        .select(
            "candidate_id, scraped_website_text, social_inference_text, "
            "ai_generated_at, enrichment_version"
        )
        .or_(f"ai_generated_at.is.null,enrichment_version.lt.{CURRENT_VERSION}")
        .not_.is_("scraped_website_text", "null")
        .execute()
        .data
    )

    # Also include rows where only social_inference_text is set (future use)
    rows_social = (
        supabase.table("candidate_enrichment")
        .select(
            "candidate_id, scraped_website_text, social_inference_text, "
            "ai_generated_at, enrichment_version"
        )
        .or_(f"ai_generated_at.is.null,enrichment_version.lt.{CURRENT_VERSION}")
        .is_("scraped_website_text", "null")
        .not_.is_("social_inference_text", "null")
        .execute()
        .data
    )

    all_rows = rows + rows_social
    candidate_ids = [r["candidate_id"] for r in all_rows]

    if not candidate_ids:
        return []

    enrichment_by_id = {r["candidate_id"]: r for r in all_rows}

    # Fetch candidates in batches to stay under URL length limits
    BATCH = 100
    candidates: list[dict] = []
    for i in range(0, len(candidate_ids), BATCH):
        chunk = candidate_ids[i : i + BATCH]
        candidates += (
            supabase.table("candidates")
            .select(
                "id, full_name, campaign_website_url, "
                "contest_id, contests(office_id, offices(name), "
                "jurisdiction_id, jurisdictions(name))"
            )
            .in_("id", chunk)
            .execute()
            .data
        )

    targets: list[EnrichmentTarget] = []
    for cand in candidates:
        enrichment = enrichment_by_id.get(cand["id"])
        if not enrichment:
            continue

        contest = cand.get("contests") or {}
        office_name = (contest.get("offices") or {}).get("name", "Unknown Office")
        jurisdiction = (contest.get("jurisdictions") or {}).get("name", "Unknown Jurisdiction")

        targets.append(
            EnrichmentTarget(
                candidate_id=cand["id"],
                full_name=cand["full_name"],
                office_name=office_name,
                jurisdiction=jurisdiction,
                campaign_website_url=cand.get("campaign_website_url"),
                scraped_website_text=enrichment.get("scraped_website_text"),
                social_inference_text=enrichment.get("social_inference_text"),
            )
        )

    return targets


def persist_result(supabase, target: EnrichmentTarget, parsed: dict) -> None:
    now_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    tags = validate_tags(parsed.get("issue_tags") or [])
    evidence = parsed.get("issue_tag_evidence") or []
    if not isinstance(evidence, list):
        evidence = []

    summary = parsed.get("summary")
    if not isinstance(summary, str):
        summary = None

    inferred = bool(parsed.get("inferred_from_social", False))
    confidence = parsed.get("confidence")
    if confidence not in ("high", "medium", "low"):
        confidence = "low"

    supabase.table("candidate_enrichment").update(
        {
            "ai_summary": summary,
            "ai_summary_sources": [{"url": target.campaign_website_url, "label": "Campaign website"}]
            if target.campaign_website_url
            else [],
            "issue_tags": tags,
            "issue_tag_sources": evidence,
            "inferred_from_social": inferred,
            "enrichment_confidence": confidence,
            "ai_generated_at": now_iso,
            "enrichment_version": CURRENT_VERSION,
        }
    ).eq("candidate_id", target.candidate_id).execute()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def enrich_candidates(backend_name: str = "lmstudio") -> dict[str, int]:
    backend = make_backend(backend_name)
    supabase = get_client()
    targets = fetch_targets(supabase)
    log.info(f"Found {len(targets)} candidates needing enrichment")

    processed = 0
    errors = 0
    skipped = 0

    for i, target in enumerate(targets):
        if i > 0:
            backend.sleep_between_calls()

        prompt = build_user_prompt(target)
        try:
            raw = backend.call(prompt)
        except Exception as exc:
            log.error(f"AI API error for {target.full_name}: {exc}")
            errors += 1
            continue

        parsed = parse_response(raw)
        if parsed is None:
            log.warning(f"Skipping {target.full_name} — could not parse model response")
            skipped += 1
            continue

        try:
            persist_result(supabase, target, parsed)
        except Exception as exc:
            log.error(f"DB write error for {target.full_name}: {exc}")
            errors += 1
            continue

        processed += 1
        tags = validate_tags(parsed.get("issue_tags") or [])
        confidence = parsed.get("confidence", "?")
        log.info(
            f"[{i+1}/{len(targets)}] Enriched {target.full_name} "
            f"— confidence={confidence}, tags={tags}"
        )

    supabase.table("pipeline_runs").insert(
        {
            "script_name": "enrich_candidates.py",
            "candidates_processed": processed,
            "errors": errors + skipped,
            "notes": f"backend={backend_name}",
        }
    ).execute()

    return {"processed": processed, "errors": errors, "skipped": skipped}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Enrich candidates with AI-generated summaries.")
    parser.add_argument(
        "--backend",
        choices=["lmstudio", "gemini", "openrouter"],
        default="lmstudio",
        help="AI backend to use (default: lmstudio)",
    )
    args = parser.parse_args()

    log.info(f"=== enrich_candidates.py  backend={args.backend} ===")
    try:
        result = enrich_candidates(backend_name=args.backend)
        log.info(f"Done. {result}")
        sys.exit(0)
    except Exception as exc:
        log.error(f"Fatal error: {exc}")
        raise
