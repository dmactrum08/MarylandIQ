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

import requests
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
CURRENT_VERSION = 3

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
    "You are a factual researcher for a nonpartisan voter information platform. "
    "Extract and organize information only from the provided sources — never invent "
    "quotes, positions, or facts. Use the candidate's own language wherever possible. "
    "Distinguish clearly between what the candidate says about themselves and what "
    "external sources (news, others) say about them. "
    "If a section has no source material, return null for that field. "
    "Always return valid JSON with no markdown fences or preamble."
)


# ---------------------------------------------------------------------------
# Backend abstraction
# ---------------------------------------------------------------------------

class AIBackend(Protocol):
    def call(self, prompt: str, system_prompt: Optional[str] = None) -> str: ...
    def sleep_between_calls(self) -> None: ...


class LMStudioBackend:
    def __init__(self) -> None:
        from openai import OpenAI
        model = os.environ.get("LM_STUDIO_MODEL", "local-model")
        self._model = model
        self._client = OpenAI(base_url=LM_STUDIO_BASE_URL, api_key="lm-studio")
        log.info(f"Backend: LM Studio  model={model}  url={LM_STUDIO_BASE_URL}")

    def call(self, prompt: str, system_prompt: Optional[str] = None) -> str:
        response = self._client.chat.completions.create(
            model=self._model,
            messages=[
                {"role": "system", "content": system_prompt or SYSTEM_PROMPT},
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
        model = os.environ.get("OPENROUTER_MODEL", "openrouter/elephant-alpha")
        self._model = model
        self._client = OpenAI(base_url=OPENROUTER_BASE_URL, api_key=api_key)
        log.info(f"Backend: OpenRouter  model={model}")

    def call(self, prompt: str, system_prompt: Optional[str] = None) -> str:
        response = self._client.chat.completions.create(
            model=self._model,
            messages=[
                {"role": "system", "content": system_prompt or SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            temperature=0.2,
        )
        if not response.choices:
            log.warning("OpenRouter returned empty choices. Full response: %s", response)
            raise ValueError(f"OpenRouter model {self._model!r} returned empty choices")
        content = response.choices[0].message.content
        if content is None:
            log.warning("OpenRouter returned null content. Full response: %s", response)
            raise ValueError(f"OpenRouter model {self._model!r} returned null content")
        return content

    def sleep_between_calls(self) -> None:
        time.sleep(1)  # light throttle; adjust if hitting rate limits


class ClaudeBackend:
    def __init__(self) -> None:
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            log.error("ANTHROPIC_API_KEY not set in .env")
            sys.exit(1)
        model = os.environ.get("CLAUDE_MODEL", "claude-sonnet-4-6")
        self._model = model
        self._api_key = api_key
        log.info(f"Backend: Claude  model={model}")

    def call(self, prompt: str, system_prompt: Optional[str] = None) -> str:
        import anthropic
        client = anthropic.Anthropic(api_key=self._api_key)
        message = client.messages.create(
            model=self._model,
            max_tokens=2048,
            system=system_prompt or SYSTEM_PROMPT,
            messages=[{"role": "user", "content": prompt}],
        )
        return message.content[0].text

    def sleep_between_calls(self) -> None:
        time.sleep(0.5)


class ChatGPTBackend:
    def __init__(self) -> None:
        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            log.error("OPENAI_API_KEY not set in .env")
            sys.exit(1)
        model = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")
        self._model = model
        self._api_key = api_key
        log.info(f"Backend: ChatGPT  model={model}")

    def call(self, prompt: str, system_prompt: Optional[str] = None) -> str:
        from openai import OpenAI
        client = OpenAI(api_key=self._api_key)
        response = client.chat.completions.create(
            model=self._model,
            messages=[
                {"role": "system", "content": system_prompt or SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            temperature=0.2,
        )
        return response.choices[0].message.content

    def sleep_between_calls(self) -> None:
        time.sleep(0.5)


class QwenBackend:
    def __init__(self) -> None:
        api_key = os.environ.get("DASHSCOPE_API_KEY")
        if not api_key:
            log.error("DASHSCOPE_API_KEY not set in .env")
            sys.exit(1)
        model = os.environ.get("QWEN_MODEL", "qwen-plus")
        self._model = model
        self._api_key = api_key
        log.info(f"Backend: Qwen  model={model}")

    def call(self, prompt: str, system_prompt: Optional[str] = None) -> str:
        from openai import OpenAI
        client = OpenAI(
            api_key=self._api_key,
            base_url="https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
        )
        response = client.chat.completions.create(
            model=self._model,
            messages=[
                {"role": "system", "content": system_prompt or SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            temperature=0.2,
        )
        if not response.choices:
            raise ValueError(f"Qwen model {self._model!r} returned empty choices")
        content = response.choices[0].message.content
        if content is None:
            raise ValueError(f"Qwen model {self._model!r} returned null content")
        return content

    def sleep_between_calls(self) -> None:
        time.sleep(0.5)


class GeminiBackend:
    def __init__(self) -> None:
        import google.generativeai as genai
        api_key = os.environ.get("GOOGLE_AI_STUDIO_API_KEY")
        if not api_key:
            log.error("GOOGLE_AI_STUDIO_API_KEY not set")
            sys.exit(1)
        genai.configure(api_key=api_key)
        self._model = genai.GenerativeModel(
            model_name="gemma-4-31b-it",
            system_instruction=SYSTEM_PROMPT,
        )
        log.info("Backend: Gemini  model=gemma-4-31b-it")

    def call(self, prompt: str, system_prompt: Optional[str] = None) -> str:
        if system_prompt and system_prompt != SYSTEM_PROMPT:
            import google.generativeai as genai
            model = genai.GenerativeModel(
                model_name="gemma-4-31b-it",
                system_instruction=system_prompt,
            )
            response = model.generate_content(prompt)
            return response.text

        response = self._model.generate_content(prompt)
        return response.text

    def sleep_between_calls(self) -> None:
        time.sleep(GEMINI_RATE_LIMIT_SLEEP)


def make_backend(name: str) -> AIBackend:
    if name == "gemini":
        return GeminiBackend()
    if name == "openrouter":
        return OpenRouterBackend()
    if name == "claude":
        return ClaudeBackend()
    if name == "chatgpt":
        return ChatGPTBackend()
    if name == "qwen":
        return QwenBackend()
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
    scraped_news_text: Optional[str]
    news_article_urls: list


# ---------------------------------------------------------------------------
# Prompt building
# ---------------------------------------------------------------------------

def _truncate(text: str, max_chars: int) -> str:
    """Trim text to max_chars, appending a note if cut."""
    if len(text) <= max_chars:
        return text
    return text[:max_chars] + "\n[...truncated]"


MAX_WEBSITE_CHARS = 30000
MAX_SOCIAL_CHARS = 30000
MAX_NEWS_CHARS = 12000


def build_user_prompt(target: EnrichmentTarget) -> str:
    sources: list[str] = []
    if target.campaign_website_url:
        sources.append(target.campaign_website_url)
    for url in (target.news_article_urls or []):
        sources.append(url)

    source_line = ", ".join(sources) if sources else "none"
    website_text = _truncate(target.scraped_website_text or "none", MAX_WEBSITE_CHARS)
    social_text = _truncate(target.social_inference_text or "none", MAX_SOCIAL_CHARS)
    article_block = _truncate(target.scraped_news_text or "none", MAX_NEWS_CHARS)

    approved_tags = ", ".join(APPROVED_ISSUE_TAGS)

    return (
        f"Candidate: {target.full_name}\n"
        f"Office seeking: {target.office_name}, {target.jurisdiction}\n"
        f"Sources provided: {source_line}\n\n"
        f"---- CAMPAIGN WEBSITE & SOCIAL MEDIA (candidate's own words) ----\n"
        f"{website_text}\n\n"
        f"[Social]\n{social_text}\n\n"
        f"---- NEWS ARTICLES & EXTERNAL COVERAGE ----\n"
        f"{article_block}\n\n"
        f"----\n\n"
        f"Using only the source material above, return JSON with these fields:\n"
        f'{{\n'
        f'  "summary": "A full-paragraph narrative (4-8 sentences) covering who this candidate is, their background, and what they stand for. Write in third person. Use as much detail as the sources allow. null if no information.",\n'
        f'  "campaign_voice": "3-6 direct quotes or close paraphrases of the most revealing things the candidate has said in their own words — from the website or social media only. Preserve their language. Separate each with a blank line. null if no website or social content.",\n'
        f'  "news_summary": "2-4 sentences summarizing what external sources (news articles, others) say about this candidate — their record, background, endorsements, or controversies. null if no article content.",\n'
        f'  "policy_priorities": [\n'
        f'    {{"priority": "issue name", "description": "what they specifically say about it", "source_snippet": "direct quote or close paraphrase"}}\n'
        f'  ],\n'
        f'  "issue_tags": ["approved tags only — choose from: {approved_tags}"],\n'
        f'  "issue_tag_evidence": [{{"tag": "...", "quote_snippet": "...", "source_url": "..."}}],\n'
        f'  "inferred_from_social": false,\n'
        f'  "confidence": "high | medium | low"\n'
        f"}}"
    )


# ---------------------------------------------------------------------------
# Response parsing
# ---------------------------------------------------------------------------

def parse_response(raw: str) -> Optional[dict]:
    """Extract and parse JSON from the model's response text.

    Tries progressively more aggressive extraction strategies so that
    partial or wrapped responses are not silently dropped.
    """
    # 1. Strip Qwen3 / reasoning model thinking blocks
    cleaned = re.sub(r"<think>.*?</think>", "", raw.strip(), flags=re.DOTALL)
    # 2. Strip markdown code fences
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned.strip(), flags=re.IGNORECASE)
    cleaned = re.sub(r"\s*```$", "", cleaned.strip())

    # Attempt 1: straight parse
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass

    # Attempt 2: find the first {...} block that spans the whole JSON object
    match = re.search(r"\{.*\}", cleaned, flags=re.DOTALL)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass

    # Attempt 3: the model sometimes emits trailing commas or comments —
    # strip them with a best-effort sanitiser then retry
    sanitised = re.sub(r",\s*([}\]])", r"\1", cleaned)   # trailing commas
    sanitised = re.sub(r"//[^\n]*", "", sanitised)        # // comments
    try:
        return json.loads(sanitised)
    except json.JSONDecodeError:
        pass

    # Attempt 4: same sanitisation on the extracted {...} block
    match2 = re.search(r"\{.*\}", sanitised, flags=re.DOTALL)
    if match2:
        try:
            return json.loads(match2.group())
        except json.JSONDecodeError:
            pass

    log.warning(f"JSON parse failed after all attempts — raw: {raw[:300]!r}")
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

def fetch_targets(supabase, force_name: Optional[str] = None) -> list[EnrichmentTarget]:
    """Return candidates that need enrichment (no AI output yet or stale version).

    If force_name is given, return that candidate regardless of enrichment status
    (case-insensitive substring match on full_name).
    """
    ENRICHMENT_COLS = (
        "candidate_id, scraped_website_text, social_inference_text, "
        "scraped_news_text, ai_generated_at, enrichment_version"
    )

    if force_name:
        # Find the candidate by name first
        cand_rows = (
            supabase.table("candidates")
            .select("id")
            .ilike("full_name", f"%{force_name}%")
            .execute()
            .data
        )
        if not cand_rows:
            log.warning(f"No candidate found matching {force_name!r}")
            return []
        forced_ids = [r["id"] for r in cand_rows]
        all_rows = (
            supabase.table("candidate_enrichment")
            .select(ENRICHMENT_COLS)
            .in_("candidate_id", forced_ids)
            .execute()
            .data
        )
    else:
        rows = (
            supabase.table("candidate_enrichment")
            .select(ENRICHMENT_COLS)
            .or_(f"ai_generated_at.is.null,enrichment_version.lt.{CURRENT_VERSION}")
            .not_.is_("scraped_website_text", "null")
            .execute()
            .data
        )

        # Also include rows where only social_inference_text is set
        rows_social = (
            supabase.table("candidate_enrichment")
            .select(ENRICHMENT_COLS)
            .or_(f"ai_generated_at.is.null,enrichment_version.lt.{CURRENT_VERSION}")
            .is_("scraped_website_text", "null")
            .not_.is_("social_inference_text", "null")
            .execute()
            .data
        )

        # Also include rows that have scraped_news_text but no website or social text
        rows_articles = (
            supabase.table("candidate_enrichment")
            .select(ENRICHMENT_COLS)
            .or_(f"ai_generated_at.is.null,enrichment_version.lt.{CURRENT_VERSION}")
            .is_("scraped_website_text", "null")
            .is_("social_inference_text", "null")
            .not_.is_("scraped_news_text", "null")
            .execute()
            .data
        )

        all_rows = rows + rows_social + rows_articles

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
                "id, full_name, campaign_website_url, news_article_urls, "
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
                scraped_news_text=enrichment.get("scraped_news_text"),
                news_article_urls=cand.get("news_article_urls") or [],
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

    campaign_voice = parsed.get("campaign_voice")
    if not isinstance(campaign_voice, str):
        campaign_voice = None

    news_summary = parsed.get("news_summary")
    if not isinstance(news_summary, str):
        news_summary = None

    policy_priorities = parsed.get("policy_priorities") or []
    if not isinstance(policy_priorities, list):
        policy_priorities = []

    inferred = bool(parsed.get("inferred_from_social", False))
    confidence = parsed.get("confidence")
    if confidence not in ("high", "medium", "low"):
        confidence = "low"

    supabase.table("candidate_enrichment").update(
        {
            "ai_summary": summary,
            "campaign_voice": campaign_voice,
            "news_summary": news_summary,
            "policy_priorities": policy_priorities,
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

def enrich_candidates(backend_name: str = "lmstudio", candidate_filter: Optional[str] = None) -> dict[str, int]:
    backend = make_backend(backend_name)
    supabase = get_client()
    targets = fetch_targets(supabase, force_name=candidate_filter)
    if candidate_filter:
        log.info(f"Targeting candidate matching {candidate_filter!r} ({len(targets)} found)")
    else:
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
        choices=["lmstudio", "gemini", "openrouter", "claude", "chatgpt", "qwen"],
        default="lmstudio",
        help="AI backend to use (default: lmstudio)",
    )
    parser.add_argument(
        "--candidate",
        metavar="NAME",
        default=None,
        help="Enrich a single candidate by name (case-insensitive substring match). "
             "Ignores whether they have already been enriched. Example: --candidate lukas",
    )
    args = parser.parse_args()

    log.info(f"=== enrich_candidates.py  backend={args.backend} ===")
    try:
        result = enrich_candidates(backend_name=args.backend, candidate_filter=args.candidate)
        log.info(f"Done. {result}")
        sys.exit(0)
    except Exception as exc:
        log.error(f"Fatal error: {exc}")
        raise
