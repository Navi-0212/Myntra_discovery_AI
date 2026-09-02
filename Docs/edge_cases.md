# Myntra Wishlist Discovery Engine — Edge Cases & Failure Modes Log

This document cataloges all identified edge cases, data anomalies, rate-limiting constraints, and algorithmic failure modes across the entire **Myntra Wishlist Discovery Engine** pipeline. It provides clear root-cause explanations, immediate mitigations, and architectural safeguards.

---

## Quick Navigation

- [1. Data Acquisition & Scraping Layer](#1-data-acquisition--scraping-layer)
  - [1.1 Apple App Store Scraper](#11-apple-app-store-scraper)
  - [1.2 Google Play Store Scraper](#12-google-play-store-scraper)
  - [1.3 Reddit Public RSS / PRAW Scraper](#13-reddit-public-rss--praw-scraper)
  - [1.4 YouTube Scraper](#14-youtube-scraper)
  - [1.5 Shared Scraping Resilience (Streaming, Checkpoints, Backoff)](#15-shared-scraping-resilience-streaming-checkpoints-backoff)
- [2. Ingestion, Normalization & Privacy (PII) Layer](#2-ingestion-normalization--privacy-pii-layer)
- [3. Semantic Embedding & Unsupervised Clustering Layer](#3-semantic-embedding--unsupervised-clustering-layer)
- [4. LLM Theme Extraction & Grounded Quote Gate](#4-llm-theme-extraction--grounded-quote-gate)
- [5. Operational, Environment & Cross-Platform Edge Cases](#5-operational-environment--cross-platform-edge-cases)

---

## 1. Data Acquisition & Scraping Layer

### 1.1 Apple App Store Scraper
| Edge Case / Scenario | Severity | Root Cause | System Behavior & Mitigation |
| :--- | :--- | :--- | :--- |
| **10-Page RSS Ceiling** | `Medium` | Apple's public RSS API enforces a hard ceiling of 10 pages per storefront ($50 \text{ reviews/page} \times 10 = 500$ reviews). | Scraper records `page >= 10` in checkpoint and halts pagination cleanly for that country. Volume shortfall is compensated by Google Play Store. |
| **Empty / Missing Customer Reviews** | `Low` | Specific storefronts or localized pages return an XML/JSON payload with no `entry` key. | Scraper uses `.get("feed", {}).get("entry", [])` with defensive checks. If empty, the page loop terminates without raising an unhandled exception. |
| **Country Code Differences** | `Low` | Users review in different regions (`in`, `us`, `ae`). | Scraper iterates through configured country list (`['in', 'us']`) and tracks checkpoint state independently per country. |
| **HTTP 403 / 429 Rate Limiting** | `Medium` | Rapid burst requests triggered during async gather across pages. | Handled via `@async_retry_with_backoff` with exponential delays and full jitter ($0.5\times - 1.5\times$). |

---

### 1.2 Google Play Store Scraper
| Edge Case / Scenario | Severity | Root Cause | System Behavior & Mitigation |
| :--- | :--- | :--- | :--- |
| **Null / Expired Continuation Token** | `Medium` | Google Play Store pagination tokens expire or return `None` when the end of the public review index is reached. | Loop explicitly checks `if not continuation_token: break`, saves the total fetched count, and completes cleanly. |
| **Repeated / Duplicate Reviews Across Batches** | `Low` | Google's RPC endpoint occasionally re-serves the same review ID across sliding pagination windows. | Raw scraper logs all rows into append-only JSONL; downstream `pipeline/ingest_normalize.py` handles primary deduplication on `(source, source_id)`. |
| **Reviews with 0-Star / Missing Rating** | `Low` | Web scrape artifacts or corrupted review objects without numerical ratings. | Schema maps rating to `float(rating)` or `None` if absent, ensuring downstream Parquet types remain nullable `float64`. |
| **Emoji-Only or Whitespace Content** | `Low` | Users submitting reviews with only emoticons or blank spaces. | Normalized text extraction trims whitespace; filtered downstream if `len(text) < 15`. |

---

### 1.3 Reddit Public RSS / PRAW Scraper
| Edge Case / Scenario | Severity | Root Cause | System Behavior & Mitigation |
| :--- | :--- | :--- | :--- |
| **May 2026 Unauthenticated `.json` Lockdown** | `Critical` | Reddit disabled unauthenticated `.json` API endpoints, returning 403/429 errors. | Scraper uses public `.rss` search feeds via `feedparser` as zero-auth baseline, with automated fallback to `PRAW` if `REDDIT_CLIENT_ID` is set. |
| **Missing Engagement Metrics in RSS** | `Medium` | Reddit's public RSS feeds omit upvote scores and comment counts. | Schema safely defaults `engagement_score: null` without failing contract validations. |
| **Deleted / Removed Submissions** | `Low` | Posts/comments containing `[deleted]` or `[removed]`. | Skipped during ingestion or filtered during length/quality validation. |
| **Automoderator / Pinned Announcements** | `Medium` | Pinned bot comments repeating subreddit rules across every post. | Scraper skips author `AutoModerator` and common moderation sticky prefixes. |
| **Hinglish & Romanized Hindi Commentary** | `High` | Indian fashion communities (`r/IndianFashionAddicts`) frequently code-mix (e.g., *"fabric bekar hai, return kar diya"*). | Processed as valid text. Embedding model (`all-MiniLM-L6-v2`) and Gemini/Groq LLMs natively understand contextual Hinglish nuances. |

---

### 1.4 YouTube Scraper
| Edge Case / Scenario | Severity | Root Cause | System Behavior & Mitigation |
| :--- | :--- | :--- | :--- |
| **Unauthenticated Seed List Boundary** | `Medium` | Public comment scraping without API keys relies on a fixed seed list of video IDs. | Checkpoint tracks `processed_video_ids`. Supports seamless upgrade to `YOUTUBE_API_KEY` for automated query-based video discovery. |
| **Comments Disabled on Video** | `Low` | Uploader disabled comments or marked video for kids. | Scraper catches `CommentsDisabled` / 403 exceptions, logs a warning, and continues to the next video in the queue. |
| **Relative Time Format Variations** | `Medium` | Web comments display relative timestamps like `"2 days ago"`, `"3 months ago"`, `"1 year ago"`. | `parse_relative_time()` safely translates human strings into UTC datetime objects; unparseable dates default to passing the cutoff filter to prevent data loss. |
| **Promotional Spam / Affiliate Links** | `Low` | Influencer comments containing coupon codes and affiliate URLs. | Downstream length filtering and clustering isolate bot spam into separate clusters or HDBSCAN noise (`-1`). |

---

### 1.5 Shared Scraping Resilience (Streaming, Checkpoints, Backoff)
| Edge Case / Scenario | Severity | Root Cause | System Behavior & Mitigation |
| :--- | :--- | :--- | :--- |
| **Process Termination / Mid-Run Crash** | `High` | System restart, network disconnect, or manual `Ctrl+C` interrupt during execution. | `JsonlWriter` immediately executes `flush()` per record. At resume, checkpoints restore state and corrupt/partial EOF lines are gracefully skipped. |
| **Corrupted Partial Last Line in JSONL** | `Medium` | Disk write interrupted mid-line when process is killed. | `_load_jsonl()` wraps `json.loads(line)` in a `try...except json.JSONDecodeError` block, skipping the partial line without failing the pipeline. |
| **Thundering-Herd on Public APIs** | `High` | Multiple workers hammering an endpoint simultaneously after a 429 response. | Exponential backoff includes random uniform jitter ($0.5\times - 1.5\times$) across retries. |

---

## 2. Ingestion, Normalization & Privacy (PII) Layer

```
Raw JSONL ──► [Corrupted Line Skip] ──► [Schema Normalization] ──► [Length Filter (<15 chars)] ──► [Emoji Filter] ──► [Language Filter] ──► [Dedup] ──► [Presidio NER] ──► Unified Parquet
```

| Edge Case / Scenario | Severity | Root Cause | System Behavior & Mitigation |
| :--- | :--- | :--- | :--- |
| **Empty Scraping Directory (`data/raw/` empty)** | `High` | User runs pipeline with `--skip-scrape` before performing any scraping. | `build_dataset()` detects empty DataFrame and raises a clear `RuntimeError` with instructions to run scrapers first. |
| **Ultra-Short "Noise" Reviews** | `Medium` | One-word reviews like *"Good"*, *"Nice"*, *"Ok"*, *"Bad app"*, *"Myntra"*. | Enforces `MIN_TEXT_LENGTH = 15`. Removes uninformative noise before dense vector embedding. |
| **Reviews Containing Emojis / Pictographs** | `Medium` | Reviews with emoticons (e.g. *"Great fit 😍👍"*). | `has_emoji()` identifies all emoji/pictograph characters and completely drops those records to ensure dense textual quality. |
| **Non-English Commentary & Regional Scripts** | `Medium` | Reviews in Indian regional scripts (Devanagari, Tamil, Telugu, etc.) or foreign languages. | `is_english()` checks Unicode scripts and character distributions, dropping all non-English commentary. |
| **Identical Cross-Posted Comments** | `Medium` | The same user posting identical feedback across multiple platforms or threads. | Two-tier deduplication: Tier 1 drops duplicate `(source, source_id)`; Tier 2 drops duplicate normalized `text`. |
| **PII Exposure in Angry Rants** | `Critical` | Users pasting sensitive details: phone numbers, order IDs, personal email addresses, tracking links. | Microsoft Presidio local Analyzer & Anonymizer scans and redacts PII (`<PHONE_NUMBER>`, `<EMAIL_ADDRESS>`) before Parquet persistence and before LLM submission. |
| **Presidio Not Installed** | `Medium` | User environment missing `presidio-analyzer` / `presidio-anonymizer`. | Module catches `ImportError`, logs a clear warning, and safely falls back to unscrubbed processing rather than crashing the execution. |
| **Date Timezone Inconsistencies** | `Low` | Mix of naive datetimes, UTC timestamps, and ISO strings with timezone offsets (`+05:30`). | `parse_datetime_safe()` converts all formats to standardized timezone-aware UTC objects. |

---

## 3. Semantic Embedding & Unsupervised Clustering Layer

```
Corpus (N docs) ──► SentenceTransformers (384-d) ──► UMAP (10-d) ──► HDBSCAN (Density) ──► Clusters (0..K) + Noise (-1)
```

| Edge Case / Scenario | Severity | Root Cause | System Behavior & Mitigation |
| :--- | :--- | :--- | :--- |
| **HDBSCAN Noise Cluster (`cluster_id = -1`)** | `High` | Outlier reviews that do not share semantic density with at least 25 other records. | Cluster `-1` is preserved in `clustered_corpus.parquet` for manual audit and explicitly skipped from automated theme extraction to prevent hallucinated generic themes. |
| **Insufficient Records for Clustering ($N < 25$)** | `High` | Small test dataset or filtered subset smaller than `min_cluster_size`. | Pipeline logs a warning; HDBSCAN assigns all to `-1` or reduces parameters dynamically to avoid mathematical errors. |
| **High Dimensionality Skew (Curse of Dimensionality)** | `Medium` | Direct clustering on 384-dimensional embeddings produces poor density separation. | UMAP reduces vectors to 10 dimensions using `metric='cosine'` and `min_dist=0.0`, maximizing cluster compaction. |
| **Hinglish Semantic Clustering** | `Medium` | Mixed-language vocabulary splitting similar complaints into different clusters. | `sentence-transformers/all-MiniLM-L6-v2` maps semantic intent across Romanized Hindi and English into common dense neighborhoods. |
| **Dominant Delivery/Logistics Rants Overshadowing Wishlist Insights** | `Medium` | General courier complaints outnumbering specific wishlist behavioral friction. | Unsupervised clustering naturally groups courier rants into distinct standalone clusters, allowing PMs to focus specifically on wishlist/sizing/intent clusters. |

---

## 4. LLM Theme Extraction & Grounded Quote Gate

```
Cluster Documents ──► Sample 20 Docs ──► LLM Synthesis ──► [Grounded Quote Gate] ──► Validated themes.json
                                                                    │ (Quote Failed)
                                                                    └──► Re-prompt LLM (Max 2 retries)
```

| Edge Case / Scenario | Severity | Root Cause | System Behavior & Mitigation |
| :--- | :--- | :--- | :--- |
| **LLM Paraphrasing / Invented Quotes** | `Critical` | LLMs naturally paraphrase user quotes (e.g. converting *"fabric is thin"* to *"users reported thin fabric"*). | **Grounded Quote Validation Gate**: Verifies `quote.lower() in raw_text.lower()`. Failed quotes are rejected and fed back into an automated re-prompt loop (up to 2 retries). |
| **Quote Gate Mismatches from PII Redaction** | `Medium` | Presidio replaced a phone/email with `<PHONE_NUMBER>`, but LLM omitted the tag in the quote. | Grounded validator compares against the post-scrubbed document sample passed to the LLM prompt. |
| **LLM Markdown Fencing & JSON Syntax Errors** | `Medium` | LLMs adding ````json ... ```` fences or conversational preambles. | Uses Gemini's native `response_schema` structured output mode, guaranteeing deterministic schema-compliant JSON without markdown stripping regex. |
| **Cluster Lacks Evidence for Research Questions** | `Low` | A specific cluster (e.g. return policy friction) contains no data on wishlist comparison behavior. | Schema instructs LLM to explicitly answer `"no evidence in this cluster"`, preventing speculative hallucination. |
| **LLM API Rate Limiting (429) & Token Limits** | `High` | Prompting across 100+ clusters exceeds provider requests-per-minute (RPM) or tokens-per-minute (TPM). | Prompts sample top 20 representative documents per cluster (bounded input size); rate limit backoff is applied on API calls. |
| **Missing / Invalid API Key** | `Critical` | `GEMINI_API_KEY` or `GROQ_API_KEY` not set in `.env`. | System raises an immediate informative error specifying which environment variable is required. |

---

## 5. Operational, Environment & Cross-Platform Edge Cases

| Edge Case / Scenario | Severity | Root Cause | System Behavior & Mitigation |
| :--- | :--- | :--- | :--- |
| **Missing Python Package (e.g., `aiohttp`)** | `Medium` | Package not installed in the active virtual environment or interpreter path. | Detailed in `requirements.txt` with clear installation guidance and interpreter selection steps. |
| **Windows Path & Slash Formatting** | `Low` | Windows backslashes (`\`) vs POSIX slashes (`/`) in file references. | All pipeline paths use `pathlib.Path` objects for OS-agnostic path resolution. |
| **Windows Console Unicode Encoding (`cp1252`)** | `Low` | Printing emojis or Indian language scripts to standard Windows CMD/PowerShell. | File writes explicitly specify `encoding="utf-8"`; console logging avoids raw unencoded byte streams. |
| **Large Parquet Compression & Memory Leaks** | `Low` | Holding massive DataFrames in RAM during processing. | Data is chunked, compressed with Snappy/PyArrow, and written to disk at stage boundaries. |

---

## 6. Edge Case Maintenance Checklist for Developers

When modifying or extending the pipeline:
- [ ] **Scrapers:** Ensure any new scraper inherits from `JsonlWriter` and implements `load_checkpoint` / `save_checkpoint`.
- [ ] **Dates:** Always use `parse_datetime_safe()` and `is_within_cutoff()` rather than raw `datetime.strptime`.
- [ ] **PII:** Never bypass `_scrub_pii()` before writing to Parquet or sending text to external LLM APIs.
- [ ] **LLM Grounding:** Always retain the exact substring verification in `pipeline/theme_extraction.py` for any new extraction prompts.
- [ ] **Noise Clusters:** Never force HDBSCAN noise cluster (`-1`) into automated theme labeling.
