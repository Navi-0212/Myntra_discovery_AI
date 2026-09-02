"""
YouTube comment scraper for Myntra haul / review / unboxing videos.

Two modes:
1. NO-KEY (default) — `youtube-comment-downloader` scrapes comments via the
   public web client. No quota limits, but no video *search* — you supply
   video URLs/IDs directly.
2. OFFICIAL API (optional) — YouTube Data API v3 lets you *search* for videos
   by keyword and costs ~1 quota unit per 100 comments fetched — with a key
   this is the cheapest path to real volume (see problem statement §3.2).
   Set YOUTUBE_API_KEY env var.

Checkpointed per video ID so a run interrupted partway through a long
comment thread resumes at the next unfinished video, not from scratch.
"""

import os
import re
import time
import urllib.parse
from datetime import datetime, timezone
import requests

from youtube_comment_downloader import YoutubeCommentDownloader, SORT_BY_POPULAR

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

SEED_VIDEO_IDS: list[str] = [
    "4qrpnaJu2tk", "q4ZlWQ387SI", "xuc76uMSJyg", "npnBJwtdK68", "5YPZTMuey50"
]

SEARCH_QUERIES = [
    "myntra haul",
    "myntra try on haul",
    "myntra review",
    "myntra kurti haul",
    "myntra dress haul",
    "myntra western wear haul",
    "myntra ethnic wear haul",
    "myntra footwear haul",
    "myntra shoe haul",
    "myntra jewellery haul",
    "myntra winter haul",
    "myntra summer haul",
    "myntra jeans haul",
    "myntra tops haul",
    "myntra unboxing",
    "myntra scam review",
    "myntra return refund review",
    "myntra sizing guide review",
    "myntra wishlist haul",
    "myntra end of reason sale haul",
    "myntra big fashion festival",
    "myntra affordable haul under 500",
    "myntra haul under 1000",
    "myntra office wear haul",
    "myntra college haul",
    "myntra festive haul",
    "myntra saree haul",
    "myntra bag haul",
    "myntra luxury review",
    "myntra shopping experience review"
]

CHECKPOINT_NAME = "youtube"
SLEEP_BETWEEN_VIDEOS = 0.5


def search_videos_public_web(query: str, max_vids: int = 30) -> list[str]:
    """Scrapes video IDs from YouTube search results without requiring an API key."""
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
    }
    url = f"https://www.youtube.com/results?search_query={urllib.parse.quote_plus(query)}"
    try:
        resp = requests.get(url, headers=headers, timeout=8)
        if resp.status_code == 200:
            found = list(dict.fromkeys(re.findall(r'"videoId":"([a-zA-Z0-9_-]{11})"', resp.text)))
            return found[:max_vids]
    except Exception as e:
        print(f"[youtube] public web search failed for '{query}': {e}", flush=True)
    return []


def fetch_comments_for_video(
    downloader: YoutubeCommentDownloader,
    video_id: str,
    max_comments: int = 150,
    cutoff_date: datetime = None,
) -> list[dict]:
    records = []
    try:
        comments_gen = downloader.get_comments(video_id, sort_by=SORT_BY_POPULAR)
        for c in comments_gen:
            if len(records) >= max_comments:
                break

            time_val = c.get("time", "")
            if cutoff_date and not is_within_cutoff(time_val, cutoff_date):
                continue

            records.append({
                "source": "youtube",
                "source_id": str(c.get("cid", "")),
                "video_id": video_id,
                "body": str(c.get("text", "")),
                "author": str(c.get("author", "")),
                "engagement_score": str(c.get("votes", "0")),
                "reply": bool(c.get("reply", False)),
                "created_at": str(time_val),
                "scraped_at": datetime.now(timezone.utc).isoformat(),
            })
    except Exception as e:
        print(f"[youtube] error fetching comments for {video_id}: {e}", flush=True)
    return records


def search_videos_official_api(
    query: str, max_results: int = 15, cutoff_date: datetime = None
) -> list[str]:
    """Requires: pip install google-api-python-client, YOUTUBE_API_KEY env var."""
    from googleapiclient.discovery import build

    youtube = build("youtube", "v3", developerKey=os.environ["YOUTUBE_API_KEY"])
    kwargs = {
        "q": query,
        "part": "id",
        "type": "video",
        "maxResults": max_results,
        "relevanceLanguage": "en",
    }
    if cutoff_date:
        kwargs["publishedAfter"] = cutoff_date.strftime("%Y-%m-%dT%H:%M:%SZ")

    resp = youtube.search().list(**kwargs).execute()
    return [item["id"]["videoId"] for item in resp.get("items", [])]


def fetch_youtube_reviews(
    video_ids: list[str] = None,
    use_search: bool = True,
    max_comments_per_video: int = 150,
    months_back: int = DEFAULT_MAX_MONTHS,
    target_count: int = 10000,
) -> int:
    ids = list(video_ids or SEED_VIDEO_IDS)
    cutoff_date = get_cutoff_date(months_back)

    if use_search:
        if os.environ.get("YOUTUBE_API_KEY"):
            print("[youtube] searching videos via Official YouTube API...", flush=True)
            for q in SEARCH_QUERIES:
                try:
                    ids.extend(search_videos_official_api(q, cutoff_date=cutoff_date))
                except Exception as e:
                    print(f"[youtube] search failed for '{q}': {e}", flush=True)
        else:
            print("[youtube] discovering videos across fashion queries via parallel web search...", flush=True)
            from concurrent.futures import ThreadPoolExecutor
            with ThreadPoolExecutor(max_workers=8) as pool:
                results = list(pool.map(lambda q: search_videos_public_web(q, max_vids=30), SEARCH_QUERIES))
                for vids in results:
                    ids.extend(vids)
        ids = list(dict.fromkeys(ids))  # dedupe, preserve order

    print(f"[youtube] discovered {len(ids)} target video IDs to scrape", flush=True)
    print(f"[youtube] scraping comments from past {months_back} months (since {cutoff_date.date()})", flush=True)

    checkpoint = load_checkpoint(CHECKPOINT_NAME)
    total = 0
    import threading
    lock = threading.Lock()

    def process_video(vid: str, writer: JsonlWriter) -> int:
        nonlocal total
        with lock:
            if total >= target_count:
                return 0
            if checkpoint.get(vid, {}).get("done"):
                return 0

        downloader = YoutubeCommentDownloader()
        records = fetch_comments_for_video(downloader, vid, max_comments_per_video, cutoff_date)
        
        with lock:
            if records:
                writer.write_many(records)
                total += len(records)
                print(f"[youtube] {vid}: fetched {len(records)} comments (total this run: {total}/{target_count})", flush=True)
            checkpoint[vid] = {"done": True, "records": len(records)}
            save_checkpoint(CHECKPOINT_NAME, checkpoint)
            return len(records)

    with JsonlWriter("youtube_comments.jsonl") as writer:
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=8) as pool:
            futures = [pool.submit(process_video, vid, writer) for vid in ids]
            for f in futures:
                try:
                    f.result()
                except Exception as e:
                    pass
                if total >= target_count:
                    print(f"[youtube] reached target count of {target_count}, finishing.", flush=True)
                    break

    print(f"[youtube] finished: fetched {total} new comments across videos", flush=True)
    return total


if __name__ == "__main__":
    use_search = bool(os.environ.get("YOUTUBE_API_KEY"))
    fetch_youtube_reviews(use_search=use_search)
