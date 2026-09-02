"""
Play Store review scraper for Myntra.
Uses `google-play-scraper` — scrapes the public Play Store review UI, no key.
pip install google-play-scraper

This is one of the two sources that can realistically carry volume toward a
100k target (see problem statement §3.2) — Myntra's Play Store listing has
a large review base and the library's continuation token lets you page
through most of it. The library itself is synchronous, so resilience here
comes from retry/backoff + checkpointing the continuation token, not from
concurrency.
"""

import time
from datetime import datetime, timezone

from google_play_scraper import Sort, reviews

from scrapers.utils import (
    JsonlWriter,
    load_checkpoint,
    save_checkpoint,
    retry_with_backoff,
    get_cutoff_date,
    is_within_cutoff,
    parse_datetime_safe,
    DEFAULT_MAX_MONTHS,
)

MYNTRA_PACKAGE = "com.myntra.android"
BATCH_SIZE = 200  # reviews fetched per call
DEFAULT_LANG = "en"
DEFAULT_COUNTRY = "in"
CHECKPOINT_NAME = "play_store"
SLEEP_BETWEEN_BATCHES = 1.0


@retry_with_backoff(max_retries=5, base_delay=2.0, max_delay=60.0)
def _fetch_batch(package_name: str, lang: str, country: str, continuation_token):
    return reviews(
        package_name,
        lang=lang,
        country=country,
        sort=Sort.NEWEST,
        count=BATCH_SIZE,
        continuation_token=continuation_token,
    )


def _review_to_record(r: dict, country: str) -> dict:
    created_at = r.get("at")
    return {
        "source": "play_store",
        "source_id": r.get("reviewId"),
        "country": country,
        "rating": r.get("score"),
        "title": "",
        "body": r.get("content", ""),
        "author": r.get("userName", ""),
        "app_version": r.get("appVersion", ""),
        "engagement_score": r.get("thumbsUpCount", 0),
        "created_at": created_at.isoformat() if hasattr(created_at, "isoformat") else str(created_at),
        "scraped_at": datetime.now(timezone.utc).isoformat(),
    }


def _serialize_token(token):
    if token is None:
        return None
    if isinstance(token, dict):
        return token
    if hasattr(token, "__slots__"):
        return {s: getattr(token, s) for s in token.__slots__}
    return getattr(token, "__dict__", None)


def _deserialize_token(data):
    if not data or not isinstance(data, dict):
        return None
    try:
        from google_play_scraper.features.reviews import _ContinuationToken
        return _ContinuationToken(**data)
    except Exception:
        return None


def fetch_play_store_reviews(
    package_name: str = MYNTRA_PACKAGE,
    lang: str = DEFAULT_LANG,
    country: str = DEFAULT_COUNTRY,
    max_batches: int = 500,  # safety ceiling: 500 * 200 = 100k reviews max per run
    months_back: int = DEFAULT_MAX_MONTHS,
) -> int:
    """Resumable: on restart, picks up from the last saved continuation
    token instead of re-fetching from the newest review again."""
    cutoff_date = get_cutoff_date(months_back)
    checkpoint = load_checkpoint(CHECKPOINT_NAME)
    state = checkpoint.get(country, {})
    raw_token = state.get("continuation_token")
    continuation_token = _deserialize_token(raw_token) if raw_token else None
    total_fetched = state.get("total_fetched", 0)
    batches_done = 0

    print(f"[play_store] scraping reviews from past {months_back} months (since {cutoff_date.date()})")

    with JsonlWriter("play_store_reviews.jsonl") as writer:
        while batches_done < max_batches:
            try:
                result, continuation_token = _fetch_batch(
                    package_name, lang, country, continuation_token
                )
            except Exception as e:
                print(f"[play_store] giving up after retries: {e}")
                break

            if not result:
                print(f"[play_store] no more reviews — exhausted at {total_fetched} total")
                break

            # Filter reviews within 18 months; Sort.NEWEST means we can stop at first old review
            valid_records = []
            hit_cutoff = False

            for r in result:
                dt = parse_datetime_safe(r.get("at"))
                if dt and dt < cutoff_date:
                    hit_cutoff = True
                    break
                valid_records.append(_review_to_record(r, country))

            if valid_records:
                writer.write_many(valid_records)
                total_fetched += len(valid_records)

            batches_done += 1

            checkpoint[country] = {
                "continuation_token": _serialize_token(continuation_token),
                "total_fetched": total_fetched,
            }
            save_checkpoint(CHECKPOINT_NAME, checkpoint)

            if batches_done % 10 == 0:
                print(f"[play_store] {total_fetched} reviews fetched so far ({batches_done} batches)")

            if hit_cutoff:
                print(f"[play_store] reached {months_back}-month cutoff ({cutoff_date.date()}), stopping at {total_fetched} reviews.")
                break

            time.sleep(SLEEP_BETWEEN_BATCHES)

            if continuation_token is None:
                print(f"[play_store] library reports no further pages — exhausted at {total_fetched}")
                break

    print(f"[play_store] run complete: {total_fetched} total reviews (this run: {batches_done} batches)")
    return total_fetched


if __name__ == "__main__":
    fetch_play_store_reviews()
