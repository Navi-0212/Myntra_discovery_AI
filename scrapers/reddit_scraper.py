"""
Reddit scraper for Myntra / online fashion shopping discussions.

IMPORTANT: Reddit shut down unauthenticated .json endpoint access on
May 28-30, 2026 (no deprecation window — requests now return 403 across
the board). This scraper uses Reddit's .rss feeds instead, which were
never part of the priced/blocked surface and are still publicly reachable
as of this writing — same "append a suffix to any Reddit URL" pattern,
just .rss instead of .json. Same free, no-key design as the App Store
scraper's use of Apple's RSS feed.

Two modes:
1. PUBLIC (default, no credentials) — hits reddit.com's public .rss feeds.
   Still rate-limited, and RSS pagination is less reliable than the old
   .json 'after' cursor was — see problem statement §3.2: this source
   realistically tops out at low thousands regardless of engineering,
   because there isn't 100k Reddit content about Myntra wishlists to find.
2. AUTHENTICATED (optional upgrade) — PRAW with a client_id/secret from
   https://www.reddit.com/prefs/apps. Note Reddit closed self-service API
   *approval* in Nov 2025, so a new PRAW app may sit pending; RSS is the
   more reliable free path as of mid-2026.

KNOWN LIMITATION vs the old .json approach: Reddit's RSS feeds do not
expose vote/score data or comment counts. `engagement_score` and
`num_comments` will be None/0 for RSS-sourced records. This doesn't block
the discovery engine's actual use case (theme extraction from text), but
means Reddit records can't be ranked by popularity within a cluster the
way App/Play Store reviews can via their rating field.

Both modes checkpoint per (subreddit, search_term) pair so an interrupted
run resumes without re-querying pairs already completed.
"""

import os
import re
import html
import asyncio
from datetime import datetime, timezone

import aiohttp
import feedparser

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

SUBREDDITS = [
    "IndianFashionAddicts",
    "india",
    "IndianStreetwear",
    "TwoXIndia",
    "OneXIndia",
    "delhi",
    "mumbai",
    "bangalore",
    "hyderabad",
    "indiasocial",
    "IndianSkincareAddicts",
    "femalefashionadvice",
    "malefashionadvice",
    "InstaCelebsGossip",
    "shoppingaddiction",
    "DealsIndia",
]
SEARCH_TERMS = [
    "myntra",
    "myntra wishlist",
    "myntra return",
    "myntra sizing",
    "myntra sale",
    "myntra discount coupon",
    "myntra refund",
    "myntra haul",
    "myntra delivery scam",
    "myntra customer care",
    "myntra insider",
    "myntra exchange",
    "myntra shoes quality",
    "myntra clothes fabric",
]
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
}
CHECKPOINT_NAME = "reddit"
CONCURRENCY = 1  # Sequential requests avoid Reddit RSS 429 rate-limiting
REQUEST_DELAY = 1.0
MAX_PAGES_PER_QUERY = 4  # RSS pagination is undocumented/best-effort; stop after this many empty-progress pages
_TAG_RE = re.compile(r"<[^>]+>")


def _strip_html(raw: str) -> str:
    """RSS content fields are HTML — strip tags and unescape entities to get plain text."""
    if not raw:
        return ""
    text = _TAG_RE.sub(" ", raw)
    text = html.unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def _fullname_to_id(fullname: str) -> str:
    """Reddit RSS entry ids look like 'tag:reddit.com,2005:t3_abc123' — extract 'abc123'."""
    if not fullname:
        return ""
    match = re.search(r"(t[13]_[a-z0-9]+)$", fullname)
    return match.group(1) if match else fullname


def _author_from_entry(entry) -> str:
    name = getattr(entry, "author", "") or ""
    return name.replace("/u/", "").strip()


async def _get_feed_text(session: aiohttp.ClientSession, url: str, params: dict = None) -> str:
    async def _do_request():
        async with session.get(url, params=params, headers=HEADERS, timeout=15) as resp:
            if resp.status in (429, 500, 502, 503, 504):
                raise RuntimeError(f"retryable status {resp.status} for {url}")
            resp.raise_for_status()
            return await resp.text()

    return await async_retry_with_backoff(_do_request, max_retries=4, base_delay=3.0)


async def _search_posts_rss(session, subreddit: str, query: str) -> list[dict]:
    """Paginate Reddit's search RSS using the 'after' cursor convention old.reddit
    listings use. RSS pagination isn't officially documented, so this stops
    gracefully (rather than erroring) once a page adds no new entries."""
    url = f"https://www.reddit.com/r/{subreddit}/search.rss"
    all_posts = []
    seen_ids = set()
    after = None

    for _page in range(MAX_PAGES_PER_QUERY):
        params = {"q": query, "restrict_sr": 1, "sort": "relevance", "t": "all"}
        if after:
            params["after"] = after

        raw = await _get_feed_text(session, url, params)
        feed = feedparser.parse(raw)
        entries = feed.entries or []
        if not entries:
            break

        new_this_page = 0
        for entry in entries:
            post_id = _fullname_to_id(entry.get("id", ""))
            if not post_id or post_id in seen_ids:
                continue
            seen_ids.add(post_id)
            new_this_page += 1
            content = entry.get("content", [{}])
            body_html = content[0].get("value", "") if content else entry.get("summary", "")
            all_posts.append({
                "id": post_id,
                "title": entry.get("title", ""),
                "body": _strip_html(body_html),
                "author": _author_from_entry(entry),
                "link": entry.get("link", ""),
                "published": entry.get("published", ""),
            })
            after = f"t3_{post_id}"

        if new_this_page == 0:
            break  # no forward progress — RSS pagination isn't giving us new pages
        await asyncio.sleep(REQUEST_DELAY)

    return all_posts


async def _fetch_comments_rss(session, subreddit: str, post_id: str) -> list[dict]:
    url = f"https://www.reddit.com/r/{subreddit}/comments/{post_id}.rss"
    raw = await _get_feed_text(session, url)
    feed = feedparser.parse(raw)

    comments = []
    for entry in feed.entries or []:
        fullname = entry.get("id", "")
        if not fullname.rstrip().endswith(tuple(c for c in "0123456789abcdefghijklmnopqrstuvwxyz")):
            continue
        entry_id = _fullname_to_id(fullname)
        # The post itself also appears as an entry in this feed (t3_ prefix) — skip it, comments are t1_
        if f"t3_{post_id}" in fullname:
            continue

        content = entry.get("content", [{}])
        body_html = content[0].get("value", "") if content else entry.get("summary", "")
        body = _strip_html(body_html)
        author = _author_from_entry(entry)
        if not body or body.lower() in ("[deleted]", "[removed]") or author.lower() in ("automoderator", "auto_moderator"):
            continue

        comments.append({
            "id": entry_id,
            "body": body,
            "author": author,
            "link": entry.get("link", ""),
            "published": entry.get("published", ""),
        })

    return comments


def _parse_rss_date(date_str: str) -> str:
    if not date_str:
        return ""
    dt = parse_datetime_safe(date_str)
    if dt is not None:
        return dt.isoformat()
    return date_str


async def _process_pair(
    session, semaphore, subreddit: str, term: str, writer: JsonlWriter,
    fetch_comments: bool, checkpoint: dict, cutoff_date: datetime,
) -> int:
    pair_key = f"{subreddit}::{term}"
    if checkpoint.get(pair_key, {}).get("done"):
        return 0

    async with semaphore:
        try:
            posts = await _search_posts_rss(session, subreddit, term)
        except Exception as e:
            print(f"[reddit] search failed r/{subreddit} '{term}': {e}")
            return 0
        await asyncio.sleep(REQUEST_DELAY)

    count = 0
    for p in posts:
        # Check if post is within 18-month cutoff
        if not is_within_cutoff(p.get("published"), cutoff_date):
            continue

        writer.write({
            "source": "reddit",
            "type": "post",
            "source_id": p["id"],
            "subreddit": subreddit,
            "title": p["title"],
            "body": p["body"],
            "author": p["author"],
            "engagement_score": None,  # not exposed by RSS — see module docstring
            "num_comments": None,      # not exposed by RSS — see module docstring
            "created_at": _parse_rss_date(p["published"]),
            "url": p["link"],
            "scraped_at": datetime.now(timezone.utc).isoformat(),
        })
        count += 1

        if fetch_comments:
            async with semaphore:
                try:
                    comments = await _fetch_comments_rss(session, subreddit, p["id"])
                except Exception as e:
                    print(f"[reddit] comments failed for {p['id']}: {e}")
                    comments = []
                await asyncio.sleep(REQUEST_DELAY)

            for c in comments:
                if not is_within_cutoff(c.get("published"), cutoff_date):
                    continue

                writer.write({
                    "source": "reddit",
                    "type": "comment",
                    "source_id": c["id"],
                    "subreddit": subreddit,
                    "title": "",
                    "body": c["body"],
                    "author": c["author"],
                    "engagement_score": None,
                    "num_comments": None,
                    "created_at": _parse_rss_date(c["published"]),
                    "url": c["link"],
                    "scraped_at": datetime.now(timezone.utc).isoformat(),
                })
                count += 1

    checkpoint[pair_key] = {"done": True, "records": count}
    save_checkpoint(CHECKPOINT_NAME, checkpoint)
    return count


async def scrape_reddit_public_async(
    subreddits: list[str] = None,
    search_terms: list[str] = None,
    fetch_comments: bool = True,
    months_back: int = DEFAULT_MAX_MONTHS,
) -> int:
    subreddits = subreddits or SUBREDDITS
    search_terms = search_terms or SEARCH_TERMS
    cutoff_date = get_cutoff_date(months_back)
    checkpoint = load_checkpoint(CHECKPOINT_NAME)
    semaphore = asyncio.Semaphore(CONCURRENCY)

    print(f"[reddit] scraping posts/comments from past {months_back} months (since {cutoff_date.date()})")

    with JsonlWriter("reddit_posts.jsonl") as writer:
        async with aiohttp.ClientSession() as session:
            results = await asyncio.gather(*[
                _process_pair(session, semaphore, sub, term, writer, fetch_comments, checkpoint, cutoff_date)
                for sub in subreddits for term in search_terms
            ])

    total = sum(results)
    print(f"[reddit] fetched {total} new records this run (via RSS)")
    return total


def fetch_reddit_public(
    subreddits: list[str] = None,
    search_terms: list[str] = None,
    fetch_comments: bool = True,
    months_back: int = DEFAULT_MAX_MONTHS,
) -> int:
    return asyncio.run(scrape_reddit_public_async(subreddits, search_terms, fetch_comments, months_back))


def fetch_reddit_authenticated(
    subreddits: list[str] = None,
    search_terms: list[str] = None,
    posts_per_query: int = 100,
    months_back: int = DEFAULT_MAX_MONTHS,
) -> int:
    """Requires: pip install praw, and REDDIT_CLIENT_ID/SECRET/USER_AGENT env vars.
    NOTE: Reddit closed self-service API *approval* in Nov 2025 — a newly
    registered app may sit pending indefinitely. The RSS path above is the
    more reliable free option as of mid-2026; treat this as a bonus, not
    the primary plan. Same per-pair checkpointing as the public path, and
    unlike RSS, PRAW does still expose score/num_comments."""
    # pyrefly: ignore [missing-import]
    import praw

    cutoff_date = get_cutoff_date(months_back)

    reddit = praw.Reddit(
        client_id=os.environ["REDDIT_CLIENT_ID"],
        client_secret=os.environ["REDDIT_CLIENT_SECRET"],
        user_agent=os.environ.get("REDDIT_USER_AGENT", "myntra-wishlist-research/0.1"),
    )

    subreddits = subreddits or SUBREDDITS
    search_terms = search_terms or SEARCH_TERMS
    checkpoint = load_checkpoint(f"{CHECKPOINT_NAME}_auth")
    total = 0

    print(f"[reddit] (authenticated) scraping from past {months_back} months (since {cutoff_date.date()})")

    with JsonlWriter("reddit_posts.jsonl") as writer:
        for sub in subreddits:
            subreddit = reddit.subreddit(sub)
            for term in search_terms:
                pair_key = f"{sub}::{term}"
                if checkpoint.get(pair_key, {}).get("done"):
                    continue

                count = 0
                for submission in subreddit.search(term, limit=posts_per_query):
                    if not is_within_cutoff(submission.created_utc, cutoff_date):
                        continue

                    writer.write({
                        "source": "reddit",
                        "type": "post",
                        "source_id": submission.id,
                        "subreddit": sub,
                        "title": submission.title,
                        "body": submission.selftext,
                        "author": str(submission.author),
                        "engagement_score": submission.score,
                        "num_comments": submission.num_comments,
                        "created_at": datetime.fromtimestamp(submission.created_utc, tz=timezone.utc).isoformat(),
                        "url": f"https://reddit.com{submission.permalink}",
                        "scraped_at": datetime.now(timezone.utc).isoformat(),
                    })
                    count += 1

                    submission.comments.replace_more(limit=0)
                    for c in submission.comments.list():
                        author_str = str(c.author)
                        if not c.body or c.body in ("[deleted]", "[removed]") or author_str.lower() in ("automoderator", "auto_moderator"):
                            continue
                        if not is_within_cutoff(c.created_utc, cutoff_date):
                            continue
                        writer.write({
                            "source": "reddit",
                            "type": "comment",
                            "source_id": c.id,
                            "subreddit": sub,
                            "title": "",
                            "body": c.body,
                            "author": str(c.author),
                            "engagement_score": c.score,
                            "num_comments": None,
                            "created_at": datetime.fromtimestamp(c.created_utc, tz=timezone.utc).isoformat(),
                            "url": f"https://reddit.com{c.permalink}",
                            "scraped_at": datetime.now(timezone.utc).isoformat(),
                        })
                        count += 1

                checkpoint[pair_key] = {"done": True, "records": count}
                save_checkpoint(f"{CHECKPOINT_NAME}_auth", checkpoint)
                total += count

    print(f"[reddit] (authenticated) fetched {total} new records this run")
    return total


if __name__ == "__main__":
    use_auth = bool(os.environ.get("REDDIT_CLIENT_ID"))
    fetch_reddit_authenticated() if use_auth else fetch_reddit_public()
