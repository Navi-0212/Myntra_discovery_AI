"""
Shared scraping infrastructure so every source-specific scraper gets the
same resilience guarantees without duplicating the logic:

- Incremental append-only JSONL writes (never accumulate in memory)
- Checkpoint files so an interrupted run resumes instead of restarting
- Exponential backoff with jitter for both sync and async call sites
"""

import json
import time
import random
import re
import asyncio
import functools
import threading
from datetime import datetime, timezone, timedelta
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Callable, Any, Union

PROJECT_ROOT = Path(__file__).resolve().parent.parent
CHECKPOINT_DIR = PROJECT_ROOT / "data" / "checkpoints"
RAW_DIR = PROJECT_ROOT / "data" / "raw"

DEFAULT_MAX_MONTHS = 18


def get_cutoff_date(months: int = DEFAULT_MAX_MONTHS) -> datetime:
    """Returns timezone-aware UTC datetime for N months ago (approx 30.4375 days/month)."""
    return datetime.now(timezone.utc) - timedelta(days=int(months * 30.4375))


def parse_relative_time(text: str) -> datetime | None:
    """Parses relative time strings like '2 days ago', '5 months ago', '1 year ago', '2 years ago'."""
    if not text or not isinstance(text, str):
        return None
    text_clean = text.lower().strip()
    match = re.search(r"(\d+)\s+(second|minute|hour|day|week|month|year)", text_clean)
    if not match:
        return None
    val, unit = int(match.group(1)), match.group(2)
    now = datetime.now(timezone.utc)
    if "second" in unit:
        return now - timedelta(seconds=val)
    if "minute" in unit:
        return now - timedelta(minutes=val)
    if "hour" in unit:
        return now - timedelta(hours=val)
    if "day" in unit:
        return now - timedelta(days=val)
    if "week" in unit:
        return now - timedelta(weeks=val)
    if "month" in unit:
        return now - timedelta(days=int(val * 30.4375))
    if "year" in unit:
        return now - timedelta(days=int(val * 365.25))
    return None


def parse_datetime_safe(val: Any) -> datetime | None:
    """Robust parser for ISO-8601, RFC-2822, UNIX timestamp, relative strings, and datetime objects."""
    if val is None or val == "":
        return None
    if isinstance(val, datetime):
        return val if val.tzinfo else val.replace(tzinfo=timezone.utc)
    if isinstance(val, (int, float)):
        return datetime.fromtimestamp(val, tz=timezone.utc)
    if isinstance(val, str):
        val_str = val.strip()
        # Try ISO 8601 (e.g. 2026-08-25T14:22:10Z, 2026-08-25T14:22:10+05:30)
        try:
            dt = datetime.fromisoformat(val_str.replace("Z", "+00:00"))
            return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        except Exception:
            pass
        # Try RFC 2822 / RSS feed format (e.g. 'Tue, 25 Aug 2026 14:22:10 GMT')
        try:
            return parsedate_to_datetime(val_str)
        except Exception:
            pass
        # Try relative time
        rel = parse_relative_time(val_str)
        if rel is not None:
            return rel
    return None


def is_within_cutoff(val: Any, cutoff: datetime) -> bool:
    """Returns True if the date is >= cutoff. If date cannot be parsed, returns True to avoid false drops."""
    dt = parse_datetime_safe(val)
    if dt is None:
        return True
    return dt >= cutoff


class JsonlWriter:
    """Incremental append-only JSONL writer with thread safety and per-record flush."""

    def __init__(self, filename: str):
        RAW_DIR.mkdir(parents=True, exist_ok=True)
        self.path = RAW_DIR / filename
        self._fh = open(self.path, "a", encoding="utf-8")
        self._lock = threading.Lock()

    def write(self, record: dict):
        line = json.dumps(record, ensure_ascii=False) + "\n"
        with self._lock:
            self._fh.write(line)
            self._fh.flush()

    def write_many(self, records: list[dict]):
        if not records:
            return
        lines = "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in records)
        with self._lock:
            self._fh.write(lines)
            self._fh.flush()

    def close(self):
        with self._lock:
            if not self._fh.closed:
                self._fh.close()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()


def load_checkpoint(name: str) -> dict:
    CHECKPOINT_DIR.mkdir(parents=True, exist_ok=True)
    path = CHECKPOINT_DIR / f"{name}.json"
    if path.exists():
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}
    return {}


def save_checkpoint(name: str, data: dict):
    CHECKPOINT_DIR.mkdir(parents=True, exist_ok=True)
    path = CHECKPOINT_DIR / f"{name}.json"
    tmp_path = CHECKPOINT_DIR / f"{name}.tmp"
    try:
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
        tmp_path.replace(path)
    except Exception:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, default=str)


def _backoff_delay(attempt: int, base_delay: float, max_delay: float) -> float:
    delay = min(max_delay, base_delay * (2 ** attempt))
    return delay * (0.5 + random.random())  # jitter: 50%-150% of computed delay


def retry_with_backoff(
    max_retries: int = 5,
    base_delay: float = 1.0,
    max_delay: float = 60.0,
    retry_on: tuple = (Exception,),
):
    """Sync retry decorator with exponential backoff + jitter.
    Use on any blocking call (e.g. google-play-scraper, youtube-comment-downloader)."""

    def decorator(fn: Callable) -> Callable:
        @functools.wraps(fn)
        def wrapper(*args, **kwargs) -> Any:
            last_exc = None
            for attempt in range(max_retries + 1):
                try:
                    return fn(*args, **kwargs)
                except retry_on as e:
                    last_exc = e
                    if attempt == max_retries:
                        break
                    delay = _backoff_delay(attempt, base_delay, max_delay)
                    print(f"[retry] {fn.__name__} failed ({e}); retrying in {delay:.1f}s "
                          f"(attempt {attempt + 1}/{max_retries})")
                    time.sleep(delay)
            if last_exc is not None:
                raise last_exc
            raise RuntimeError(f"{fn.__name__} failed after {max_retries} retries without catching an exception")

        return wrapper

    return decorator


async def async_retry_with_backoff(
    coro_fn: Callable,
    *args,
    max_retries: int = 5,
    base_delay: float = 1.0,
    max_delay: float = 60.0,
    retry_status_codes: tuple = (429, 500, 502, 503, 504),
    **kwargs,
) -> Any:
    """Async retry with backoff. `coro_fn` should raise on failure or return
    a response-like object; pass a `status_check` kwarg-free callable pattern
    by having coro_fn itself raise for retryable statuses."""
    last_exc = None
    for attempt in range(max_retries + 1):
        try:
            return await coro_fn(*args, **kwargs)
        except Exception as e:
            last_exc = e
            if attempt == max_retries:
                break
            delay = _backoff_delay(attempt, base_delay, max_delay)
            print(f"[retry] async call failed ({e}); retrying in {delay:.1f}s "
                  f"(attempt {attempt + 1}/{max_retries})")
            await asyncio.sleep(delay)
    if last_exc is not None:
        raise last_exc
    raise RuntimeError(f"Async call failed after {max_retries} retries without catching an exception")

