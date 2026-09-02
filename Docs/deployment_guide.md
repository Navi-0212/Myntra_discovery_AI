# Complete Deployment Guide: Myntra Wishlist Discovery Engine
## Deploying Backend on Railway & Frontend on Vercel

This guide provides step-by-step instructions to deploy the **Myntra Wishlist Discovery Engine** across a distributed cloud topology:
- **Backend (FastAPI, Parquet Data Layer & LLM Inference):** Deployed on **Railway**
- **Frontend (PM Discovery Dashboard & Visual Lens):** Deployed on **Vercel**

```
┌──────────────────────────────────────────────────────────┐
│                   VERCEL (Frontend)                      │
│   - Hosts static PM Discovery Dashboard (HTML/CSS/JS)   │
│   - Global Edge CDN Distribution                         │
│   - Live Analytics, Discovery Matrix, AI Assistant UI    │
└────────────────────────────┬─────────────────────────────┘
                             │
                  HTTPS / REST API Requests
             (/api/status, /api/themes, /api/ask)
                             │
                             ▼
┌──────────────────────────────────────────────────────────┐
│                   RAILWAY (Backend)                      │
│   - Python 3.11 / FastAPI Containerized Service          │
│   - CORS enabled for Vercel origin                       │
│   - Pre-loaded Parquet & JSON discovery datasets         │
│   - Groq / Gemini LLM Integration Engine                 │
│   - Health checks & background async pipeline execution  │
└──────────────────────────────────────────────────────────┘
```

---

## Prerequisites

Before beginning, ensure you have:
1. A **GitHub** account with this repository pushed to your remote.
2. A **Railway** account ([railway.app](https://railway.app)).
3. A **Vercel** account ([vercel.com](https://vercel.com)).
4. An API Key for either:
   - **Groq** ([console.groq.com](https://console.groq.com/keys)) — Recommended for blazing-fast inference.
   - **Google Gemini** ([aistudio.google.com](https://aistudio.google.com/app/apikey)).

---

## Part 1: Deploy Backend on Railway

### Step 1.1: Create a New Project on Railway
1. Log in to [Railway](https://railway.app/dashboard).
2. Click **"+ New Project"** in the top right.
3. Select **"Deploy from GitHub repo"**.
4. Select your `myntra-wishlist-discovery` repository.

### Step 1.2: Configure Build Settings
Railway will automatically detect the `Dockerfile` and `railway.toml` in the repository root.
- **Builder:** Dockerfile (Auto-detected via `Dockerfile`)
- **Port:** Dynamically assigned by Railway via `$PORT` (defaults to `8000`)

### Step 1.3: Set Environment Variables
1. In your Railway project dashboard, click on the newly created service.
2. Navigate to the **"Variables"** tab.
3. Click **"+ New Variable"** (or **"Raw Editor"**) and add the following keys:

| Variable Name | Value / Description | Required? |
| :--- | :--- | :--- |
| `GROQ_API_KEY` | `gsk_...` (Your Groq API Key) | Recommended |
| `GEMINI_API_KEY` | `AIza...` (Your Google Gemini Key) | Optional |
| `PORT` | `8000` (Railway will override dynamically) | Optional |
| `ALLOWED_ORIGINS` | `*` (or your Vercel URL e.g. `https://myntra-lens.vercel.app`) | Optional |
| `ENV` | `production` | Recommended |

### Step 1.4: Generate a Public Domain
1. In your service settings, navigate to the **"Settings"** tab.
2. Scroll down to the **"Networking"** section.
3. Click **"Generate Domain"** (e.g. `myntra-discovery-backend-production.up.railway.app`).
4. **Copy this domain** — you will use it in Part 2.

### Step 1.5: Verify Railway Backend Health
Open a browser tab or terminal and verify that the backend is healthy:
```bash
curl https://YOUR-RAILWAY-APP.up.railway.app/health
```
**Expected Response:**
```json
{
  "status": "ok",
  "service": "myntra-wishlist-discovery-engine",
  "timestamp": "2026-09-02T07:30:00Z",
  "has_processed_data": true
}
```

You can also test the status endpoint:
```bash
curl https://YOUR-RAILWAY-APP.up.railway.app/api/status
```

---

## Part 2: Deploy Frontend on Vercel

### Step 2.1: Import Project to Vercel
1. Log in to [Vercel](https://vercel.com/dashboard).
2. Click **"Add New..."** $\rightarrow$ **"Project"**.
3. Import your GitHub repository `myntra-wishlist-discovery`.

### Step 2.2: Configure Project Settings
- **Framework Preset:** `Other`
- **Root Directory:** `./` (Leave as default root)
- **Build Command:** *(Leave empty)*
- **Output Directory:** *(Leave empty, handled by `vercel.json`)*

### Step 2.3: Connect Frontend to Railway Backend

There are **two seamless methods** to connect your Vercel frontend to your Railway backend:

#### Option A: Automatic Proxy Rewrites via `vercel.json` (Recommended)
Edit `vercel.json` in your repository before deploying, replacing `YOUR-RAILWAY-APP.up.railway.app` with your actual Railway public domain:
```json
{
  "version": 2,
  "rewrites": [
    {
      "source": "/api/:path*",
      "destination": "https://YOUR-RAILWAY-APP.up.railway.app/api/:path*"
    },
    {
      "source": "/health",
      "destination": "https://YOUR-RAILWAY-APP.up.railway.app/health"
    },
    {
      "source": "/static/:path*",
      "destination": "/static/:path*"
    },
    {
      "source": "/",
      "destination": "/static/index.html"
    },
    {
      "source": "/:path*",
      "destination": "/static/:path*"
    }
  ]
}
```
*Benefits: Eliminates all cross-origin browser issues; all API calls seamlessly route through the Vercel edge proxy.*

#### Option B: Direct Cross-Origin Connection (Zero-Config)
1. Deploy to Vercel directly.
2. Open your deployed Vercel site in your browser.
3. Click on the **"Engine Live / Connect API"** status pill in the top right header.
4. Paste your Railway backend URL (e.g. `https://myntra-discovery-backend-production.up.railway.app`) into the prompt and press Enter.
5. The dashboard will instantly connect and persist your backend URL across sessions in browser storage!

### Step 2.4: Deploy
Click **"Deploy"** in Vercel. Within 15–30 seconds, your site will be live across Vercel's global edge network!

---

## Part 3: End-to-End Verification Checklist

| Test Item | Verification Method | Expected Result |
| :--- | :--- | :--- |
| **Backend Liveness** | Visit `https://YOUR-RAILWAY-APP.up.railway.app/health` | Returns HTTP 200 with `has_processed_data: true` |
| **Dashboard Analytics** | Open Vercel URL, view charts in Tab 1 | 3 interactive Chart.js graphs render conversion friction data |
| **Behavioral Matrix** | Scroll to Discovery Matrix table | Full research dimensions loaded with segment chips |
| **Synthesized Themes** | Click Tab 2 ("Discovery Themes") | Thematic cards with verbatim grounded quotes & copy buttons |
| **AI Assistant** | Click Tab 3 ("PM Intelligence Assistant") | Ask "Why do shoppers abandon wishlist kurtas?" $\rightarrow$ Returns structured PM recommendations |
| **Corpus Search** | Click Tab 4 ("Corpus Explorer") | Filter by source (YouTube/Play Store) $\rightarrow$ Displays paginated reviews |
| **Pipeline Runner** | Click Tab 5 ("Pipeline Runner") | View engine status, logs, and trigger controls |

---

## Troubleshooting & FAQ

### 1. The status pill says "Connect API" or charts are blank
* **Cause:** The Vercel frontend cannot reach the backend API.
* **Fix:** Click the status pill in the top right header and enter your Railway URL (e.g., `https://myntra-discovery-backend-production.up.railway.app`), or verify the destination in `vercel.json`.

### 2. CORS error in browser console
* **Cause:** Browser blocked request from Vercel domain to Railway domain.
* **Fix:** The backend includes `CORSMiddleware` with wildcard support. If you restricted `ALLOWED_ORIGINS` in Railway environment variables, ensure your Vercel URL (e.g. `https://your-project.vercel.app`) is included in the comma-separated list.

### 3. AI Assistant returns fallback synthesis
* **Cause:** `GROQ_API_KEY` or `GEMINI_API_KEY` is not configured in Railway variables.
* **Fix:** Add your API key in Railway under **Variables**, which will trigger an automatic zero-downtime redeployment.

### 4. Railway deployment timeout or high build time
* **Cause:** Compiling native C++ wheels for ML packages during container build.
* **Fix:** The provided `Dockerfile` uses Debian-based `python:3.11-slim` with `build-essential` and cached pre-built wheels, finishing in under 90 seconds.
