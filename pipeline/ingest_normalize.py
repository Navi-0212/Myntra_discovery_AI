"""
Normalizes raw scraper output (app_store, play_store, reddit, youtube) into
a single flat schema, deduplicates, drops noise, and scrubs PII.

Reads the incremental .jsonl files the scrapers now write (see
scrapers/utils.py:JsonlWriter) rather than a single accumulated .json —
this stage is what turns "N append-only files across 4 sources" into one
clean corpus, so it's also where dedup and normalization safely live
(scrapers themselves stay dumb and don't need to know about each other).

Reuses the Presidio PII-scrubbing pattern from Imppulse — review/comment
text sometimes contains emails, phone numbers, or order IDs users paste in
when venting, and those shouldn't flow into embeddings or LLM prompts.
"""

import json
from pathlib import Path
import pandas as pd

try:
    from presidio_analyzer import AnalyzerEngine
    from presidio_anonymizer import AnonymizerEngine
    _PRESIDIO_AVAILABLE = True
except ImportError:
    _PRESIDIO_AVAILABLE = False
    print("[ingest] presidio not installed — PII scrubbing disabled. "
          "pip install presidio-analyzer presidio-anonymizer to enable.")

PROJECT_ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = PROJECT_ROOT / "data" / "raw"
PROCESSED_DIR = PROJECT_ROOT / "data" / "processed"
MIN_TEXT_LENGTH = 15  # drop comments/reviews too short to carry a theme

RAW_FILES = [
    "app_store_reviews.jsonl",
    "play_store_reviews.jsonl",
    "reddit_posts.jsonl",
    "youtube_comments.jsonl",
]


import unicodedata
import re

EMOJI_PATTERN = re.compile(
    r"[\U00010000-\U0010ffff]"
    r"|[\u2600-\u27bf]"
    r"|[\u2300-\u23ff]"
    r"|[\u2b50\u2b55\u200d\ufe0f]"
    r"|[\u3030\u00a9\u00ae\u2122\u25a0-\u25ff]"
)

NON_ENGLISH_SCRIPT_REGEX = re.compile(
    r"[\u0900-\u097F"  # Devanagari (Hindi, Marathi, Sanskrit)
    r"\u0980-\u09FF"  # Bengali / Assamese
    r"\u0A00-\u0A7F"  # Gurmukhi (Punjabi)
    r"\u0A80-\u0AFF"  # Gujarati
    r"\u0B00-\u0B7F"  # Oriya
    r"\u0B80-\u0BFF"  # Tamil
    r"\u0C00-\u0C7F"  # Telugu
    r"\u0C80-\u0CFF"  # Kannada
    r"\u0D00-\u0D7F"  # Malayalam
    r"\u0600-\u06FF"  # Arabic / Urdu
    r"\u0400-\u04FF"  # Cyrillic
    r"\u4E00-\u9FFF"  # CJK Unified Ideographs
    r"\u3040-\u30FF"  # Japanese Hiragana / Katakana
    r"\uAC00-\uD7AF]" # Korean Hangul
)


def has_emoji(text: str) -> bool:
    """Returns True if the text contains any emoji or decorative pictograph symbol."""
    if not text:
        return False
    if EMOJI_PATTERN.search(text):
        return True
    for ch in text:
        cat = unicodedata.category(ch)
        if cat in ("So", "Sk"):
            return True
    return False


def is_english(text: str) -> bool:
    """Returns True if text is in English (uses Latin script and passes basic English heuristics)."""
    if not text or not isinstance(text, str):
        return False
    # Reject text containing non-English scripts (Devanagari, Tamil, Cyrillic, Arabic, CJK, etc.)
    if NON_ENGLISH_SCRIPT_REGEX.search(text):
        return False
    # Check alphabetic composition (must be predominantly basic ASCII Latin characters)
    letters = [c for c in text if c.isalpha()]
    if not letters:
        return False
    ascii_letters = [c for c in letters if ord(c) < 128]
    if (len(ascii_letters) / len(letters)) < 0.85:
        return False
    return True


def _load_jsonl(filename: str) -> list[dict]:
    path = RAW_DIR / filename
    if not path.exists():
        return []
    records = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                records.append(json.loads(line))
            except json.JSONDecodeError:
                continue  # a truncated last line from a killed run — skip, don't crash
    return records


def _unify_record(r: dict) -> dict:
    """Collapse source-specific fields into one flat schema."""
    text_parts = [r.get("title", ""), r.get("body", "")]
    text = " ".join(p for p in text_parts if p).strip()

    return {
        "source": r.get("source"),
        "source_id": r.get("source_id"),
        "text": text,
        "rating": r.get("rating"),  # app_store / play_store only
        "engagement_score": r.get("engagement_score", 0),
        "author": r.get("author", ""),
        "created_at": r.get("created_at", ""),
        "url": r.get("url", ""),
        "context": r.get("subreddit") or r.get("video_id") or r.get("country") or "",
    }


EMAIL_REGEX = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b")
PHONE_REGEX = re.compile(r"\b(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b|(?:\+?91[-\s]?)?[6-9]\d{9}\b")
ORDER_ID_REGEX = re.compile(r"\b(?:order|tracking|awb|id|ref)[\s#:]+([A-Za-z0-9_-]{6,20})\b", re.IGNORECASE)


def _regex_scrub_pii(text: str) -> str:
    """Regex-based fallback PII scrubber for emails, phone numbers, and order tracking numbers."""
    if not text:
        return text
    text = EMAIL_REGEX.sub("<EMAIL_ADDRESS>", text)
    text = PHONE_REGEX.sub("<PHONE_NUMBER>", text)
    text = ORDER_ID_REGEX.sub("<ORDER_ID>", text)
    return text


def _scrub_pii(text: str, analyzer=None, anonymizer=None) -> str:
    if not text:
        return text
    if analyzer and anonymizer:
        try:
            results = analyzer.analyze(text=text, language="en")
            return anonymizer.anonymize(text=text, analyzer_results=results).text
        except Exception:
            pass
    return _regex_scrub_pii(text)


def build_dataset() -> pd.DataFrame:
    raw = []
    for filename in RAW_FILES:
        records = _load_jsonl(filename)
        print(f"[ingest] loaded {len(records)} records from {filename}")
        raw.extend(records)
    print(f"[ingest] {len(raw)} raw records total")

    unified = [_unify_record(r) for r in raw]
    df = pd.DataFrame(unified)

    if df.empty:
        raise RuntimeError(
            "[ingest] no records found — run scrapers first, or check "
            "data/raw/*.jsonl actually contain data."
        )

    # 1. Drop empty / too-short text
    initial_count = len(df)
    df = df[df["text"].str.len() >= MIN_TEXT_LENGTH].copy()
    print(f"[ingest] length filter (>= {MIN_TEXT_LENGTH} chars): {initial_count} -> {len(df)} records")

    # 2. Filter out reviews with emojis
    before_emoji = len(df)
    df = df[~df["text"].apply(has_emoji)].copy()
    print(f"[ingest] emoji filter: removed {before_emoji - len(df)} records containing emojis ({len(df)} remaining)")

    # 3. Filter out reviews in another language (non-English)
    before_lang = len(df)
    df = df[df["text"].apply(is_english)].copy()
    print(f"[ingest] language filter: removed {before_lang - len(df)} non-English records ({len(df)} remaining)")

    if df.empty:
        raise RuntimeError("[ingest] all records were filtered out during length, emoji, or language filtering.")

    # 4. Dedupe on (source, source_id) first, then near-dupe on exact text match
    df = df.drop_duplicates(subset=["source", "source_id"])
    df = df.drop_duplicates(subset=["text"])
    print(f"[ingest] deduplicated: {len(df)} unique records")

    # 5. PII Scrubbing (Presidio Engine with automated regex fallback)
    analyzer, anonymizer = None, None
    if _PRESIDIO_AVAILABLE:
        try:
            analyzer = AnalyzerEngine()
            anonymizer = AnonymizerEngine()
        except Exception as e:
            print(f"[ingest] presidio engine initialization fallback to regex: {e}")

    df["text"] = df["text"].apply(lambda t: _scrub_pii(t, analyzer, anonymizer))

    # Ensure consistent data types for parquet serialization
    df["engagement_score"] = pd.to_numeric(df["engagement_score"], errors="coerce").fillna(0).astype("int64")
    df["rating"] = pd.to_numeric(df["rating"], errors="coerce")

    df = df.reset_index(drop=True)
    df["doc_id"] = df.index

    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    out_path = PROCESSED_DIR / "unified_corpus.parquet"
    df.to_parquet(out_path, index=False)
    print(f"[ingest] wrote {len(df)} normalized records -> {out_path}")

    return df


if __name__ == "__main__":
    build_dataset()
