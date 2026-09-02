"""
Integration and component tests for the Myntra Wishlist Discovery Engine.
"""

import json
from datetime import datetime, timezone, timedelta
from pathlib import Path
import pandas as pd

from scrapers.utils import (
    JsonlWriter,
    load_checkpoint,
    save_checkpoint,
    parse_datetime_safe,
    parse_relative_time,
    is_within_cutoff,
    get_cutoff_date,
)
from pipeline.ingest_normalize import _unify_record, has_emoji, is_english, MIN_TEXT_LENGTH
from pipeline.theme_extraction import _validate_grounded_quotes


def test_emoji_and_language_filters():
    print("Testing Emoji and Language Filters...")
    # Emojis should be detected and filtered
    assert has_emoji("Loved this dress so much! 😍") is True
    assert has_emoji("Delivery was late and damaged ⭐") is True
    assert has_emoji("Five stars and good quality overall.") is False

    # Non-English scripts should be filtered
    assert is_english("बहुत अच्छा कुर्ता है, साइज परफेक्ट है") is False
    assert is_english("இந்த ஆப் மிகவும் நன்றாக உள்ளது") is False
    assert is_english("This kurta fits perfectly and the material is pure cotton.") is True
    print("  -> Emoji and Language Filters PASS")


def test_date_utilities():
    print("Testing date utilities...")
    # ISO-8601
    dt1 = parse_datetime_safe("2026-08-25T14:22:10Z")
    assert dt1 is not None and dt1.year == 2026, f"ISO parse failed: {dt1}"

    # RFC 2822
    dt2 = parse_datetime_safe("Tue, 25 Aug 2026 14:22:10 GMT")
    assert dt2 is not None and dt2.year == 2026, f"RFC 2822 parse failed: {dt2}"

    # Relative time
    dt3 = parse_relative_time("3 days ago")
    assert dt3 is not None, "Relative time '3 days ago' parse failed"

    # Cutoff check
    cutoff = get_cutoff_date(18)
    assert is_within_cutoff("2026-08-01T00:00:00Z", cutoff) is True
    assert is_within_cutoff("2020-01-01T00:00:00Z", cutoff) is False
    print("  -> Date utilities PASS")


def test_checkpoint_and_jsonl_writer():
    print("Testing Checkpoint and JsonlWriter...")
    save_checkpoint("test_chk", {"token": "xyz123", "count": 42})
    chk = load_checkpoint("test_chk")
    assert chk.get("token") == "xyz123", f"Checkpoint load failed: {chk}"
    assert chk.get("count") == 42

    writer = JsonlWriter("test_raw.jsonl")
    writer.write({"source": "test", "text": "sample text"})
    writer.close()

    raw_path = Path("data/raw/test_raw.jsonl")
    assert raw_path.exists(), "test_raw.jsonl not created"
    # Clean up test artifacts
    if raw_path.exists():
        raw_path.unlink()
    chk_path = Path("data/checkpoints/test_chk.json")
    if chk_path.exists():
        chk_path.unlink()
    print("  -> Checkpoint & JsonlWriter PASS")


def test_ingest_and_normalization():
    print("Testing Ingest & Normalization...")
    raw_record = {
        "source": "reddit",
        "source_id": "t1_abc",
        "subreddit": "IndianFashionAddicts",
        "title": "Myntra sizing issue",
        "body": "The kurta fits one size smaller than standard brand measurements.",
        "author": "fashion_user",
        "created_at": "2026-08-25T14:22:10Z",
        "url": "https://reddit.com/r/...",
    }
    unified = _unify_record(raw_record)
    assert unified["source"] == "reddit"
    assert unified["source_id"] == "t1_abc"
    assert "Myntra sizing issue" in unified["text"]
    assert "kurta fits one size smaller" in unified["text"]
    assert unified["context"] == "IndianFashionAddicts"
    print("  -> Ingest & Normalization PASS")


def test_grounded_quote_validator():
    print("Testing Grounded Quote Validator...")
    source_texts = [
        "Delivery was delayed by 4 days and the dress color was not accurate to the photo.",
        "Wishlisted 10 kurtas for Diwali sale but fabric quality reviews made me hesitate.",
    ]
    # Test case 1: exact quote
    result = {
        "supporting_quotes": [
            "Delivery was delayed by 4 days",
            "fabric quality reviews made me hesitate",
            "completely fabricated quote that was never in the source",
        ]
    }
    validated, rejected = _validate_grounded_quotes(result, source_texts)
    assert len(validated["supporting_quotes"]) == 2, f"Expected 2 valid quotes, got: {validated['supporting_quotes']}"
    assert len(rejected) == 1, f"Expected 1 rejected quote, got: {rejected}"
    assert rejected[0] == "completely fabricated quote that was never in the source"
    print("  -> Grounded Quote Validator PASS")


if __name__ == "__main__":
    test_emoji_and_language_filters()
    test_date_utilities()
    test_checkpoint_and_jsonl_writer()
    test_ingest_and_normalization()
    test_grounded_quote_validator()
    print("\nALL COMPONENT TESTS PASSED!")
