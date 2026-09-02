# Myntra Wishlist Discovery Engine — Project Context & Specification

## 1. Project Background & Case Study Framing

* **Role & Objective:** Product Manager on Myntra's Growth Team. The strategic goal is to increase the percentage of users who purchase at least one wishlisted item within 30 days of adding it.
* **Core Constraint:** Monetary incentives (discounts, flash coupons, cashback, price-drop vouchers) are **strictly out of scope** as a solution lever. The solution must address behavioral, informational, experiential, or structural friction.
* **Part 1 Scope (This Engine):** Build an AI-powered discovery and intelligence engine that mines public customer commentary at scale to uncover *why* wishlisted items do not convert into purchases. The output (`data/processed/themes.json`) serves as the factual evidence base.
* **Part 2 Scope (PM Synthesis — Explicitly Out of Scope for Pipeline):** The final business problem statement and proposed non-monetary product solution must be synthesized by the PM based on real data surfaced by the engine. The pipeline should not hallucinate or auto-generate synthetic findings.
* **Prior Art & Heritage:** Reuses the proven architecture from Naveen's [Imppulse](https://github.com/Navi-0212/Imppulse) review-intelligence pipeline (SentenceTransformers $\rightarrow$ UMAP $\rightarrow$ HDBSCAN clustering, Presidio PII scrubbing, grounded-quote LLM verification, and n8n orchestration), retargeted at four distinct public feedback channels.

---

## 2. Core Goal & Definition of Done

> **Goal:** Ingest public user commentary regarding Myntra and Indian fashion e-commerce from four diverse sources, cluster comments into emergent behavioral themes without pre-labeled taxonomy, and produce a structured, evidence-grounded report answering ten specific research questions—with every claim grounded in verbatim user quotes.

### Definition of Done (DoD)
Running `python run_pipeline.py` end-to-end executes:
1. Ingestion of raw data from App Store, Play Store, Reddit, and YouTube into `data/raw/` (`.jsonl` format).
2. Schema normalization, noise filtering, and PII anonymization into `data/processed/unified_corpus.parquet`.
3. Dense embeddings and unsupervised clustering into `data/processed/clustered_corpus.parquet`.
4. Theme extraction with strict grounded quote validation into `data/processed/themes.json`, where:
   * Every extracted theme contains $\ge 1$ verified verbatim quote from the raw data.
   * Every research question (Questions 1–8) is answered per cluster (or marked `"no evidence in this cluster"`).
   * HDBSCAN's noise cluster (`-1`) is preserved for manual review and omitted from automated theme labeling.

---

## 3. System Architecture & Pipeline Stages

```
   ┌─────────────────────────────────────────────────────────────┐
   │ 1. Data Collection (scrapers/)                              │
   │    App Store (RSS) | Play Store | Reddit (RSS) | YouTube   │
   └──────────────────────────────┬──────────────────────────────┘
                                  │ data/raw/*.jsonl (incremental + checkpoints)
                                  ▼
   ┌─────────────────────────────────────────────────────────────┐
   │ 2. Normalization & Scrubbing (pipeline/ingest_normalize.py) │
   │    Schema unification | Length filter | Dedup | Presidio PII│
   └──────────────────────────────┬──────────────────────────────┘
                                  │ data/processed/unified_corpus.parquet
                                  ▼
   ┌─────────────────────────────────────────────────────────────┐
   │ 3. Embedding & Clustering (pipeline/cluster.py)             │
   │    all-MiniLM-L6-v2 | UMAP dimensionality reduction| HDBSCAN│
   └──────────────────────────────┬──────────────────────────────┘
                                  │ data/processed/clustered_corpus.parquet
                                  ▼
   ┌─────────────────────────────────────────────────────────────┐
   │ 4. Theme Extraction & Validation (pipeline/theme_extract.py)│
   │    Gemini / Groq structured output | Grounded Quote Gate    │
   └──────────────────────────────┬──────────────────────────────┘
                                  │
                                  ▼
                     data/processed/themes.json
```

### Decoupled Disk-Based Stages
Each stage reads from and writes to disk (Parquet/JSONL) rather than passing in-memory state. This allows:
* Re-clustering without re-scraping.
* Re-prompting LLMs without re-computing embeddings or clusters.
* Incremental resumption upon network or rate-limit interruption.

---

## 4. Data Sources, Scraping Strategy & Volume Ceilings

### 4.1 Zero-Credential Baseline & Upgrade Paths
The system is designed to run end-to-end with **zero paid credentials**. Upgrades are strictly additive.

| Source | Target / Scope | Access Method (No Auth) | Authenticated Upgrade Path |
| :--- | :--- | :--- | :--- |
| **App Store** | Myntra iOS (`ID: 907394059`) | Apple Customer Reviews Public RSS Feed | N/A (RSS is public ceiling) |
| **Play Store** | `com.myntra.android` | `google-play-scraper` (public UI scraping) | N/A (Pagination continuation tokens) |
| **Reddit** | r/IndianFashionAddicts, r/india, r/IndianStreetwear, r/femalefashionadvice, r/malefashionadvice, r/IndianSkincareAddicts | Public `.rss` search feeds (rebuilt after May 2026 unauth `.json` shutdown) | PRAW (Reddit Script App Client ID/Secret) |
| **YouTube** | Hauls, try-on reviews, sizing guides | `youtube-comment-downloader` (web client scrape on manually seeded video IDs) | YouTube Data API v3 (Search + CommentThreads) |

### 4.2 Realistic Volume Ceilings (Honest 100k Target Accounting)
Volume targets cannot be split evenly across sources due to platform-enforced constraints:

| Source | Realistic Volume Ceiling | Binding Constraint |
| :--- | :--- | :--- |
| **App Store** | ~500 – 1,000 | Apple RSS feed hard-caps at 10 pages $\times$ 50 reviews per storefront. |
| **Play Store** | **Tens of thousands (Primary Volume)** | Bounded only by total public review count and continuation-token limits. |
| **Reddit** | Low thousands (~1k – 3k) | Search endpoint pagination limits and topic scarcity. |
| **YouTube** | Bounded by seed list (No Key) / **Hundreds of thousands (With API Key)** | YouTube Data API quota (~10k units/day; comment fetching costs ~1 unit/100 comments). |

> **Key Rule:** Play Store and an authenticated YouTube pass carry the vast majority of volume. Scrapers must never lower deduplication thresholds or fake volume to artificially meet a 100k number.

### 4.3 Scraping Robustness & Scale Requirements
* **Concurrency:** `asyncio` + `aiohttp` with bounded `Semaphore` (5–10 concurrent workers) for high-throughput sources.
* **Resilience:** Exponential backoff with jitter on 429/5xx status codes; never crash the run on single-record failures.
* **Incremental Writes:** Append-only `.jsonl` streaming—never hold entire corpora in memory before dumping.
* **Checkpoints:** State files in `data/checkpoints/` track offsets, pagination tokens, or video IDs to resume seamlessly after interruptions.
* **Standard Record Contract:** Each scraper outputs: `source`, `source_id`, `text`, `rating` (or `null`), `author`, `created_at`, `scraped_at`, `url`, `context`, and `engagement_score` (upvotes/likes when available; `null` for Reddit RSS).

---

## 5. Normalization, Clustering & Theme Extraction Specifications

### 5.1 Ingestion & Normalization (`pipeline/ingest_normalize.py`)
1. **Schema Unification:** Merges disparate fields (`body`, `content`, `selftext`, `comment_text`) into a standardized `text` column.
2. **Noise Filtering:** Drops records where `len(text) < 15` characters (removes "good", "nice", "ok").
3. **Deduplication:** Two-tier deduplication: primary on `(source, source_id)`, secondary on exact normalized text.
4. **PII Scrubbing:** Mandatory Presidio Analyzer & Anonymizer pass over all text before local parquet storage or LLM submission (redacting emails, phone numbers, tracking/order numbers, credit card references).

### 5.2 Embedding & Clustering (`pipeline/cluster.py`)
* **Embedding Model:** `sentence-transformers/all-MiniLM-L6-v2` (high efficiency, optimized for sentence/paragraph semantic density).
* **Dimensionality Reduction:** UMAP (`n_neighbors=15`, `n_components=10`, `metric='cosine'`).
* **Density Clustering:** HDBSCAN (`min_cluster_size=25`, `min_samples=10`).
* **Noise Cluster Preservation:** Cluster `-1` (unclustered noise) is preserved in `clustered_corpus.parquet` for manual inspection, as high-signal, rare complaints often do not form dense clusters.

### 5.3 Theme Extraction & Grounded Quote Gate (`pipeline/theme_extraction.py`)
* **LLM Providers:** Google Gemini (default, via native `response_schema` structured output) or Groq (`--provider groq`).
* **Cost Efficiency at Scale:** Theme extraction is performed at the **cluster level** (interpreting 50–200 clusters with sampled verbatim documents) rather than per-document LLM calls. This keeps LLM costs fixed to cluster count rather than scaling linearly with 100k+ documents.
* **Grounded Quote Validation Gate (Load-Bearing):**
  * Every extracted quote in `supporting_quotes` must be a literal, exact verbatim substring of the input source documents for that cluster.
  * If hallucinated or paraphrased quotes are detected, they are discarded and the prompt is retried with rejected quotes flagged (max 2 retries).
  * Only clusters with valid grounded quotes are committed to `themes.json`.

---

## 6. The 10 Core Research Questions

Every cluster is evaluated against these ten discovery questions:

1. **Wishlist Intent:** Why do users add fashion products to their wishlist?
2. **Purchase Blockers:** What prevents wishlisted products from eventually being purchased?
3. **Post-Shortlisting Uncertainty:** What uncertainties remain after users identify a product they like?
4. **Postponement Drivers:** What causes users to postpone or abandon a purchase?
5. **Comparison Behaviors:** How do users compare multiple shortlisted products?
6. **External Information Search:** What information or validation do users seek outside Myntra/AJIO before buying?
7. **Decision Dimensions:** What specific roles do fit, size, styling, fabric/quality, price, reviews, occasion, and social validation play?
8. **Intent vs. Bookmarking:** When is the wishlist acting as genuine purchase intent versus an aspirational or casual bookmarking bucket?
9. **User Segment Differences:** How do these behaviors differ across user segments? *(Answered during corpus-level synthesis pass)*
10. **Consistent Unmet Needs:** What unmet product/experience needs emerge consistently across all channels? *(Answered during corpus-level synthesis pass)*

---

## 7. Non-Functional Requirements & Design Principles

* **Fault Tolerance & Resumability:** Checkpointing and append-only `.jsonl` ensure zero data loss during network drops or API throttling.
* **Traceability:** Every finding in `themes.json` is directly mapped back to source doc IDs, URLs, and exact verbatim quotes.
* **Zero Paid Barrier:** All baseline operations function without requiring paid API subscriptions or credit cards.
* **Privacy by Design:** Presidio PII scrubbing runs locally before text touches any external LLM endpoint.
* **Modularity:** Scrapers, normalization, clustering, and theme extraction operate independently via standardized file contracts.

---

## 8. Out of Scope (Explicitly Deferred)

1. **Auto-generated Problem Statement / Solution:** The pipeline provides empirical discovery data; PM strategic synthesis must be performed by the human product manager.
2. **Full-Corpus Per-Document LLM Tagging:** Processing 100k individual records via LLM is economically wasteful and redundant with dense clustering.
3. **Paid Scraping Vendors (e.g., Apify):** Excluded to preserve zero-cost barrier and reproducibility.
4. **Sentiment Scoring:** Not required by the research questions; focus is placed on qualitative behavioral friction.
5. **Production Infrastructure (Postgres, Vector DBs, Kubernetes):** Parquet files and structured JSON are the required deliverables for the discovery phase.

---

## 9. Appendix: Stretch Scope (Phase 2 Portfolio Enhancements)

If extending the project beyond the core discovery deliverable:
* **PostgreSQL + pgvector / Qdrant:** Store document vectors and metadata for ad-hoc semantic search.
* **Interactive Streamlit / React Dashboard:** Visual exploration of clusters, theme summaries, and verbatim quote search.
* **Docker Compose:** Containerized execution of scraping, processing, and visualization layers.
