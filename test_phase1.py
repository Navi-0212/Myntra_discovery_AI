"""
Comprehensive verification test suite for Phase 1: Core Scraper Resilience & State Checkpointing Subsystem.
Tests:
- Task 1.1: Streaming JsonlWriter (immediate flush, utf-8, context manager, write_many)
- Task 1.2: State Checkpointing (save_checkpoint, load_checkpoint, missing checkpoint handling)
- Task 1.3: Exponential Backoff with Jitter (@retry_with_backoff, async_retry_with_backoff)
- Task 1.4: Safe Timestamp Utilities (ISO-8601, RFC-2822, relative strings, cutoff dates)
"""

import json
import asyncio
from datetime import datetime, timezone, timedelta
from pathlib import Path

from scrapers.utils import (
    JsonlWriter,
    load_checkpoint,
    save_checkpoint,
    retry_with_backoff,
    async_retry_with_backoff,
    parse_datetime_safe,
    parse_relative_time,
    is_within_cutoff,
    get_cutoff_date,
    _backoff_delay,
)


def test_task_1_1_jsonl_writer():
    print("[Phase 1.1] Testing JsonlWriter...")
    filename = "phase1_test_stream.jsonl"
    target_path = Path("data/raw") / filename

    # Test context manager and single write
    with JsonlWriter(filename) as writer:
        writer.write({"id": 1, "text": "First stream record", "source": "test"})
        # Verify file exists and has content immediately after write (flushed)
        assert target_path.exists(), "Target file must exist immediately"
        with open(target_path, "r", encoding="utf-8") as f:
            lines = f.readlines()
            assert len(lines) == 1
            data = json.loads(lines[0])
            assert data["id"] == 1

    # Test append mode and write_many
    with JsonlWriter(filename) as writer:
        writer.write_many([
            {"id": 2, "text": "Second record", "source": "test"},
            {"id": 3, "text": "Third record", "source": "test"},
        ])

    with open(target_path, "r", encoding="utf-8") as f:
        lines = [json.loads(line) for line in f if line.strip()]
        assert len(lines) == 3
        assert [r["id"] for r in lines] == [1, 2, 3]

    # Cleanup
    if target_path.exists():
        target_path.unlink()
    print("  -> Task 1.1 JsonlWriter PASS")


def test_task_1_2_checkpointing():
    print("[Phase 1.2] Testing Checkpointing Mechanism...")
    chk_name = "phase1_test_chk"
    chk_file = Path("data/checkpoints") / f"{chk_name}.json"

    # Non-existent checkpoint returns empty dict
    if chk_file.exists():
        chk_file.unlink()
    assert load_checkpoint(chk_name) == {}

    # Save state dictionary (e.g. continuation token & page counts)
    state = {
        "in": {"last_completed_page": 5, "total_fetched": 250},
        "continuation_token": "token_abc_123",
        "processed_ids": ["vid1", "vid2"],
    }
    save_checkpoint(chk_name, state)

    # Load and verify integrity
    loaded = load_checkpoint(chk_name)
    assert loaded == state
    assert loaded["continuation_token"] == "token_abc_123"
    assert loaded["in"]["last_completed_page"] == 5

    # Overwrite update
    state["continuation_token"] = "token_xyz_456"
    save_checkpoint(chk_name, state)
    assert load_checkpoint(chk_name)["continuation_token"] == "token_xyz_456"

    # Cleanup
    if chk_file.exists():
        chk_file.unlink()
    print("  -> Task 1.2 Checkpointing PASS")


def test_task_1_3_backoff_decorators():
    print("[Phase 1.3] Testing Exponential Backoff & Jitter Decorators...")

    # Test jitter calculation bounds
    for attempt in range(5):
        delay = _backoff_delay(attempt, base_delay=1.0, max_delay=30.0)
        nominal = min(30.0, 1.0 * (2 ** attempt))
        assert 0.5 * nominal <= delay <= 1.5 * nominal

    # Test sync retry success after attempts
    attempts = 0

    @retry_with_backoff(max_retries=3, base_delay=0.01, max_delay=0.1)
    def flaky_func():
        nonlocal attempts
        attempts += 1
        if attempts < 3:
            raise ConnectionResetError("Temporary network glitch")
        return "success"

    res = flaky_func()
    assert res == "success"
    assert attempts == 3

    # Test async retry with backoff
    async_attempts = 0

    async def flaky_coro():
        nonlocal async_attempts
        async_attempts += 1
        if async_attempts < 2:
            raise RuntimeError("HTTP 429 Too Many Requests")
        return "async_success"

    async def run_async():
        return await async_retry_with_backoff(flaky_coro, max_retries=3, base_delay=0.01, max_delay=0.1)

    async_res = asyncio.run(run_async())
    assert async_res == "async_success"
    assert async_attempts == 2
    print("  -> Task 1.3 Backoff & Jitter PASS")


def test_task_1_4_date_utilities():
    print("[Phase 1.4] Testing Date & Timestamp Cutoff Utilities...")

    # ISO-8601 with Z and offsets
    dt_iso1 = parse_datetime_safe("2026-08-25T14:22:10Z")
    assert dt_iso1.tzinfo is not None
    assert dt_iso1.year == 2026

    dt_iso2 = parse_datetime_safe("2026-08-25T14:22:10+05:30")
    assert dt_iso2.tzinfo is not None

    # RFC-2822
    dt_rfc = parse_datetime_safe("Tue, 25 Aug 2026 14:22:10 GMT")
    assert dt_rfc.year == 2026 and dt_rfc.month == 8

    # UNIX timestamp
    dt_unix = parse_datetime_safe(1724595730)
    assert dt_unix is not None and dt_unix.tzinfo is not None

    # Relative time strings
    now_utc = datetime.now(timezone.utc)
    dt_rel_days = parse_relative_time("3 days ago")
    assert dt_rel_days is not None
    assert abs((now_utc - dt_rel_days).total_seconds() - (3 * 86400)) < 5

    dt_rel_months = parse_relative_time("6 months ago")
    assert dt_rel_months is not None
    assert 170 <= (now_utc - dt_rel_months).days <= 190

    # Cutoff evaluation
    cutoff_18m = get_cutoff_date(18)
    recent_date = now_utc - timedelta(days=60)
    old_date = now_utc - timedelta(days=700)

    assert is_within_cutoff(recent_date.isoformat(), cutoff_18m) is True
    assert is_within_cutoff(old_date.isoformat(), cutoff_18m) is False
    assert is_within_cutoff("unparseable garbage date string", cutoff_18m) is True  # Safe fallback

    print("  -> Task 1.4 Date Utilities PASS")


if __name__ == "__main__":
    test_task_1_1_jsonl_writer()
    test_task_1_2_checkpointing()
    test_task_1_3_backoff_decorators()
    test_task_1_4_date_utilities()
    print("\n=======================================================")
    print("PHASE 1 ALL COMPONENTS SUCCESSFULLY TESTED AND VERIFIED!")
    print("=======================================================")
