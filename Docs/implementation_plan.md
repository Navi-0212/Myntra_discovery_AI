# Detailed Phase-Wise Implementation Plan: Myntra Wishlist Discovery Engine

Based on the technical specifications in [`architecture.md`](file:///c:/Users/navi6/Downloads/myntra-wishlist-discovery_1/myntra-wishlist-discovery/Docs/architecture.md), [`context.md`](file:///c:/Users/navi6/Downloads/myntra-wishlist-discovery_1/myntra-wishlist-discovery/Docs/context.md), and [`edge_cases.md`](file:///c:/Users/navi6/Downloads/myntra-wishlist-discovery_1/myntra-wishlist-discovery/Docs/edge_cases.md).

---

## 1. Executive Summary & Pipeline Architecture

The **Myntra Wishlist Discovery Engine** is an asynchronous, decoupled, multi-stage data mining and machine learning intelligence pipeline. Its architectural purpose is to ingest public customer sentiment regarding Myntra across four heterogeneous channels, filter noise, scrub PII, perform dense semantic clustering, and extract factual, evidence-grounded behavioral themes answering ten foundational PM discovery questions.

```
+----------------------------------------------------------------------------------------------------+
|                                    DATA ACQUISITION LAYER                                          |
|                                                                                                    |
|  [Apple App Store RSS]    [Google Play Store]       [Reddit Search RSS]     [YouTube hauls/reviews]|
|       (Async RSS)           (Continuation)            (Feedparser)             (Comment Stream)    |
+-------------+----------------------+----------------------+----------------------+-----------------+
              |                      |                      |                      |
              +----------------------+----------------------+----------------------+
                                     |  JSONL Streaming (Append-only) + Checkpointing
                                     v
+------------------------------------+---------------------------------------------------------------+
|                            INGESTION, CLEANING & PRIVACY LAYER                                     |
|                                                                                                    |
|  - Schema Unification & Multi-field Text Merging (title + body / comments)                         |
|  - Noise Filtration (len(text) >= 15 chars)                                                        |
|  - Emoji Removal Filter (drop reviews containing emojis or decorative pictographs)                 |
|  - Language Filter (drop reviews in non-English languages / non-Latin scripts)                      |
|  - Two-tier Deduplication: Primary (source, source_id) -> Secondary (exact text)                   |
|  - Presidio PII Scrubbing (Local Analyzer + Anonymizer Engine for Emails, Phones, Order IDs)       |
|  - Output: data/processed/unified_corpus.parquet                                                   |
+------------------------------------+---------------------------------------------------------------+
                                     |
                                     v
+------------------------------------+---------------------------------------------------------------+
|                       EMBEDDING, MANIFOLD LEARNING & CLUSTERING LAYER                              |
|                                                                                                    |
|  - Dense Embeddings: SentenceTransformers (all-MiniLM-L6-v2, 384-d vectors)                       |
|  - Dimensionality Reduction: UMAP (Cosine metric, n_neighbors=15, n_components=10, min_dist=0.0)   |
|  - Density Clustering: HDBSCAN (min_cluster_size=25, min_samples=5, Excess of Mass selection)     |
|  - Noise Isolation: Cluster -1 preserved in parquet for outlier analysis                           |
|  - Output: data/processed/clustered_corpus.parquet                                                 |
+------------------------------------+---------------------------------------------------------------+
                                     |
                                     v
+------------------------------------+---------------------------------------------------------------+
|                       LLM THEME EXTRACTION & GROUNDED VALIDATION GATE                              |
|                                                                                                    |
|  - Representative Document Sampling (Top 20 verbatim docs per non-noise cluster)                  |
|  - Cost Optimization: O(K) Cluster-level synthesis vs O(N) Document-level LLM calls               |
|  - LLM Inference: Gemini 1.5 Flash (response_schema) / Groq LLaMA 3.3 70B (json_object)           |
|  - Strict Grounded Quote Gate: Verbatim substring check with automated 2-retry feedback loop       |
|  - Output: data/processed/themes.json                                                              |
+----------------------------------------------------------------------------------------------------+
```

---

## 2. Phase-Wise Implementation Roadmap

### Phase 1: Core Scraper Resilience & State Checkpointing Subsystem
**Objective:** Establish fault-tolerant, append-only disk streaming and state resumption primitives to prevent data loss or duplicate requests across all scraping jobs.

* **Task 1.1: Streaming JSONL Writer (`scrapers/utils.py`)**
  * Implement `JsonlWriter` class managing append-only file descriptors with explicit sub-second `file.flush()` per record.
  * Ensure memory footprint remains $O(1)$ regardless of volume.
* **Task 1.2: State Checkpointing Mechanism (`scrapers/utils.py`)**
  * Implement `save_checkpoint(scraper_name, state_dict)` and `load_checkpoint(scraper_name)` under `data/checkpoints/{name}.json`.
  * Support high-water marks: Play Store continuation tokens, App Store page indices, Reddit last seen IDs/timestamps, and YouTube processed video IDs.
* **Task 1.3: Exponential Backoff with Jitter Decorators (`scrapers/utils.py`)**
  * Implement synchronous `@retry_with_backoff` and asynchronous `@async_retry_with_backoff`.
  * Formula: $\text{Delay} = \min(\text{max\_delay}, \text{base\_delay} \times 2^{\text{attempt}}) \times \text{Uniform}(0.5, 1.5)$ to prevent thundering-herd issues on HTTP 429/5xx status codes.
* **Task 1.4: Safe Timestamp & Date Cutoff Utilities (`scrapers/utils.py`)**
  * Implement `parse_datetime_safe()`, `parse_relative_time()`, and `is_within_cutoff(dt, months_back)` for standardized UTC ISO-8601 formatting and robust lookback cutoffs (default 18 months).

---

### Phase 2: Multi-Channel Heterogeneous Data Acquisition
**Objective:** Ingest customer sentiment from four distinct channels with zero-credential baselines and drop-in authenticated upgrade paths.

* **Task 2.1: Apple App Store Scraper (`scrapers/app_store_scraper.py`)**
  * Asynchronous extraction via `aiohttp` from iTunes RSS endpoint (`https://itunes.apple.com/{country}/rss/customerreviews/id=907394059/sortBy=mostRecent/page={page}/json`).
  * Enforce country storefront iteration (`['in', 'us']`) and respect Apple's 10-page ($500$ review) ceiling per storefront.
  * Emit standardized record: `source="app_store"`, `rating`, `title`, `text`, `author`, `created_at`, `context=country`.
* **Task 2.2: Google Play Store Scraper (`scrapers/play_store_scraper.py`)**
  * Primary volume workhorse using `google-play-scraper` on `com.myntra.android`.
  * Implement recursive tokenized continuation loops with 200 reviews/batch and $1.0\text{s}$ adaptive throttling.
  * Checkpoint continuation tokens and handle null/exhausted tokens cleanly.
* **Task 2.3: Reddit Search & Discussion Scraper (`scrapers/reddit_scraper.py`)**
  * **Public Mode (Default):** Zero-credential ingestion using `feedparser` over `.rss` search feeds across Indian fashion subreddits (`r/IndianFashionAddicts`, `r/india`, `r/IndianStreetwear`, `r/femalefashionadvice`, etc.).
  * Two-level crawl: Subreddit search RSS $\rightarrow$ Post comment thread RSS.
  * **Authenticated Mode:** Seamless fallback to `praw.Reddit` if `REDDIT_CLIENT_ID` is present.
  * Filter out `AutoModerator` stickies, `[deleted]`, and `[removed]` entries.
* **Task 2.4: YouTube Video Haul/Review Scraper (`scrapers/youtube_scraper.py`)**
  * **Public Mode (Default):** Use `youtube-comment-downloader` on seeded haul/try-on/sizing video IDs (`SEED_VIDEO_IDS`).
  * **Authenticated Mode:** YouTube Data API v3 integration (`youtube.search().list` + `commentThreads`) when `YOUTUBE_API_KEY` is provided.
  * Include `parse_relative_time()` to parse relative strings (e.g. "3 months ago") into standard UTC dates.

---

### Phase 3: Ingestion, Normalization, Noise Filtering & Privacy (PII) Layer
**Objective:** Transform heterogeneous JSONL streams into a unified, deduplicated, noise-free, and PII-redacted Parquet dataset.

* **Task 3.1: Defensive Record Loader (`pipeline/ingest_normalize.py`)**
  * Read `data/raw/*.jsonl` defensively, catching and skipping corrupted/partial EOF lines caused by mid-stream process kills.
* **Task 3.2: Schema Unification & Multi-Field Text Merging (`pipeline/ingest_normalize.py`)**
  * Merge titles, bodies, and comment selftexts into a canonical `text` field.
  * Standardize columns: `doc_id`, `source`, `source_id`, `text`, `rating`, `engagement_score`, `author`, `created_at`, `url`, `context`.
* **Task 3.3: Noise Filtration (`pipeline/ingest_normalize.py`)**
  * Filter out records where `len(text) < 15` characters (eliminates uninformative strings like "nice", "good app", "bad").
* **Task 3.4: Emoji Removal Filter (`pipeline/ingest_normalize.py`)**
  * Filter out and drop all reviews/comments containing emojis or decorative pictographs (`has_emoji`) to ensure dense textual content.
* **Task 3.5: Non-English Language Filter (`pipeline/ingest_normalize.py`)**
  * Filter out and drop non-English reviews (`is_english`), detecting and dropping non-Latin scripts (Devanagari, Tamil, Telugu, Bengali, Arabic, Cyrillic, CJK, etc.) and non-English text.
* **Task 3.6: Two-Tier Deduplication (`pipeline/ingest_normalize.py`)**
  * Tier 1: Deduplicate on exact `(source, source_id)`.
  * Tier 2: Deduplicate on exact normalized `text`.
* **Task 3.7: Local Microsoft Presidio PII Scrubbing (`pipeline/ingest_normalize.py`)**
  * Run local `presidio_analyzer.AnalyzerEngine` and `presidio_anonymizer.AnonymizerEngine`.
  * Redact sensitive personal data (phone numbers, email addresses, order IDs) into `<PHONE_NUMBER>`, `<EMAIL_ADDRESS>` prior to local storage or LLM forwarding.
  * Output persisted to `data/processed/unified_corpus.parquet`.

---

### Phase 4: Semantic Embedding & Unsupervised Geometric Clustering
**Objective:** Uncover latent behavioral themes without pre-labeled taxonomies using high-dimensional dense embeddings and manifold learning.

* **Task 4.1: Dense Vector Embeddings (`pipeline/cluster.py`)**
  * Generate 384-dimensional dense semantic vectors using `sentence-transformers/all-MiniLM-L6-v2` in batches (`batch_size=64`).
* **Task 4.2: UMAP Manifold Dimensionality Reduction (`pipeline/cluster.py`)**
  * Reduce dimensionality from $384 \rightarrow 10$ dimensions to mitigate the curse of dimensionality.
  * Parameters: `n_neighbors=15`, `n_components=10`, `metric="cosine"`, `min_dist=0.0`.
* **Task 4.3: HDBSCAN Density-Based Clustering (`pipeline/cluster.py`)**
  * Cluster reduced vectors using `HDBSCAN(min_cluster_size=25, min_samples=5, metric="euclidean", cluster_selection_method="eom")`.
* **Task 4.4: Noise Isolation & Cluster Persistence (`pipeline/cluster.py`)**
  * Retain `cluster_id = -1` (unclustered outliers) for PM auditing while isolating them from automated theme labeling.
  * Append `cluster_id` and `cluster_confidence` columns and save to `data/processed/clustered_corpus.parquet`.

---

### Phase 5: LLM Theme Extraction & Grounded Quote Gate
**Objective:** Synthesize qualitative product intelligence answering the 10 PM discovery questions while enforcing zero-hallucination verbatim quote guarantees.

* **Task 5.1: Representative Sampling (`pipeline/theme_extraction.py`)**
  * Sample top 20 representative documents per valid non-noise cluster ($k \ge 0$).
* **Task 5.2: Structured LLM Synthesis Engine (`pipeline/theme_extraction.py`)**
  * **Provider A (Google Gemini):** Call `gemini-1.5-flash` with native structured `response_schema` enforcing JSON schema determinism.
  * **Provider B (Groq):** Call `llama-3.3-70b-versatile` with `response_format={"type": "json_object"}`.
* **Task 5.3: 10 Research Questions Evaluation (`pipeline/theme_extraction.py`)**
  * Frame prompts to address the 10 discovery vectors:
    1. **Wishlist Intent**: Why do users add fashion products to their wishlist?
    2. **Purchase Blockers**: What prevents wishlisted products from being purchased?
    3. **Post-Shortlisting Uncertainty**: What uncertainties remain after finding a liked item?
    4. **Postponement Drivers**: What causes users to postpone/abandon purchase?
    5. **Comparison Behaviors**: How do users compare shortlisted products?
    6. **External Information Search**: What validation is sought outside the app?
    7. **Decision Dimensions**: Role of fit, size, styling, fabric, reviews, occasion.
    8. **Intent vs Bookmarking**: Real purchase intent vs aspirational moodboard.
    9. **Segment Nuances**: Price-sensitive vs occasion buyer signals.
    10. **Cross-Channel Needs**: Universal friction points across platforms.
  * Require explicit `"no evidence in this cluster"` when evidence is absent to prevent speculative hallucination.
* **Task 5.4: Grounded Quote Validation Gate (`pipeline/theme_extraction.py`)**
  * Verify $\forall q \in \text{supporting\_quotes}$, $\text{clean}(q) \subseteq \bigcup_{d \in \text{Sample}} \text{clean}(d)$.
  * Automated 2-retry feedback loop: If a quote fails verbatim containment, re-prompt the LLM explicitly flagging the rejected quotes.
  * Commit only validated themes into `data/processed/themes.json`.

---

### Phase 6: Orchestration, Verification & Hardening
**Objective:** Provide an end-to-end CLI orchestrator with comprehensive edge-case handling and operational verification.

* **Task 6.1: CLI Runner & Pipeline Orchestrator (`run_pipeline.py`)**
  * Support CLI arguments: `--skip-scrape`, `--provider {gemini,groq}`, `--sources {app_store,play_store,reddit,youtube}`, `--months N`.
  * Auto-load environment variables via `python-dotenv`.
  * Lazy import heavy ML modules to provide sub-second `--help` response times.
* **Task 6.2: End-to-End Pipeline Verification (`test_pipeline.py`)**
  * Validate clean disk handoffs across `data/raw/*.jsonl` $\rightarrow$ `data/processed/unified_corpus.parquet` $\rightarrow$ `data/processed/clustered_corpus.parquet` $\rightarrow$ `data/processed/themes.json`.
  * Test suite verifying emoji removal, language filtering, date parsing, checkpointing, and quote grounding.

---

## 3. Component File & Responsibility Matrix

| Component | Target File | Action | Key Responsibilities |
| :--- | :--- | :--- | :--- |
| **Resilience Engine** | [`scrapers/utils.py`](file:///c:/Users/navi6/Downloads/myntra-wishlist-discovery_1/myntra-wishlist-discovery/scrapers/utils.py) | Active | `JsonlWriter`, `load_checkpoint`, `save_checkpoint`, `@retry_with_backoff`, `@async_retry_with_backoff`, `parse_datetime_safe` |
| **App Store Scraper** | [`scrapers/app_store_scraper.py`](file:///c:/Users/navi6/Downloads/myntra-wishlist-discovery_1/myntra-wishlist-discovery/scrapers/app_store_scraper.py) | Active | iTunes RSS async client, multi-country pagination, 10-page ceiling |
| **Play Store Scraper** | [`scrapers/play_store_scraper.py`](file:///c:/Users/navi6/Downloads/myntra-wishlist-discovery_1/myntra-wishlist-discovery/scrapers/play_store_scraper.py) | Active | `google-play-scraper` pagination, continuation tokens, adaptive throttling |
| **Reddit Scraper** | [`scrapers/reddit_scraper.py`](file:///c:/Users/navi6/Downloads/myntra-wishlist-discovery_1/myntra-wishlist-discovery/scrapers/reddit_scraper.py) | Active | RSS search feed parser + PRAW fallback, Hinglish handling, comment recursion |
| **YouTube Scraper** | [`scrapers/youtube_scraper.py`](file:///c:/Users/navi6/Downloads/myntra-wishlist-discovery_1/myntra-wishlist-discovery/scrapers/youtube_scraper.py) | Active | `youtube-comment-downloader` + Data API v3 search, relative date parsing |
| **Ingest & Privacy** | [`pipeline/ingest_normalize.py`](file:///c:/Users/navi6/Downloads/myntra-wishlist-discovery_1/myntra-wishlist-discovery/pipeline/ingest_normalize.py) | Active | Multi-source schema normalization, length filter ($\ge 15$), emoji removal, language filtering, 2-tier dedup, Presidio PII scrub |
| **Cluster Engine** | [`pipeline/cluster.py`](file:///c:/Users/navi6/Downloads/myntra-wishlist-discovery_1/myntra-wishlist-discovery/pipeline/cluster.py) | Active | `all-MiniLM-L6-v2` embeddings, UMAP ($384 \rightarrow 10$), HDBSCAN density clustering |
| **Theme Extraction** | [`pipeline/theme_extraction.py`](file:///c:/Users/navi6/Downloads/myntra-wishlist-discovery_1/myntra-wishlist-discovery/pipeline/theme_extraction.py) | Active | Structured Gemini/Groq LLM extraction, 10-question evaluation, grounded quote verification gate |
| **Pipeline Runner** | [`run_pipeline.py`](file:///c:/Users/navi6/Downloads/myntra-wishlist-discovery_1/myntra-wishlist-discovery/run_pipeline.py) | Active | End-to-end CLI orchestrator with checkpoint resume and provider selection |
| **Test Suite** | [`test_pipeline.py`](file:///c:/Users/navi6/Downloads/myntra-wishlist-discovery_1/myntra-wishlist-discovery/test_pipeline.py) | Active | Automated unit/integration tests for filtering, date parsing, and grounding gate |

---

## 4. Verification & Validation Plan

### Automated Verification
1. **Component Test Suite Execution:**
   ```bash
   python test_pipeline.py
   ```
   Validates date parsing, JSONL streaming, checkpointing, emoji detection, non-English script filtering, schema normalization, and the grounded quote validator gate.
2. **CLI Runner Check:**
   ```bash
   python run_pipeline.py --help
   ```
3. **Dry Run / Incremental Scrape Test:**
   ```bash
   python run_pipeline.py --sources app_store --months 1
   ```
