"""
For each HDBSCAN cluster, samples representative documents, asks an LLM to
name the theme and answer the discovery-engine's research questions against
that cluster specifically, then validates every quoted phrase actually
appears verbatim in the source documents (Imppulse's "Grounded Quote
Validator" pattern) — rejects/re-prompts on hallucinated quotes instead of
shipping them into the report.
"""

import os
import json
import re
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Optional
import pandas as pd

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

PROJECT_ROOT = Path(__file__).resolve().parent.parent
PROCESSED_DIR = PROJECT_ROOT / "data" / "processed"
SAMPLES_PER_CLUSTER = 20
MAX_RETRIES_ON_UNGROUNDED = 2

RESEARCH_QUESTIONS = """
1. Wishlist Intent: Why do users add fashion products to their wishlist?
2. Purchase Blockers: What prevents wishlisted products from eventually being purchased?
3. Post-Shortlisting Uncertainty: What uncertainties remain after users identify a product they like?
4. Postponement Drivers: What causes users to postpone or abandon a purchase?
5. Comparison Behaviors: How do users compare multiple shortlisted products?
6. External Information Search: What information or validation do users seek outside Myntra before buying?
7. Decision Dimensions: What roles do fit, size, styling, fabric/quality, price, reviews, and occasion play?
8. Intent vs Bookmarking: Is the wishlist acting as genuine purchase intent versus aspirational bookmarking?
9. User Segment Differences: What segment signals are visible (e.g. price-sensitive, occasion shoppers)?
10. Cross-Channel Unmet Needs: What unmet product or shopping experience needs emerge?
""".strip()

THEME_PROMPT_TEMPLATE = """You are a product researcher analyzing user feedback about Myntra
(an Indian online fashion e-commerce app) to understand wishlist-to-purchase behavior.

Below are {n} verbatim user comments/reviews that an unsupervised clustering algorithm
grouped together as topically similar. Analyze ONLY what these quotes actually say.

Research questions to address, but only where the cluster provides evidence:
{questions}

Comments:
{quotes_block}

Return ONLY valid JSON matching this schema, no markdown fences, no preamble:
{{
  "theme_label": "short theme name, 3-6 words",
  "theme_summary": "2-3 sentence summary of what this cluster reveals",
  "research_question_answers": {{"<question text>": "<answer grounded in the quotes, or 'no evidence in this cluster'>"}},
  "supporting_quotes": ["<verbatim substring copied exactly from one of the comments above>", "..."],
  "user_segment_signal": "any segment pattern visible (e.g. price-sensitive, occasion shoppers, size-anxious) or 'none visible'"
}}

Include 2-4 supporting_quotes. Each MUST be an exact verbatim substring of one of the
comments above — do not paraphrase, do not combine multiple comments into one quote.
"""


# Native structured-output schema (Gemini response_schema). Using this
# instead of prompting for JSON and regex-stripping fences removes most
# parse-failure retries — matters once this runs across dozens of clusters
# instead of a handful during testing.
THEME_RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "theme_label": {"type": "string"},
        "theme_summary": {"type": "string"},
        "research_question_answers": {
            "type": "object",
            "additionalProperties": {"type": "string"},
        },
        "supporting_quotes": {"type": "array", "items": {"type": "string"}},
        "user_segment_signal": {"type": "string"},
    },
    "required": [
        "theme_label", "theme_summary", "research_question_answers",
        "supporting_quotes", "user_segment_signal",
    ],
}


def _call_gemini(prompt: str) -> str:
    import google.generativeai as genai
    genai.configure(api_key=os.environ["GEMINI_API_KEY"])
    model = genai.GenerativeModel(
        "gemini-1.5-flash",
        generation_config={
            "response_mime_type": "application/json",
            "response_schema": THEME_RESPONSE_SCHEMA,
        },
    )
    resp = model.generate_content(prompt)
    return resp.text


GROQ_MODELS = [
    "openai/gpt-oss-120b",
    "openai/gpt-oss-20b",
    "qwen/qwen3.8-27b",
    "qwen/qwen3.6-27b",
    "groq/compound",
]


def _call_groq(prompt: str) -> str:
    """Groq's OpenAI-compatible API supports response_format=json_object."""
    import time
    from groq import Groq
    client = Groq(api_key=os.environ["GROQ_API_KEY"])
    last_err = None
    for model_name in GROQ_MODELS:
        try:
            resp = client.chat.completions.create(
                model=model_name,
                messages=[{"role": "user", "content": prompt}],
                response_format={"type": "json_object"},
            )
            return resp.choices[0].message.content
        except Exception as e:
            last_err = e
            time.sleep(0.5)
            continue
    raise RuntimeError(f"All Groq models failed: {last_err}")


def _call_llm(prompt: str, provider: str = "gemini") -> str:
    if provider == "gemini":
        return _call_gemini(prompt)
    elif provider == "groq":
        return _call_groq(prompt)
    raise ValueError(f"unknown provider: {provider}")


def _parse_json_response(raw: str) -> dict:
    # Structured-output modes should return clean JSON directly, but strip
    # markdown fences defensively in case a provider/model ignores the mode.
    cleaned = re.sub(r"^```(json)?|```$", "", raw.strip(), flags=re.MULTILINE).strip()
    return json.loads(cleaned)


def _validate_grounded_quotes(result: dict, source_texts: list[str]) -> tuple[dict, list[str]]:
    """Returns (result_with_only_grounded_quotes, list_of_rejected_quotes)."""
    corpus_blob = "\n".join(source_texts).lower()
    grounded, rejected = [], []
    for q in result.get("supporting_quotes", []):
        if q.strip().lower() in corpus_blob:
            grounded.append(q)
        else:
            rejected.append(q)
    result["supporting_quotes"] = grounded
    return result, rejected


def extract_theme_for_cluster(
    cluster_texts: list[str],
    provider: str = "gemini",
    samples: int = SAMPLES_PER_CLUSTER,
) -> dict:
    sample = cluster_texts[:samples]
    quotes_block = "\n".join(f"- {t}" for t in sample)
    prompt = THEME_PROMPT_TEMPLATE.format(
        n=len(sample), questions=RESEARCH_QUESTIONS, quotes_block=quotes_block
    )

    # Default fallback if every attempt below fails to even parse — keeps
    # this cluster's failure visible in themes.json instead of crashing
    # the whole run partway through a long list of clusters.
    result = {
        "theme_label": "extraction failed",
        "theme_summary": "",
        "research_question_answers": {},
        "supporting_quotes": [],
        "user_segment_signal": "",
        "_warning": "LLM response could not be parsed as JSON after all retries",
    }

    for attempt in range(MAX_RETRIES_ON_UNGROUNDED + 1):
        raw = _call_llm(prompt, provider=provider)
        try:
            parsed = _parse_json_response(raw)
        except json.JSONDecodeError:
            continue  # retry
        result, rejected = _validate_grounded_quotes(parsed, sample)
        if not rejected:
            return result
        # tighten the prompt and retry once
        prompt += f"\n\nNOTE: These quotes were REJECTED as not verbatim: {rejected}. Only quote exact substrings."

    result["supporting_quotes"] = result.get("supporting_quotes", [])
    result.setdefault("_warning", "some quotes could not be grounded after retries")
    return result


def _process_single_cluster(cluster_id: int, texts: list[str], source_breakdown: dict, provider: str) -> dict:
    theme = extract_theme_for_cluster(texts, provider=provider)
    theme["cluster_id"] = int(cluster_id)
    theme["cluster_size"] = len(texts)
    theme["source_breakdown"] = source_breakdown
    return theme


def run_theme_extraction(
    df: Optional[pd.DataFrame] = None,
    provider: str = "gemini",
    max_clusters: Optional[int] = None,
    max_workers: int = 8,
) -> list[dict]:
    if df is None:
        df = pd.read_parquet(PROCESSED_DIR / "clustered_corpus.parquet")

    # Group clusters excluding noise points (-1)
    cluster_groups = [
        (cluster_id, group["text"].tolist(), group["source"].value_counts().to_dict())
        for cluster_id, group in df.groupby("cluster_id")
        if cluster_id != -1
    ]

    # Sort clusters by size descending (largest thematic clusters first)
    cluster_groups.sort(key=lambda x: len(x[1]), reverse=True)

    if max_clusters is not None:
        cluster_groups = cluster_groups[:max_clusters]

    total_clusters = len(cluster_groups)
    print(f"[theme] extracting themes across {total_clusters} clusters (concurrency: {max_workers} threads, provider: {provider.upper()})...")

    themes = []
    completed_count = 0

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_to_cluster = {
            executor.submit(_process_single_cluster, cid, texts, s_breakdown, provider): cid
            for cid, texts, s_breakdown in cluster_groups
        }

        for future in as_completed(future_to_cluster):
            cid = future_to_cluster[future]
            completed_count += 1
            try:
                theme_res = future.result()
                themes.append(theme_res)
                quotes_count = len(theme_res.get("supporting_quotes", []))
                print(
                    f"[theme] [{completed_count}/{total_clusters}] Cluster {cid}: "
                    f"\"{theme_res.get('theme_label')}\" ({theme_res.get('cluster_size')} docs, {quotes_count} quotes)"
                )
            except Exception as e:
                print(f"[theme] [{completed_count}/{total_clusters}] ERROR in Cluster {cid}: {e}")

    # Re-sort themes by cluster size descending
    themes.sort(key=lambda t: t.get("cluster_size", 0), reverse=True)

    out_path = PROCESSED_DIR / "themes.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(themes, f, indent=2, ensure_ascii=False)
    print(f"[theme] successfully wrote {len(themes)} themes -> {out_path}")

    return themes


if __name__ == "__main__":
    run_theme_extraction()

