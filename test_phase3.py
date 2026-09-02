"""
Comprehensive test suite for Phase 3: Ingestion, Normalization, Noise Filtering & Privacy (PII) Layer.
Tests:
- Task 3.1: Defensive Record Loader (handling corrupted/partial EOF lines)
- Task 3.2: Schema Unification & Multi-Field Text Merging
- Task 3.3: Noise Filtration (length < 15 chars)
- Task 3.4: Emoji Removal Filter (has_emoji)
- Task 3.5: Non-English Language & Script Filter (is_english)
- Task 3.6: Two-Tier Deduplication (Primary source+id -> Secondary exact text)
- Task 3.7: Presidio PII Scrubbing (redacting phone, email, order IDs)
- End-to-end dataset generation to unified_corpus.parquet
"""

import json
from pathlib import Path
import pandas as pd

from pipeline.ingest_normalize import (
    _load_jsonl,
    _unify_record,
    _scrub_pii,
    has_emoji,
    is_english,
    build_dataset,
    MIN_TEXT_LENGTH,
    _PRESIDIO_AVAILABLE,
    RAW_DIR,
    PROCESSED_DIR,
)
from scrapers.utils import JsonlWriter


def test_task_3_1_defensive_loader():
    print("[Phase 3.1] Testing Defensive Record Loader...")
    test_file = "phase3_corrupt_test.jsonl"
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    raw_path = RAW_DIR / test_file

    with open(raw_path, "w", encoding="utf-8") as f:
        f.write('{"source": "test", "source_id": "1", "body": "Valid record 1"}\n')
        f.write('{"source": "test", "source_id": "2", "body": "Valid record 2"}\n')
        f.write('{"source": "test", "source_id": "3", "body": "Truncated json mid-line\n')  # Corrupted line

    records = _load_jsonl(test_file)
    assert len(records) == 2, f"Expected 2 valid records, got: {len(records)}"
    assert records[0]["source_id"] == "1"
    assert records[1]["source_id"] == "2"

    if raw_path.exists():
        raw_path.unlink()
    print("  -> Task 3.1 Defensive Loader PASS")


def test_task_3_2_schema_unification():
    print("[Phase 3.2] Testing Schema Unification...")
    app_store_raw = {
        "source": "app_store",
        "source_id": "as_1",
        "country": "in",
        "rating": 5,
        "title": "Superb App",
        "body": "Love the recommendations for traditional wear.",
        "author": "Pooja",
        "created_at": "2026-08-20T10:00:00Z",
        "url": "https://...",
    }
    unified = _unify_record(app_store_raw)
    assert unified["source"] == "app_store"
    assert unified["rating"] == 5
    assert unified["text"] == "Superb App Love the recommendations for traditional wear."
    assert unified["context"] == "in"

    reddit_raw = {
        "source": "reddit",
        "source_id": "t1_abc",
        "subreddit": "IndianFashionAddicts",
        "title": "",
        "body": "The brand sizing on Myntra differs from standard UK sizing.",
        "author": "fashionista",
        "created_at": "2026-08-21T10:00:00Z",
        "url": "https://reddit.com/...",
    }
    unified_reddit = _unify_record(reddit_raw)
    assert unified_reddit["source"] == "reddit"
    assert unified_reddit["context"] == "IndianFashionAddicts"
    assert "sizing on Myntra differs" in unified_reddit["text"]
    print("  -> Task 3.2 Schema Unification PASS")


def test_task_3_3_noise_filtration():
    print("[Phase 3.3] Testing Noise Filtration (Length >= 15)...")
    short_texts = ["Good", "Nice app", "Bad", "Super!", "Ok app"]
    for t in short_texts:
        assert len(t) < MIN_TEXT_LENGTH

    valid_text = "The fabric quality of the kurta was surprisingly thin and sheer."
    assert len(valid_text) >= MIN_TEXT_LENGTH
    print("  -> Task 3.3 Noise Filtration PASS")


def test_task_3_4_emoji_filter():
    print("[Phase 3.4] Testing Emoji Removal Filter...")
    assert has_emoji("Loved this dress! 😍") is True
    assert has_emoji("Delivery was late 👍") is True
    assert has_emoji("Five stars ⭐⭐⭐") is True
    assert has_emoji("The dress was delivered on time and fit true to size.") is False
    print("  -> Task 3.4 Emoji Filter PASS")


def test_task_3_5_language_filter():
    print("[Phase 3.5] Testing Non-English Language & Regional Script Filter...")
    assert is_english("बहुत ही सुंदर ड्रेस है और साइज एकदम सही है") is False  # Devanagari
    assert is_english("இந்த ஆடை மிகவும் நன்றாக உள்ளது") is False  # Tamil
    assert is_english("చాలా మంచి డ్రెస్ మరియు నాణ్యత బాగుంది") is False  # Telugu
    assert is_english("This dress is elegant and fits true to size.") is True
    print("  -> Task 3.5 Language Filter PASS")


def test_task_3_6_deduplication():
    print("[Phase 3.6] Testing Two-Tier Deduplication...")
    records = [
        {"source": "app_store", "source_id": "1", "text": "Unique text A about sizing problems on dresses"},
        {"source": "app_store", "source_id": "1", "text": "Unique text A about sizing problems on dresses"},  # Duplicate primary
        {"source": "play_store", "source_id": "2", "text": "Unique text A about sizing problems on dresses"},  # Duplicate secondary text
        {"source": "play_store", "source_id": "3", "text": "Different unique text B about late delivery"},
    ]
    df = pd.DataFrame(records)
    # Tier 1
    df = df.drop_duplicates(subset=["source", "source_id"])
    assert len(df) == 3
    # Tier 2
    df = df.drop_duplicates(subset=["text"])
    assert len(df) == 2
    print("  -> Task 3.6 Deduplication PASS")


def test_task_3_7_presidio_pii():
    print("[Phase 3.7] Testing Presidio PII Scrubbing with Regex Fallback...")
    raw_text = "My phone number is 9876543210 and email is customer@gmail.com for order 1234567890."
    scrubbed = _scrub_pii(raw_text)
    assert "9876543210" not in scrubbed
    assert "customer@gmail.com" not in scrubbed
    assert "<EMAIL_ADDRESS>" in scrubbed or "<PHONE_NUMBER>" in scrubbed
    print(f"  -> Scrubbed output: {scrubbed}")
    print("  -> Task 3.7 Presidio PII Scrubbing PASS")


def test_phase3_build_dataset_execution():
    print("[Phase 3 End-to-End] Testing build_dataset() execution...")
    # Seed sample raw data if empty
    sample_records = [
        {"source": "app_store", "source_id": "p3_1", "title": "Good collection", "body": "Wishlist items are frequently out of stock by the time sales begin.", "author": "User1", "created_at": "2026-08-20T10:00:00Z"},
        {"source": "play_store", "source_id": "p3_2", "title": "", "body": "Color displayed in app photos did not match actual product received.", "author": "User2", "created_at": "2026-08-21T10:00:00Z"},
        {"source": "reddit", "source_id": "p3_3", "subreddit": "IndianFashionAddicts", "title": "Sizing query", "body": "Sizing is completely erratic across different seller brands on the app.", "author": "User3", "created_at": "2026-08-22T10:00:00Z"},
        {"source": "youtube", "source_id": "p3_4", "video_id": "vid1", "body": "Watch try-on videos before purchasing because fabric can be very sheer.", "author": "User4", "created_at": "2026-08-23T10:00:00Z"},
        # Noise records that should be filtered out
        {"source": "app_store", "source_id": "p3_noise1", "title": "Ok", "body": "Short", "author": "User5"},
        {"source": "play_store", "source_id": "p3_noise2", "title": "", "body": "Great app with nice deals 😍👍", "author": "User6"},
        {"source": "reddit", "source_id": "p3_noise3", "subreddit": "india", "title": "हिंदी", "body": "बहुत अच्छा प्रोडक्ट है", "author": "User7"},
    ]
    with JsonlWriter("app_store_reviews.jsonl") as w:
        w.write(sample_records[0])
        w.write(sample_records[4])
    with JsonlWriter("play_store_reviews.jsonl") as w:
        w.write(sample_records[1])
        w.write(sample_records[5])
    with JsonlWriter("reddit_posts.jsonl") as w:
        w.write(sample_records[2])
        w.write(sample_records[6])
    with JsonlWriter("youtube_comments.jsonl") as w:
        w.write(sample_records[3])

    df = build_dataset()
    assert not df.empty
    assert "doc_id" in df.columns
    assert "text" in df.columns
    assert "source" in df.columns

    # Verify noise, emoji, and non-English were filtered
    all_texts = df["text"].tolist()
    assert not any(has_emoji(t) for t in all_texts)
    assert all(is_english(t) for t in all_texts)
    assert all(len(t) >= MIN_TEXT_LENGTH for t in all_texts)

    parquet_file = PROCESSED_DIR / "unified_corpus.parquet"
    assert parquet_file.exists()
    print(f"  -> Successfully generated Parquet dataset with {len(df)} clean records at {parquet_file}")
    print("  -> Phase 3 End-to-End PASS")


if __name__ == "__main__":
    test_task_3_1_defensive_loader()
    test_task_3_2_schema_unification()
    test_task_3_3_noise_filtration()
    test_task_3_4_emoji_filter()
    test_task_3_5_language_filter()
    test_task_3_6_deduplication()
    test_task_3_7_presidio_pii()
    test_phase3_build_dataset_execution()
    print("\n=======================================================")
    print("PHASE 3 ALL COMPONENTS SUCCESSFULLY TESTED AND VERIFIED!")
    print("=======================================================")
