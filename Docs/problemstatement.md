# Myntra wishlist-to-purchase discovery engine — build spec

## 1. Context

**Case study framing:** Product Manager on Myntra's Growth Team. Strategic goal:
increase the percentage of users who purchase at least one wishlisted item within
30 days of adding it. Monetary incentives (discounts, coupons, cashback) are
explicitly out of scope as a solution lever.

**This document's scope:** Part 1 of the case study only — build an AI-powered
discovery engine that mines public user feedback at scale to surface *why*
wishlisted items don't convert, before any solution is proposed. The engine's
output (`themes.json`) is the evidence base a PM would use to write the actual
problem statement and design a non-monetary intervention. This spec is for
building that engine, not for the business problem statement itself — that
can only be written honestly after the engine has run against real data.

**Prior art this reuses:** Naveen's existing project [Imppulse](https://github.com/Navi-0212/Imppulse)
— a production-deployed review-intelligence pipeline (SentenceTransformers →
UMAP → HDBSCAN clustering, Presidio PII scrubbing, grounded-quote LLM
validation, n8n delivery layer). This build retargets that same architecture
at four new sources instead of Imppulse's original single review feed.

---

## 2. Goal statement

> Build a pipeline that ingests public user commentary about Myntra and
> Indian online fashion shopping from four sources, clusters it into
> behavioral themes without human pre-labeling, and produces a structured,
> evidence-grounded report answering ten specific research questions about
> wishlist behavior — with every claim traceable to a verbatim user quote.

**Definition of done:** running `python run_pipeline.py` end to end produces
`data/processed/themes.json`, where every theme has ≥1 grounded quote, and
every research question in §4 has been attempted against every cluster.

---

## 3. System architecture

| Stage | Module | Input | Output |
|---|---|---|---|
| 1. Scrape | `scrapers/*.py` | Live web/APIs | `data/raw/*.json` (per source) |
| 2. Normalize | `pipeline/ingest_normalize.py` | `data/raw/*.json` | `data/processed/unified_corpus.parquet` |
| 3. Cluster | `pipeline/cluster.py` | unified corpus | `data/processed/clustered_corpus.parquet` |
| 4. Theme | `pipeline/theme_extraction.py` | clustered corpus | `data/processed/themes.json` |

Each stage reads/writes to disk (not in-memory handoff) so any stage can be
re-run independently — critical for iterating on clustering parameters
without re-scraping, and for iterating on the LLM prompt without re-clustering.

### 3.1 Data sources and access method

| Source | Target | Access method | Auth required |
|---|---|---|---|
| App Store | Myntra iOS app, ID `907394059` | Apple public customer-reviews RSS feed | No |
| Play Store | `com.myntra.android` | `google-play-scraper` (public UI scrape) | No |
| Reddit | r/IndianFashionAddicts, r/india, r/IndianStreetwear, r/femalefashionadvice, r/malefashionadvice, r/IndianSkincareAddicts | Public `.rss` search feeds | No (PRAW optional upgrade) |
| YouTube | Haul/review/unboxing videos (manually seeded IDs) | `youtube-comment-downloader` | No (Data API v3 optional upgrade for search) |

**Design constraint honored:** the whole pipeline must run to completion with
zero paid or gated credentials, because credentials were not available at
build time, and Apify was ruled out as an upgrade path for the same reason
(usage-based cost, however small). Every upgrade path (PRAW, YouTube Data
API) is additive, never required.

**Reddit access method change (mid-build correction):** Reddit shut down
unauthenticated `.json` endpoint access on May 28–30, 2026 — no deprecation
window, requests now return 403 across the board. The scraper was rebuilt
against Reddit's `.rss` feeds instead (append `.rss` to any subreddit/search
URL), which were never part of the priced/blocked surface and are still
publicly reachable — the same access pattern the App Store scraper already
uses against Apple's RSS feed. **Known cost of this fix:** Reddit's RSS
feeds don't expose vote/score data or comment counts, so `engagement_score`
and `num_comments` are `null` for Reddit records — unlike Play/App Store
records, which keep their rating field. This doesn't block theme extraction
(it runs on text, not scores) but means Reddit records can't be ranked by
popularity within a cluster the way store reviews can.

### 3.2 Realistic volume ceiling per source (read before targeting 100k total)

Not every source can contribute meaningfully to a 100k-record target — this
is a platform limit, not an engineering gap, and no amount of async/retry
work changes it. An agent should treat the total as source-weighted, not
evenly split four ways.

| Source | Realistic ceiling (no auth) | Realistic ceiling (with auth upgrade) | Binding constraint |
|---|---|---|---|
| App Store | ~500–1,000 (across 2 storefronts) | Same — the RSS feed itself hard-caps at 10 pages × 50 reviews per storefront | Apple's API, not scraper quality |
| Play Store | Tens of thousands, depends on continuation-token exhaustion | Same (no official API exists; this *is* the ceiling) | Play Store review volume for the app itself |
| Reddit | Low thousands at most (RSS pagination is undocumented/best-effort, and rate-limited) | Still likely low thousands — there isn't 100k Reddit content about Myntra wishlists to find, regardless of auth | Topic scarcity, not access |
| YouTube | Bounded by how many video IDs you seed manually | Very high — Data API costs ~1 quota unit per 100 comments, 10k units/day ≈ up to ~1M comments/day theoretically | Quota + number of relevant videos that exist |

**Implication for the 100k target:** Play Store and an authenticated YouTube
pass are the two sources that can actually carry volume. Budget accordingly —
don't let an agent silently lower Reddit's dedup threshold or loosen App
Store's `MAX_PAGES` to chase a number those APIs cannot honestly provide.

---

## 4. Research questions the engine must answer

Every cluster gets evaluated against all ten — answered only where that
cluster's actual evidence supports it (`"no evidence in this cluster"` is a
valid and expected answer):

1. Why do users add fashion products to their wishlist?
2. What prevents wishlisted products from eventually being purchased?
3. What uncertainties remain after users have identified a product they like?
4. What causes users to postpone a purchase?
5. How do users compare multiple shortlisted products?
6. What information do users seek outside Myntra/AJIO before purchasing?
7. What role do fit, size, styling, price, reviews, occasion, and social validation play?
8. When is the wishlist genuine purchase intent vs. a bookmarking mechanism?
9. How do these behaviors differ across user segments?
10. What unmet needs emerge consistently across conversations?

Questions 9 and 10 are corpus-level, not per-cluster — they should be
answered in a synthesis pass over all `themes.json` entries (see §7), not
inside `theme_extraction.py` itself.

---

## 5. Module specifications

### 5.1 Scrapers (`scrapers/`)

**Common contract:** every scraper module exposes one public function
returning `list[dict]`, and each dict must carry at minimum:
`source`, `source_id`, `body`/`text`, `created_at`, `scraped_at`.
This shared contract is what makes `ingest_normalize.py` source-agnostic —
adding a fifth source later means writing one new scraper that returns this
shape, no changes to downstream stages.

| Requirement | Detail |
|---|---|
| Rate limiting | Sleep between requests (1–1.5s default) to avoid throttling/IP bans — non-negotiable, these are unauthenticated public endpoints |
| Idempotency | Re-running a scraper should be safe; dedup happens downstream in `ingest_normalize.py`, not in the scraper |
| Failure mode | A single failed page/post/video must not crash the whole run — catch, log, continue |
| Output | Each scraper's `__main__` block writes its own `data/raw/<source>.json` for independent testing |

**Added for scale (required once a scraper is expected to run past a few
thousand records — needed for Play Store and any authenticated YouTube pull):**

| Requirement | Detail |
|---|---|
| Concurrency | Convert to `asyncio` + `aiohttp` with a bounded `Semaphore` (e.g. 5–10 concurrent requests) instead of fully sequential `requests` calls — sequential scraping at 1.5s/request caps you at ~2,400/hour, which alone rules out reaching Play Store's real ceiling in reasonable time |
| Backoff | Exponential backoff with jitter on 429/5xx responses, not a flat sleep — a fixed delay either wastes time when the API is fine or isn't enough when it's actually throttling |
| **Incremental, append-only writes** | Write each batch/page to a `.jsonl` file (one JSON object per line, appended as scraped) — **never** accumulate the full result list in memory and write once at the end. At 100k+ records, a crash near the end with in-memory accumulation loses the entire run |
| Checkpointing / resumability | Persist the last successfully-scraped page/offset/continuation-token to a small state file per source, so a restarted run resumes instead of re-scraping from zero |
| Unified output field | Add `engagement_score` (upvotes / thumbs_up / likes, whichever the source has) to every scraper's output — useful later for picking representative quotes within a cluster |

### 5.2 Ingestion & normalization (`pipeline/ingest_normalize.py`)

| Step | Detail |
|---|---|
| Schema unification | Collapse source-specific fields (`title`+`body`, `content`, `selftext`, comment `text`) into one `text` field |
| Noise filtering | Drop records where `len(text) < 15` chars — too short to carry a theme |
| Deduplication | On `(source, source_id)` first, then exact-text dedup (catches cross-posted Reddit content) |
| PII scrubbing | Presidio analyzer + anonymizer over every `text` field before it reaches embeddings or LLM prompts — users sometimes paste emails, phone numbers, order IDs into reviews when frustrated |
| Output schema | `doc_id, source, source_id, text, rating, author, created_at, url, context` |

### 5.3 Embedding & clustering (`pipeline/cluster.py`)

| Parameter | Value | Rationale |
|---|---|---|
| Embedding model | `all-MiniLM-L6-v2` | Fast, strong enough for short review/comment-length text; avoid larger models unless clustering quality demands it |
| UMAP `n_neighbors` | 15 | Standard default; lower if corpus < 500 docs |
| UMAP `n_components` | 10 | Reduce before clustering — HDBSCAN degrades in raw embedding dimensionality |
| HDBSCAN `min_cluster_size` | 25 | Tune down for smaller corpora; a cluster smaller than this isn't a "theme," it's noise |
| Noise handling | HDBSCAN's `-1` label is preserved, not discarded | Rare-but-sharp complaints often fail to cluster because too few users phrase them identically — worth a manual pass |

### 5.4 Theme extraction (`pipeline/theme_extraction.py`)

| Requirement | Detail |
|---|---|
| Prompt | Feeds up to 20 sampled verbatim docs per cluster + the 10 research questions (see §4) |
| Output schema | `theme_label, theme_summary, research_question_answers, supporting_quotes, user_segment_signal` |
| **Grounded quote validation** | Every `supporting_quotes` entry must be an exact verbatim substring of a source doc. Non-matching quotes are stripped and the prompt is retried (max 2 retries) with the rejected quotes flagged. This is the load-bearing quality gate — without it, an LLM will produce plausible-sounding "user said X" quotes that no one actually said, which would undermine the credibility of any problem statement built on top |
| LLM provider | Gemini (default) or Groq — swappable via `--provider` flag |
| Cluster `-1` | Explicitly excluded from theme labeling (see §5.3) |
| **Structured output mode** | Use the provider's native structured-output feature (Gemini `response_schema`, or tool-use/function-calling on other providers) instead of prompting for JSON and regex-stripping markdown fences. This removes most of the parse-failure retries, which matters once you're running theme extraction across dozens of clusters instead of testing on one |

**Why this stays cluster-level, not per-document:** an alternative design
classifies *every* scraped review individually via LLM (e.g. `primary_friction`,
`wishlist_intent` enums per record). At 100k documents that's 100k LLM calls —
expensive, slow, and largely redundant with what clustering already gives
you for free. This pipeline's LLM cost scales with **cluster count**
(typically 50–200), not corpus size, because clustering does the grouping
work mechanically and the LLM only has to interpret each group once.

**Optional stretch, not baseline:** if per-document structured tags
(friction type, sentiment) are wanted for a macro dashboard later, run that
classification on a **stratified random sample** (e.g. 2,000–5,000 docs,
proportional to source/cluster) rather than the full corpus — keeps cost
bounded while still producing chartable aggregate stats.

---

## 6. Non-functional requirements

| Requirement | Why |
|---|---|
| Each pipeline stage independently re-runnable from disk | Iterating on cluster params (§5.3) shouldn't require re-scraping; iterating on the prompt (§5.4) shouldn't require re-clustering |
| No hard dependency on any single paid API | Build-time constraint: zero credentials available at start |
| PII scrubbing runs before any data reaches an LLM or leaves local storage | User privacy — reviews are public but individuals didn't consent to LLM processing of pasted personal info |
| Every downstream claim traceable to a raw source doc | Required for the eventual problem statement to be defensible — "users complain about X" needs to survive "show me one" |
| No single API failure or timeout crashes the run | Log and continue at record/page level — a run scraping tens of thousands of records *will* hit intermittent 429s/timeouts; treating them as fatal makes the pipeline unusable at scale |
| Progress survives a crash or manual interruption | Incremental writes + checkpointing (§5.1) — a multi-hour scrape run must be resumable, not restart-from-zero |
| Volume claims are honest per source | Don't silently under-deliver against a flat "100k" target by loosening dedup or pagination limits — see §3.2 for what each source can actually provide |

---

## 7. Out of scope for this build (explicitly deferred)

- **The actual business problem statement and non-monetary solution** — this
  requires running the engine against real data first; writing it now would
  mean inventing findings. This is the PM synthesis step the case study is
  testing, and no coding tool should attempt to auto-generate it.
- **Cross-cluster / corpus-level synthesis** (research questions 9–10 in §4)
  — a manual or lightly-assisted second pass over `themes.json`, not part
  of the automated pipeline.
- **A UI/dashboard for browsing themes** — `themes.json` is the deliverable;
  visualization is a nice-to-have, not a requirement. See §9 appendix for a
  scoped version if you want one later.
- **Sentiment scoring** — not asked for in the research questions; adding it
  would be scope creep unless a specific question in §4 needs it.
- **Postgres / vector DB / Docker / cron-scheduled production deployment** —
  legitimate for a real product, disproportionate for producing a defensible
  problem statement. `themes.json` + the parquet files are sufficient
  deliverables. See §9 appendix if you want to build this anyway as a
  portfolio piece.
- **Per-document LLM classification at full corpus scale** — see the note
  in §5.4; cluster-level extraction is the primary approach, per-doc tagging
  is an optional sampled stretch, not a baseline requirement.
- **Apify (or any paid scraping service) for Reddit** — evaluated after
  Reddit's `.json` shutdown made this a live question. Apify actors handle
  proxy rotation and anti-bot evasion, which is real value given Reddit's
  updated Rule 8 now explicitly names unauthorized scraping — but every
  actor is usage-priced (roughly $0.28–$3.40 per 1,000 results depending on
  actor/tier), and the zero-paid-credentials constraint from §3.1 ruled it
  out. Reddit's `.rss` feeds cover the same need for free. Revisit only if
  RSS pagination proves too unreliable in practice to hit even the "low
  thousands" ceiling in §3.2.

---

## 8. Suggested build order for Antigravity/Cursor

1. Scaffold the four scrapers against real endpoints, verify each produces
   valid JSON in `data/raw/` (this is the only stage requiring live network
   access to non-package-registry domains — do this first and iteratively).
2. Populate `scrapers/youtube_scraper.py:SEED_VIDEO_IDS` manually (15–20
   Myntra haul/review video IDs) — no-key mode can't search.
3. Run `ingest_normalize.py`, inspect `unified_corpus.parquet` row count and
   a text sample — sanity-check before spending compute on embeddings.
4. Run `cluster.py`, inspect cluster count and noise ratio; tune
   `min_cluster_size` if you get either 1 giant cluster or 40 tiny ones.
5. Run `theme_extraction.py` on a small subset first (5 clusters) to
   validate prompt quality and grounded-quote rejection rate before
   spending LLM calls on the full corpus.
6. Full `run_pipeline.py` run, sized against the realistic ceilings in §3.2
   rather than a flat 100k-across-all-sources assumption.

---

## 9. Appendix: production-grade stretch scope (not required for the case study)

If you want to take this beyond the case study deliverable into a portfolio
piece with a real dashboard, this is a reasonable Phase 2 — but treat it as
strictly additive, after `themes.json` already exists and is good:

| Addition | Purpose |
|---|---|
| PostgreSQL | Store structured per-document tags (if you built the optional sampled classifier from §5.4) for filtering by platform/date/friction type |
| Vector DB (pgvector/Qdrant) | Enables a semantic search bar over the corpus — "what are users saying about sizing charts" — separate from the cluster-level theme report |
| Streamlit or lightweight React dashboard | Macro view (friction frequency, sentiment over time) from Postgres; micro view (RAG-style search) from the vector DB |
| Docker Compose | Bundles DB + processing + dashboard for one-command local spin-up |

This appendix intentionally does not specify exact schemas or configs —
decide these only once the discovery output (§2 definition of done) exists
and you know what a dashboard actually needs to show.
