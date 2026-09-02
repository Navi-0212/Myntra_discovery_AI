# Myntra Wishlist Discovery Engine & PM Intelligence Lens

> **AI-powered customer intelligence discovery engine and interactive PM analytics platform for solving the *Wishlist-to-Purchase conversion* problem on Myntra without monetary discounts.**

[![Python 3.11](https://img.shields.io/badge/python-3.11-blue.svg)](https://www.python.org/downloads/release/python-3110/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.100%2B-009688.svg?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![Deployed on Railway](https://img.shields.io/badge/Backend-Railway-0B0D0E.svg?logo=railway&logoColor=white)](https://railway.app)
[![Deployed on Vercel](https://img.shields.io/badge/Frontend-Vercel-000000.svg?logo=vercel&logoColor=white)](https://vercel.com)
[![LLM: Groq & Gemini](https://img.shields.io/badge/LLM-Groq%20%7C%20Gemini%201.5-f59e0b.svg)](https://groq.com)

---

## 🛠️ Complete Technology Stack

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                                 TECH STACK MATRIX                                │
├─────────────────────────┬───────────────────────────────┬────────────────────────┤
│ Layer                   │ Technology / Library          │ Purpose                │
├─────────────────────────┼───────────────────────────────┼────────────────────────┤
│ Multi-Channel Scraping  │ google-play-scraper           │ Play Store RPC stream  │
│                         │ youtube-comment-downloader    │ Video comment stream   │
│                         │ feedparser, aiohttp, requests │ Reddit RSS / App Store │
│                         │ praw, google-api-python-client│ Authenticated routes   │
├─────────────────────────┼───────────────────────────────┼────────────────────────┤
│ Data Normalization &    │ pandas, pyarrow               │ Parquet corpus storage │
│ Privacy / NER Scrubbing │ Microsoft Presidio Analyzer   │ Local PII entity NER   │
│                         │ Microsoft Presidio Anonymizer │ Phone/email redaction  │
├─────────────────────────┼───────────────────────────────┼────────────────────────┤
│ Semantic Embeddings &   │ SentenceTransformers (MiniLM) │ 384-d dense vectors    │
│ Geometric Clustering    │ UMAP (umap-learn)             │ Manifold reduction     │
│                         │ HDBSCAN                       │ Density clustering     │
├─────────────────────────┼───────────────────────────────┼────────────────────────┤
│ LLM Theme Extraction &  │ Groq (LLaMA 3.3 70B Versatile)│ High-speed synthesis   │
│ Grounded Quote Gate     │ Google Gemini 1.5 Flash       │ Structured outputs     │
│                         │ Python regex / AST validator  │ Verbatim quote gate    │
├─────────────────────────┼───────────────────────────────┼────────────────────────┤
│ Web Backend & REST API  │ FastAPI                       │ Asynchronous REST API  │
│                         │ Uvicorn (standard)            │ ASGI web server        │
│                         │ Pydantic v2                   │ Request validation     │
├─────────────────────────┼───────────────────────────────┼────────────────────────┤
│ Frontend Dashboard & UI │ HTML5, Vanilla CSS3 (Dark)    │ High-clarity PM UI     │
│                         │ Chart.js                      │ Interactive charts     │
│                         │ Marked.js                     │ Rich markdown parser   │
├─────────────────────────┼───────────────────────────────┼────────────────────────┤
│ Cloud & Deployment      │ Railway (Docker / Procfile)   │ Backend & ML Engine    │
│                         │ Vercel (Edge CDN & Rewrites)  │ Static UI & API proxy  │
└─────────────────────────┴───────────────────────────────┴────────────────────────┘
```

---

## 🏛️ System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Data Collection (scrapers/)                              │
│    App Store (RSS) | Play Store | Reddit (RSS) | YouTube    │
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

---

## 🚀 Key Features

1. **Zero-Credential Scraper Baseline:** Collects authentic commentary from Google Play Store, Apple App Store, Reddit fashion subreddits, and YouTube haul/try-on videos without requiring paid API keys.
2. **Microsoft Presidio Local PII Scrubbing:** Redacts names, phone numbers, and order IDs before text touches any ML or LLM layer.
3. **Unsupervised Geometric Clustering ($O(K)$ Cost Economics):** SentenceTransformers (`all-MiniLM-L6-v2`) $\rightarrow$ UMAP ($384 \rightarrow 10$) $\rightarrow$ HDBSCAN clustering compresses 124,000+ reviews into dense behavioral clusters, bounding LLM synthesis cost.
4. **Load-Bearing Grounded Quote Validation Gate:** Every quote attached to a theme or research question is programmatically verified as an exact verbatim substring of user commentary. Hallucinated or paraphrased quotes are rejected and re-prompted.
5. **Interactive PM Discovery Lens UI:**
   - **Dashboard Analytics:** Visual distribution of conversion friction points, theme sentiment, and user segment breakdowns.
   - **Discovery Themes:** Evidence-backed theme cards answering 10 PM case study research questions with verbatim quotes and one-click clipboard copying.
   - **PM Intelligence AI Assistant:** Ask ad-hoc exploratory questions grounded in the corpus.
   - **Corpus Explorer:** Paginated inspection of 124k+ cleaned reviews with source filters.
   - **Pipeline Runner:** Real-time web-based pipeline execution with live logs.

---

## 📦 Setup & Local Development

### 1. Clone & Install Dependencies
```bash
git clone https://github.com/Navi-0212/Myntra_discovery_AI.git
cd Myntra_discovery_AI

# Create virtual environment
python -m venv venv
# On Windows: venv\Scripts\activate
# On Linux/macOS: source venv/bin/activate

pip install -r requirements.txt
cp .env.example .env
```

### 2. Configure Environment Variables
Edit `.env` and add your LLM API keys:
```ini
GROQ_API_KEY=gsk_...
GEMINI_API_KEY=AIza...
```

### 3. Run the Local Server & UI
```bash
python server.py
```
Open your browser at `http://localhost:8000` to view the PM Discovery Lens.

---

## ⚡ CLI Pipeline Orchestration

Run the end-to-end data pipeline from the command line:

```bash
# Full end-to-end pipeline run (Scrape -> Ingest -> Cluster -> Theme)
python run_pipeline.py

# Skip scraping and cluster pre-existing raw JSONL data
python run_pipeline.py --skip-scrape

# Run with Groq LLaMA 3.3 70B instead of Google Gemini
python run_pipeline.py --provider groq

# Scrape specific sources with custom lookback window (months)
python run_pipeline.py --sources play_store youtube --months 18
```

---

## 🌐 Cloud Deployment

The repository is pre-configured for decoupled deployment:

### Backend on [Railway]
1. Create a New Project on [Railway](https://railway.app) $\rightarrow$ **"Deploy from GitHub repo"**.
2. Set Environment Variables: `GROQ_API_KEY` (or `GEMINI_API_KEY`), `ENV=production`.
3. In **Settings** $\rightarrow$ **Networking**, click **"Generate Domain"** (e.g. `https://myntra-backend.up.railway.app`).
4. Health check endpoint `/health` is automatically monitored.

### Frontend on [Vercel]
1. Import repository on [Vercel](https://vercel.com).
2. Set `vercel.json` rewrite to point to your Railway domain, or connect dynamically in the UI via the top header status pill.
3. Deploy!

For a full walkthrough, see [Docs/deployment_guide.md](Docs/deployment_guide.md).

---

## 📄 License
MIT License. Created by [Navi-0212](https://github.com/Navi-0212).
