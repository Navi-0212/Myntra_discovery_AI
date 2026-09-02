# Myntra Wishlist Discovery Engine — System Architecture & Technical Specification

## 1. Architectural Overview & Design Philosophy

The **Myntra Wishlist Discovery Engine** is an asynchronous, decoupled, multi-stage data mining and machine learning intelligence pipeline. Its architectural purpose is to ingest vast, unannotated streams of public customer sentiment regarding Myntra and Indian fashion e-commerce from four heterogeneous channels, reduce high-dimensional text to semantic clusters, and extract evidence-grounded behavioral themes answering ten foundational PM discovery questions.

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

### Core Design Principles
1. **Decoupled Disk Persistence:** Each pipeline stage consumes and emits persistent disk artifacts (`.jsonl`, `.parquet`, `.json`). No stage relies on volatile in-memory handoffs, enabling independent execution and hyperparameter tuning.
2. **Zero-Credential Baseline:** The primary pipeline operates entirely on open, unauthenticated endpoints with zero paid API dependencies. Authenticated routes (PRAW, YouTube Data API v3) serve as seamless drop-in upgrades.
3. **O(K) Cost Economics:** Rather than invoking LLM classification per raw document ($O(N)$ for $N \approx 100,000$, costing hundreds of dollars), unsupervised clustering compresses the corpus into $K$ dense behavioral themes ($K \approx 50-200$). The LLM only interprets cluster-level centroids, bounding operational cost.
4. **Load-Bearing Verbatim Validation:** LLMs cannot introduce hallucinated "user quotes." Every supporting quote is programmatically matched as an exact substring against raw source inputs before admission into `themes.json`.
5. **Fault-Tolerant Streaming:** Scrapers stream to append-only JSONL files with sub-second disk flushing and persistent JSON checkpoint state, preventing data loss on process termination.

---

## 2. Component-by-Component Deep Dive

### 2.1 Scraping Infrastructure & Resilience Engine (`scrapers/utils.py`)

The scraping subsystem is anchored by a shared utility engine providing durability, streaming persistence, and adaptive network backoff across both synchronous and asynchronous routines.

```
                              [ Scraper Execution ]
                                        │
                      ┌─────────────────┴─────────────────┐
                      ▼                                   ▼
             (Sync Function Call)               (Async Coroutine)
                      │                                   │
             @retry_with_backoff             async_retry_with_backoff
                      │                                   │
                      ├─────────► [ Try Execution ] ◄─────┤
                      │                   │               │
                      │          (Failure: 429/5xx)       │
                      │                   ▼               │
                      │       Compute Backoff Delay:      │
                      │   min(max_d, base * 2^attempt)    │
                      │    * UniformJitter(0.5, 1.5)      │
                      │                   │               │
                      │                   ▼               │
                      └───────── [ Sleep & Retry ] ───────┘
                                          │ (Success)
                                          ▼
                                   [ JsonlWriter ]
                                          │
                                 flush() -> Disk
                                          │
                                          ▼
                                  [ Checkpoint ]
                             save_checkpoint(name, state)
```

#### Technical Primitives:
* **`JsonlWriter`:** Encapsulates an append-only file descriptor. Every record is encoded to JSON, appended with a newline, and immediately synced via `file_handle.flush()`. Memory consumption remains $O(1)$.
* **Checkpoint Management (`load_checkpoint` / `save_checkpoint`):** State dictionaries store high-water marks (e.g., country pagination offsets, Play Store continuation tokens, processed Reddit subreddit/query tuples, YouTube video IDs).
* **Exponential Backoff with Full Jitter:**
  $$\text{Delay} = \min(\text{max\_delay}, \text{base\_delay} \times 2^{\text{attempt}}) \times \text{Uniform}(0.5, 1.5)$$
  Mitigates thundering-herd issues against public rate limits.

---

### 2.2 Source Scraper Modules (`scrapers/`)

#### A. Apple App Store Scraper (`scrapers/app_store_scraper.py`)
* **Endpoint:** `https://itunes.apple.com/{country}/rss/customerreviews/id={app_id}/sortBy=mostRecent/page={page}/json`
* **Target ID:** `907394059` (Myntra iOS App).
* **Concurrency Model:** Asynchronous execution (`aiohttp`) across country storefronts (`in`, `us`) using `asyncio.gather`.
* **Platform Constraints:** Apple enforces a strict server-side ceiling of 10 pages per storefront ($50 \text{ reviews/page} \times 10 = 500 \text{ reviews/storefront}$).
* **Checkpoint Unit:** Per-country `last_completed_page`.

#### B. Google Play Store Scraper (`scrapers/play_store_scraper.py`)
* **Underlying Engine:** `google-play-scraper` (reverse-engineers the web UI tokenized RPC).
* **Target Package:** `com.myntra.android`.
* **Volume Capability:** Primary volume driver (tens of thousands of records).
* **Pagination & Resumability:** Uses recursive continuation tokens. The state checkpoint records `continuation_token` and `total_fetched`.
* **Batch Configuration:** 200 reviews per batch, $1.0\text{s}$ throttling between batches, with safety ceiling parameter `max_batches=500` (up to 100,000 records).

#### C. Reddit Scraper (`scrapers/reddit_scraper.py`)
* **Architectural Context:** Rebuilt over Reddit `.rss` search feeds following Reddit's May 2026 unauthenticated `.json` API lockdown.
* **Target Subreddits:** `r/IndianFashionAddicts`, `r/india`, `r/IndianStreetwear`, `r/femalefashionadvice`, `r/malefashionadvice`, `r/IndianSkincareAddicts`.
* **Search Queries:** `"myntra"`, `"myntra wishlist"`, `"myntra return"`, `"myntra sizing"`.
* **Two-Level Ingestion:**
  1. Searches subreddit RSS (`https://www.reddit.com/r/{subreddit}/search.rss?q={query}&restrict_sr=1&sort=relevance`).
  2. Extracts post ID and queries post comment feed (`https://www.reddit.com/r/{subreddit}/comments/{post_id}.rss`).
* **Known Platform Tradeoff:** Reddit RSS does not expose vote tallies or comment counts; `engagement_score` is defaulted to `null`.
* **Authenticated Upgrade:** Supports PRAW (`praw.Reddit`) if `REDDIT_CLIENT_ID` is present in environment variables.

#### D. YouTube Scraper (`scrapers/youtube_scraper.py`)
* **Public Mode:** `youtube-comment-downloader` targeting video IDs specified in `SEED_VIDEO_IDS` (e.g., haul reviews, sizing try-ons, unboxing videos).
* **Authenticated Mode:** If `YOUTUBE_API_KEY` is present, automates video discovery via YouTube Data API v3 (`youtube.search().list`) across targeted search terms before fetching comment streams.
* **Extraction:** Scrapes up to 300 top comments per video sorted by popularity.

---

### 2.3 Ingestion, Normalization & Privacy Subsystem (`pipeline/ingest_normalize.py`)

This module transforms raw heterogeneous JSONL records into a clean, canonical, PII-scrubbed tabular corpus stored in Apache Parquet format.

```
  data/raw/*.jsonl
         │
         ▼
  [_load_jsonl] ──► Read lines defensively, skipping corrupted/truncated EOF lines
         │
         ▼
  [_unify_record] ──► Merge title + body -> text; map context (subreddit/video/country)
         │
         ▼
  [Noise Filter] ──► Drop records where len(text) < 15 characters
         │
         ▼
  [Emoji Filter] ──► Drop records containing any emojis or decorative pictographs (has_emoji)
         │
         ▼
  [Language Filter] ──► Drop non-English commentary & non-Latin scripts (is_english)
         │
         ▼
  [Deduplication] ──► Tier 1: drop_duplicates(subset=['source', 'source_id'])
                  ──► Tier 2: drop_duplicates(subset=['text'])
         │
         ▼
  [_scrub_pii] ──► Microsoft Presidio Analyzer (NER) + Anonymizer Engine
         │
         ▼
  data/processed/unified_corpus.parquet
```

#### Cleaning & Filtering Pipeline:
1. **Noise Filtration:** Drops low-signal short reviews (`len(text) < 15`).
2. **Emoji Removal Filter:** Uses regex and Unicode categories (`So`, `Sk`) to identify and remove all reviews containing emojis (`😍`, `👍`, `❤️`, `⭐`, etc.), ensuring only textually dense records remain.
3. **Language Filter:** Drops reviews written in non-English scripts (Devanagari, Tamil, Telugu, Bengali, Arabic, Cyrillic, CJK, etc.) and enforces English Latin character density heuristics.
4. **Two-tier Deduplication:** Eliminates exact duplicate platform IDs and identical repeated text comments.
5. **PII Anonymization:** Redacts emails, phone numbers, and order tracking numbers via Presidio.

#### Canonical Unified Corpus Schema:
| Column Name | Type | Description |
| :--- | :--- | :--- |
| `doc_id` | `int64` | Monotonically increasing unique document index |
| `source` | `string` | Origin identifier (`app_store`, `play_store`, `reddit`, `youtube`) |
| `source_id` | `string` | Source-specific identifier (review ID, post ID, comment ID) |
| `text` | `string` | Normalized, PII-scrubbed textual content |
| `rating` | `float64 / null` | Star rating (1–5) for App Store and Play Store; `null` for social |
| `engagement_score` | `int64 / null` | Likes, upvotes, or thumbs-up count |
| `author` | `string` | Username or author name |
| `created_at` | `string (ISO-8601)` | Timestamp of creation |
| `url` | `string` | Direct permalink or source reference |
| `context` | `string` | Originating subreddit, YouTube video ID, or App Store country |

---

### 2.4 Semantic Embedding & Unsupervised Clustering Subsystem (`pipeline/cluster.py`)

Unsupervised theme grouping operates via a three-tier geometric pipeline:

```
[Normalized Text Corpus] (N documents)
           │
           ▼  SentenceTransformer('all-MiniLM-L6-v2')
[Dense Embeddings] (N x 384 matrix)
           │
           ▼  UMAP(n_neighbors=15, n_components=10, metric='cosine', min_dist=0.0)
[Reduced Manifold] (N x 10 matrix)
           │
           ▼  HDBSCAN(min_cluster_size=25, min_samples=5, metric='euclidean', cluster_selection_method='eom')
[Cluster Labels & Probabilities]
           │
           ▼
[Clustered Corpus Parquet] (Appends `cluster_id`, `cluster_confidence`)
```

#### Algorithmic Parameters & Rationale:
1. **Embedding (`all-MiniLM-L6-v2`):** Converts variable-length text into 384-dimensional dense vectors. Selected for fast inference speed and high performance on semantic similarity benchmarks.
2. **Dimensionality Reduction (UMAP):**
   - High-dimensional vector spaces suffer from the curse of dimensionality, degrading density clustering.
   - Reduced from $384 \rightarrow 10$ dimensions.
   - `n_neighbors=15`: Balances local vs. global manifold structure.
   - `metric='cosine'`: Matches the directional semantic property of transformer embeddings.
   - `min_dist=0.0`: Maximizes cluster compaction for density estimation.
3. **Density Clustering (HDBSCAN):**
   - `min_cluster_size=25`: Enforces that an extracted theme must be backed by at least 25 independent user voices.
   - `min_samples=5`: Controls conservative cluster boundary formation.
   - `cluster_selection_method='eom'` (Excess of Mass): Extracts clusters of varying densities across the hierarchy.
   - **Noise Handling (`cluster_id = -1`):** Retains unclustered outlier records in the parquet dataset for forensic inspection without contaminating thematic clusters.

---

### 2.5 LLM Theme Extraction & Grounded Quote Gate (`pipeline/theme_extraction.py`)

This subsystem translates mathematical clusters into actionable, qualitative product discovery reports.

```
                      [ For Each Cluster k != -1 ]
                                    │
                                    ▼
                 [ Sample 20 Representative Documents ]
                                    │
                                    ▼
                 [ Format Prompt with 10 Research Questions ]
                                    │
                                    ▼
       ┌─────────────────────────────────────────────────────────┐
       │                 LLM INFERENCE ENGINE                    │
       │  Gemini 1.5 Flash (Native Structured response_schema)  │
       │                           OR                            │
       │  Groq LLaMA 3.3 70B (json_object mode)                 │
       └────────────────────────────┬────────────────────────────┘
                                    │
                                    ▼
                       [ Parse JSON Response ]
                                    │
                                    ▼
            ┌───────────────────────────────────────────────┐
            │        GROUNDED QUOTE VALIDATOR GATE          │
            │  For each quote in `supporting_quotes`:       │
            │    Check: quote.lower() in cluster_corpus?    │
            └───────────────┬───────────────────────────────┘
                            │
               ┌────────────┴────────────┐
               ▼ (Rejected Quotes > 0)   ▼ (0 Rejected)
      [ Attempt <= 2 ]                   [ Accept Theme ]
               │                                │
      Append rejected list                      ▼
      and re-prompt LLM                  Commit to themes.json
```

#### Provider Implementations:
1. **Google Gemini (`_call_gemini`):** Utilizes `gemini-1.5-flash` configured with native `response_schema` enforcing `THEME_RESPONSE_SCHEMA`. Guarantees deterministic structural compliance without markdown regex parsing.
2. **Groq (`_call_groq`):** Utilizes `llama-3.3-70b-versatile` with `response_format={"type": "json_object"}`.

#### Grounded Quote Validator Mechanism:
* **The Failure Mode:** LLMs routinely paraphrase or synthesize plausible-sounding user quotes (e.g., turning *"delivery was late and the kurta fabric was sheer"* into *"Users complained about late shipping and sheer kurtas"*).
* **The Verification Algorithm:**
  $$\forall q \in \text{supporting\_quotes}, \quad \text{clean}(q) \subseteq \bigcup_{d \in \text{Sample}} \text{clean}(d)$$
* If any quote fails exact substring containment, it is segregated into `rejected`. The prompt is dynamically appended with:
  `"NOTE: These quotes were REJECTED as not verbatim: {rejected}. Only quote exact substrings."`
  The engine retries up to 2 times before falling back to committing only verified quotes.

---

## 3. Thematic Discovery Evaluation Matrix

Every cluster is interrogated against the ten core case study discovery vectors:

```
+---------------------------------------------------------------------------------------------------+
|                                 DISCOVERY EVALUATION MATRIX                                       |
+----+----------------------------------+-----------------------+-----------------------------------+
| #  | Research Dimension               | Evaluation Scope      | Key Indicators Analyzed           |
+----+----------------------------------+-----------------------+-----------------------------------+
| 1  | Wishlist Intent                  | Cluster-Level         | Aspiration vs Immediate Basket    |
| 2  | Purchase Blockers                | Cluster-Level         | Sizing, Material, Delivery, Trust |
| 3  | Post-Shortlisting Uncertainty    | Cluster-Level         | Color accuracy, Fit consistency   |
| 4  | Purchase Postponement Drivers    | Cluster-Level         | Event delays, Cart abandonment    |
| 5  | Comparison Behaviors             | Cluster-Level         | Cross-platform (AJIO/Amazon)      |
| 6  | External Information Seeking     | Cluster-Level         | YouTube try-ons, Reddit reviews   |
| 7  | Multi-Factor Decision Drivers    | Cluster-Level         | Fit, Styling, Occasion, Reviews   |
| 8  | Genuine Intent vs. Bookmarking   | Cluster-Level         | Price tracker vs Moodboard        |
| 9  | User Segment Stratification      | Corpus Synthesis Pass | Price-sensitive, Occasion buyer   |
| 10 | Cross-Channel Unmet Needs        | Corpus Synthesis Pass | Universal product friction points |
+----+----------------------------------+-----------------------+-----------------------------------+
```

---

## 4. End-to-End Execution Flow (`run_pipeline.py`)

The pipeline execution is orchestrated by `run_pipeline.py` with standard CLI controls:

```bash
# Full end-to-end run (Scrape past 18 months -> Ingest -> Cluster -> Theme)
python run_pipeline.py

# Custom historical lookback window (e.g., past 12 or 24 months)
python run_pipeline.py --months 18

# Skip scraping and execute from local cached JSONL data
python run_pipeline.py --skip-scrape

# Execute with Groq LLaMA 3.3 instead of Google Gemini
python run_pipeline.py --provider groq

# Target specific scrapers
python run_pipeline.py --sources play_store youtube --months 18
```

### Execution Lifecyle:
```
1. CLI Argument Parsing (--skip-scrape, --provider, --sources, --months [default: 18])
   │
2. Stage 1: scrape_all(sources, months)
   ├─► fetch_app_store_reviews(months_back=18)   ──► data/raw/app_store_reviews.jsonl
   ├─► fetch_play_store_reviews(months_back=18)  ──► data/raw/play_store_reviews.jsonl
   ├─► fetch_reddit_public(months_back=18)       ──► data/raw/reddit_posts.jsonl
   └─► fetch_youtube_reviews(months_back=18)     ──► data/raw/youtube_comments.jsonl
   │
3. Stage 2: build_dataset()
   └─► Normalize + Dedup + PII Scrub ──► data/processed/unified_corpus.parquet
   │
4. Stage 3: run_clustering()
   └─► SentenceTransformers + UMAP + HDBSCAN ──► data/processed/clustered_corpus.parquet
   │
5. Stage 4: run_theme_extraction()
   └─► Structured LLM + Grounded Validator ──► data/processed/themes.json
```

---

## 5. Directory Structure & Artifact Layout

```
myntra-wishlist-discovery/
│
├── .env.example                     # Environment template (GEMINI_API_KEY, GROQ_API_KEY, etc.)
├── README.md                        # Quickstart documentation
├── requirements.txt                 # Python package dependencies
├── run_pipeline.py                  # Master orchestration CLI entrypoint
│
├── Docs/
│   ├── context.md                   # Strategic business context & spec
│   ├── architecture.md              # System technical architecture document (this file)
│   └── myntra-wishlist-discovery-problem-statement.md
│
├── data/
│   ├── raw/                         # Append-only JSONL files from scrapers
│   │   ├── app_store_reviews.jsonl
│   │   ├── play_store_reviews.jsonl
│   │   ├── reddit_posts.jsonl
│   │   └── youtube_comments.jsonl
│   │
│   ├── checkpoints/                 # Resumable scraper state files
│   │   ├── app_store.json
│   │   ├── play_store.json
│   │   ├── reddit.json
│   │   └── youtube.json
│   │
│   └── processed/                   # Intermediate and final ML/LLM artifacts
│       ├── unified_corpus.parquet   # Normalized, deduped, PII-scrubbed records
│       ├── clustered_corpus.parquet # Documents with cluster_id & confidence
│       └── themes.json              # Final validated thematic discovery report
│
├── scrapers/                        # Asynchronous & resilient data collection
│   ├── utils.py                     # JsonlWriter, Checkpoint, Backoff decorators
│   ├── app_store_scraper.py         # Apple RSS customer reviews client
│   ├── play_store_scraper.py        # Google Play Store pagination client
│   ├── reddit_scraper.py            # Reddit RSS / PRAW discussion scraper
│   └── youtube_scraper.py           # YouTube comment stream scraper
│
└── pipeline/                        # Data transformation & machine learning core
    ├── ingest_normalize.py          # Schema unification, noise filter, Presidio PII
    ├── cluster.py                   # SentenceTransformers -> UMAP -> HDBSCAN
    └── theme_extraction.py          # Gemini/Groq structured extraction + quote gate
```

---

## 6. Non-Functional Attributes & Failure Modes

| Dimension | Architectural Implementation | Worst-Case Failure Mode & Mitigation |
| :--- | :--- | :--- |
| **Data Loss Prevention** | Streaming `JsonlWriter` with immediate `flush()` | Process killed mid-stream $\rightarrow$ Last line JSON parse error gracefully skipped on next ingest. |
| **API Throttling (429s)** | Exponential backoff with random jitter $(0.5\times - 1.5\times)$ | Sustained IP ban $\rightarrow$ Checkpoint saves last offset; restart pipeline after cooldown. |
| **LLM Hallucination** | Substring grounding verification gate | LLM invents paraphrase $\rightarrow$ Re-prompted with rejected quote feedback loop up to 2 retries. |
| **PII & Data Privacy** | Microsoft Presidio local NER & anonymization | Sensitive user info in public comments $\rightarrow$ Scrubbed before parquet write or LLM egress. |
| **Memory Footprint** | Streaming JSONL, Parquet column compression | 100k+ records $\rightarrow$ Memory bounded during scraping; batch embeddings $(batch\_size=64)$. |
