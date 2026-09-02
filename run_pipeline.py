"""
End-to-end runner: scrape -> ingest/normalize -> cluster -> theme extraction.

Usage:
    python run_pipeline.py --skip-scrape          # reuse existing data/raw/*.jsonl
    python run_pipeline.py --provider groq        # use Groq instead of Gemini
    python run_pipeline.py --sources play_store youtube   # scrape a subset
    python run_pipeline.py                        # full run

Scrapers now write incrementally to data/raw/*.jsonl as they go (see
scrapers/utils.py:JsonlWriter) and checkpoint their own progress under
data/checkpoints/ — this runner just calls each one and reports the count
it added. Re-running with the same raw files present resumes each scraper
from its checkpoint rather than starting over.
"""

import argparse
import os
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

ALL_SOURCES = ["app_store", "play_store", "reddit", "youtube"]


def scrape_all(sources: list[str], months: int = 18):
    if "app_store" in sources:
        from scrapers.app_store_scraper import fetch_app_store_reviews
        print("[scrape] App Store...")
        n = fetch_app_store_reviews(months_back=months)
        print(f"  -> {n} new records")

    if "play_store" in sources:
        from scrapers.play_store_scraper import fetch_play_store_reviews
        print("[scrape] Play Store...")
        n = fetch_play_store_reviews(months_back=months)
        print(f"  -> {n} total records (this run + prior checkpointed)")

    if "reddit" in sources:
        from scrapers.reddit_scraper import fetch_reddit_public, fetch_reddit_authenticated
        print("[scrape] Reddit...")
        use_auth = bool(os.environ.get("REDDIT_CLIENT_ID"))
        n = (
            fetch_reddit_authenticated(months_back=months)
            if use_auth
            else fetch_reddit_public(months_back=months)
        )
        print(f"  -> {n} new records (auth={use_auth})")

    if "youtube" in sources:
        from scrapers.youtube_scraper import fetch_youtube_reviews
        print("[scrape] YouTube...")
        n = fetch_youtube_reviews(use_search=True, months_back=months)
        print(f"  -> {n} new records")


def main():
    default_provider = "groq" if (os.environ.get("GROQ_API_KEY") and not os.environ.get("GEMINI_API_KEY")) else "gemini"
    parser = argparse.ArgumentParser(description="Myntra Wishlist Discovery Pipeline Runner")
    parser.add_argument("--skip-scrape", action="store_true", help="reuse existing data/raw/*.jsonl")
    parser.add_argument("--provider", default=default_provider, choices=["gemini", "groq"],
                        help=f"LLM provider for theme synthesis (default: {default_provider})")
    parser.add_argument("--sources", nargs="+", default=ALL_SOURCES, choices=ALL_SOURCES,
                         help="scrape only these sources (default: all four)")
    parser.add_argument("--months", type=int, default=18,
                         help="scrape records from past N months (default: 18)")
    parser.add_argument("--max-clusters", type=int, default=None,
                         help="extract themes only for top N largest clusters (default: all)")
    args = parser.parse_args()

    if not args.skip_scrape:
        scrape_all(args.sources, months=args.months)
    else:
        print("[scrape] skipped, reusing data/raw/*.jsonl")

    from pipeline.ingest_normalize import build_dataset
    print("\n[ingest] normalizing and scrubbing PII...")
    df = build_dataset()

    from pipeline.cluster import run_clustering
    print("\n[cluster] embedding and clustering...")
    clustered_df = run_clustering(df)

    from pipeline.theme_extraction import run_theme_extraction
    print(f"\n[theme] extracting themes with {args.provider.upper()} + grounded quote validation...")
    themes = run_theme_extraction(clustered_df, provider=args.provider, max_clusters=args.max_clusters)

    print("\n=======================================================")
    print(f"PIPELINE RUN COMPLETE: {len(themes)} themes written to data/processed/themes.json")
    for t in themes:
        print(f"  • Theme {t.get('cluster_id')}: {t.get('theme_label')} ({t.get('cluster_size')} docs, {len(t.get('supporting_quotes', []))} grounded quotes)")
    print("=======================================================")


if __name__ == "__main__":
    main()
