"""
App Store review scraper for Myntra.
Uses Apple's public customer-reviews RSS feed — no API key, no auth.
Feed: https://itunes.apple.com/{country}/rss/customerreviews/id={app_id}/sortBy=mostRecent/json

Ceiling: Apple hard-caps this feed at 10 pages (~500 reviews) per storefront.
Querying multiple countries increases total volume but each storefront still
caps out — see problem statement §3.2 for why this source cannot reach
anywhere near 100k on its own.
"""

import asyncio
from datetime import datetime, timezone

import aiohttp

from scrapers.utils import (
    JsonlWriter,
    load_checkpoint,
    save_checkpoint,
    async_retry_with_backoff,
    get_cutoff_date,
    is_within_cutoff,
    parse_datetime_safe,
    DEFAULT_MAX_MONTHS,
)

MYNTRA_APP_ID = "907394059"  # Myntra Official on the App Store
DEFAULT_COUNTRIES = [
    "in", "us", "gb", "ca", "au", "ae", "sg", "my", "sa", "nz",
    "de", "fr", "it", "es", "nl", "se", "no", "dk", "fi", "ie",
    "za", "kw", "qa", "bh", "om", "ph", "id", "th", "vn", "jp",
    "kr", "hk", "tw", "mx", "br", "ar", "cl", "co", "pt", "pl",
    "gr", "cz", "hu", "ro", "bg", "hr", "si", "sk", "ee", "lv",
    "lt", "cy", "mt", "lu", "be", "at", "ch", "tr", "il", "eg",
    "ng", "ke", "gh", "mu", "pk", "bd", "lk", "np", "mv"
]
MAX_PAGES_PER_COUNTRY = 10  # Apple's hard cap on this feed
CHECKPOINT_NAME = "app_store"
CONCURRENCY = 4


def _feed_url(app_id: str, country: str, page: int) -> str:
    return (
        f"https://itunes.apple.com/{country}/rss/customerreviews/"
        f"id={app_id}/sortBy=mostRecent/page={page}/json"
    )


async def _fetch_page(session: aiohttp.ClientSession, url: str) -> dict:
    async def _do_request():
        async with session.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=15) as resp:
            if resp.status in (429, 500, 502, 503, 504):
                raise RuntimeError(f"retryable status {resp.status} for {url}")
            resp.raise_for_status()
            return await resp.json(content_type=None)

    return await async_retry_with_backoff(_do_request, max_retries=4, base_delay=2.0)


def _entry_to_record(e: dict, country: str, url: str) -> dict:
    return {
        "source": "app_store",
        "source_id": e.get("id", {}).get("label"),
        "country": country,
        "rating": int(e.get("im:rating", {}).get("label", 0)),
        "title": e.get("title", {}).get("label", ""),
        "body": e.get("content", {}).get("label", ""),
        "author": e.get("author", {}).get("name", {}).get("label", ""),
        "app_version": e.get("im:version", {}).get("label", ""),
        "engagement_score": 0,  # App Store reviews carry no upvote/helpful count in this feed
        "created_at": e.get("updated", {}).get("label"),
        "url": url,
        "scraped_at": datetime.now(timezone.utc).isoformat(),
    }


async def _scrape_country(
    session: aiohttp.ClientSession,
    country: str,
    app_id: str,
    max_pages: int,
    writer: JsonlWriter,
    checkpoint: dict,
    cutoff_date: datetime,
) -> int:
    start_page = checkpoint.get(country, {}).get("last_completed_page", 0) + 1
    count = 0

    for page in range(start_page, max_pages + 1):
        url = _feed_url(app_id, country, page)
        try:
            data = await _fetch_page(session, url)
        except Exception as e:
            print(f"[app_store] giving up on {country} page {page} after retries: {e}")
            break

        entries = data.get("feed", {}).get("entry", [])
        entries = [e for e in entries if "im:rating" in e]
        if not entries:
            print(f"[app_store] {country}: no more reviews at page {page}, stopping")
            break

        # Filter entries within 18-month cutoff and check for early stopping (feed is newest first)
        valid_records = []
        hit_cutoff = False

        for e in entries:
            date_str = e.get("updated", {}).get("label")
            dt = parse_datetime_safe(date_str)
            if dt and dt < cutoff_date:
                hit_cutoff = True
                continue  # don't record entries older than cutoff
            valid_records.append(_entry_to_record(e, country, url))

        if valid_records:
            writer.write_many(valid_records)
            count += len(valid_records)

        checkpoint.setdefault(country, {})["last_completed_page"] = page
        save_checkpoint(CHECKPOINT_NAME, checkpoint)

        if hit_cutoff:
            print(f"[app_store] {country}: reached reviews older than {cutoff_date.date()} on page {page}, stopping")
            break

    return count


async def scrape_app_store_async(
    app_id: str = MYNTRA_APP_ID,
    countries: list[str] = None,
    max_pages: int = MAX_PAGES_PER_COUNTRY,
    months_back: int = DEFAULT_MAX_MONTHS,
) -> int:
    countries = countries or DEFAULT_COUNTRIES
    cutoff_date = get_cutoff_date(months_back)
    checkpoint = load_checkpoint(CHECKPOINT_NAME)
    total = 0

    print(f"[app_store] scraping reviews from past {months_back} months (since {cutoff_date.date()})")

    with JsonlWriter("app_store_reviews.jsonl") as writer:
        connector = aiohttp.TCPConnector(limit=CONCURRENCY)
        async with aiohttp.ClientSession(connector=connector) as session:
            # Countries run concurrently; pages within a country run sequentially
            # (checkpointing per-page requires knowing which page you're on).
            results = await asyncio.gather(*[
                _scrape_country(session, c, app_id, max_pages, writer, checkpoint, cutoff_date)
                for c in countries
            ])
            total = sum(results)

    print(f"[app_store] fetched {total} new reviews across {countries}")
    return total


def fetch_app_store_reviews(
    app_id: str = MYNTRA_APP_ID,
    countries: list[str] = None,
    max_pages: int = MAX_PAGES_PER_COUNTRY,
    months_back: int = DEFAULT_MAX_MONTHS,
) -> int:
    """Sync entrypoint for run_pipeline.py. Returns count of new records
    written to data/raw/app_store_reviews.jsonl."""
    return asyncio.run(scrape_app_store_async(app_id, countries, max_pages, months_back))


if __name__ == "__main__":
    fetch_app_store_reviews()
