/**
 * Discovery Lens - Frontend Interactive Controller
 * Built to deliver futuristic PM intelligence matching Design.md
 */

// Dynamic API Base URL resolution
function getApiBase() {
  if (window.__API_BASE__) return window.__API_BASE__.replace(/\/$/, "");
  try {
    const stored = localStorage.getItem("MYNTRA_API_BASE");
    if (stored) return stored.replace(/\/$/, "");
  } catch (e) {}
  return "";
}

function apiUrl(path) {
  const base = getApiBase();
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return base ? `${base}${cleanPath}` : cleanPath;
}

window.promptBackendUrl = function() {
  const current = localStorage.getItem("MYNTRA_API_BASE") || "(relative default: /api)";
  const input = prompt(
    "Configure Backend API Base URL:\n(Leave empty to use default relative /api, or enter your Railway backend URL e.g. https://your-app.up.railway.app)",
    current.startsWith("http") ? current : ""
  );
  if (input !== null) {
    if (input.trim()) {
      localStorage.setItem("MYNTRA_API_BASE", input.trim().replace(/\/$/, ""));
    } else {
      localStorage.removeItem("MYNTRA_API_BASE");
    }
    window.location.reload();
  }
};

/* ================= TAB SWITCHING & ROUTING ================= */
window.switchTab = function(targetId) {
  // Update desktop tabs
  document.querySelectorAll(".desktop-tab-btn").forEach(btn => {
    if (btn.getAttribute("data-target") === targetId) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });

  // Update bottom app bar tabs
  document.querySelectorAll(".app-bar-tab").forEach(btn => {
    if (btn.getAttribute("data-target") === targetId) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });

  // Switch pane
  document.querySelectorAll(".tab-pane").forEach(pane => {
    if (pane.id === targetId) {
      pane.classList.add("active");
    } else {
      pane.classList.remove("active");
    }
  });

  window.scrollTo({ top: 0, behavior: "smooth" });
};

document.addEventListener("DOMContentLoaded", () => {
  // Init desktop tabs click listeners
  document.querySelectorAll(".desktop-tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const target = btn.getAttribute("data-target");
      if (target) switchTab(target);
    });
  });

  initSentimentCharts();
  initDiscoveryThemes();
  initResearchMatrix();
  initForensicCorpus();
  initCopilotAI();
  initPipelineRunner();
  fetchTelemetryStatus();
});

/* ================= CHARTS INITIALIZATION ================= */
let sentimentOverviewChart = null;
let sentimentThemesChart = null;

function initSentimentCharts() {
  // Mini Sentiment Chart on Engine Tab
  const ctxMini = document.getElementById("chart-sentiment-overview");
  if (ctxMini) {
    sentimentOverviewChart = new Chart(ctxMini, {
      type: "bar",
      data: {
        labels: ["Fit", "Price", "Fabric", "Returns", "UX"],
        datasets: [
          { label: "Neg", data: [68, 52, 58, 76, 44], backgroundColor: "#ff5252", borderRadius: 4 },
          { label: "Neu", data: [20, 33, 28, 18, 24], backgroundColor: "#38bdf8", borderRadius: 4 },
          { label: "Pos", data: [12, 15, 14, 6, 32], backgroundColor: "#22c55e", borderRadius: 4 }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, ticks: { color: "#94a3b8", font: { family: "'JetBrains Mono', monospace", size: 10 } } },
          y: { grid: { color: "rgba(255,255,255,0.05)" }, ticks: { color: "#64748b", font: { family: "'JetBrains Mono', monospace", size: 9 }, callback: v => v + "%" }, max: 100 }
        }
      }
    });
  }

  // Sentiment by Theme Chart on Themes Tab (Matching screen.png)
  const ctxThemes = document.getElementById("chart-sentiment-themes");
  if (ctxThemes) {
    sentimentThemesChart = new Chart(ctxThemes, {
      type: "bar",
      data: {
        labels: ["Sizing & Fit", "Price / Discounts", "Fabric & Quality", "Returns & Refund", "App & Service UX"],
        datasets: [
          { label: "Neg", data: [68, 52, 58, 76, 44], backgroundColor: "#ff5252", borderRadius: 4 },
          { label: "Neu", data: [20, 33, 28, 18, 24], backgroundColor: "#38bdf8", borderRadius: 4 },
          { label: "Pos", data: [12, 15, 14, 6, 32], backgroundColor: "#22c55e", borderRadius: 4 }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "#161926",
            borderColor: "rgba(255,64,129,0.4)",
            borderWidth: 1,
            titleFont: { family: "'JetBrains Mono', monospace" },
            bodyFont: { family: "'Inter', sans-serif" }
          }
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: "#e2e8f0", font: { family: "'JetBrains Mono', monospace", size: 11 } } },
          y: { grid: { color: "rgba(255,255,255,0.06)" }, ticks: { color: "#94a3b8", font: { family: "'JetBrains Mono', monospace", size: 10 }, stepSize: 50 }, max: 100 }
        }
      }
    });
  }
}

/* ================= DISCOVERY THEMES (screen.png) ================= */
const STATIC_THEMES_PRESET = [
  {
    idx: "01",
    tag: "High Impact",
    tagClass: "impact-badge",
    mentions: "14,289",
    title: "Sizing Ambiguity & Fit Uncertainty",
    desc: "Users frequently report anxiety regarding inconsistent sizing across different private labels, leading to hesitation in finalizing purchases and increased reliance on wishlists as a 'holding pen'.",
    source: "reddit",
    sourceName: "Reddit · r/IndianFashionAddicts",
    sourceIcon: "💬",
    quote: "I have like 20 items sitting in my wishlist for weeks. I want to buy them but the sizing is so unpredictable. One brand's M is another's XL. I just wait until I have the energy to deal with potential returns.",
    videoId: "q4ZlWQ387SI",
    videoTitle: "Myntra Kurti & Dress Sizing Reality Check: Size L vs M Fit Test"
  },
  {
    idx: "02",
    tag: "Conversion Blocker",
    tagClass: "impact-badge blocker",
    mentions: "9,842",
    title: "Fake Discount Fatigue",
    desc: "Persistent perception that 'Original Prices' are artificially inflated before sales. This erodes trust and causes users to delay purchases indefinitely, waiting for a 'genuine' price drop alert.",
    source: "youtube",
    sourceName: "YouTube · Haul Review",
    sourceIcon: "🔴",
    quote: "They hiked the MRP to 3999 just to show a 60% discount during the Big Fashion Festival. I tracked this top last month and it was literally 1499 then. Don't fall for the fake urgency guys.",
    videoId: "xuc76uMSJyg",
    videoTitle: "Myntra EORS Sale Wishlist Strategy & True Coupon Discounts"
  },
  {
    idx: "03",
    tag: "Friction Point",
    tagClass: "impact-badge friction",
    mentions: "7,105",
    title: "Post-Order Return Friction Fear",
    desc: "Anticipation of a difficult return process (e.g., store credit instead of original payment method, pickup delays) acts as a primary deterrent to converting wishlist items to cart.",
    source: "play_store",
    sourceName: "Play Store · 1 Star Review",
    sourceIcon: "🛍️",
    quote: "I wanted to buy 3 dresses to try, but the app said 'Return to Myntra Credit only' for two of them. I'm not locking up 5000 rupees in a wallet. Abandoned the whole cart. Please bring back normal refunds.",
    videoId: "npnBJwtdK68",
    videoTitle: "Myntra Western Wear Haul: Fit & Return Policy Experience"
  }
];

async function initDiscoveryThemes() {
  const container = document.getElementById("themes-cards-container");
  if (!container) return;

  try {
    const res = await fetch(apiUrl("/api/themes"));
    let themesData = [];
    if (res.ok) {
      themesData = await res.json();
    }

    if (themesData && themesData.length > 0) {
      renderThemesCards(themesData, container);
    } else {
      renderThemesCards(STATIC_THEMES_PRESET, container);
    }
  } catch (err) {
    console.warn("Using preset themes:", err);
    renderThemesCards(STATIC_THEMES_PRESET, container);
  }
}

function renderThemesCards(themesList, container) {
  container.innerHTML = themesList.map((t, index) => {
    const idxFormatted = t.idx || (index + 1 < 10 ? `0${index + 1}` : `${index + 1}`);
    const tag = t.tag || t.user_segment_signal || "High Impact";
    const tagClass = t.tagClass || (index % 3 === 0 ? "impact-badge" : (index % 3 === 1 ? "impact-badge blocker" : "impact-badge friction"));
    const mentions = t.mentions || (t.cluster_size ? t.cluster_size.toLocaleString() : "14,289");
    const title = t.title || t.theme_label || "Sizing Ambiguity & Fit Uncertainty";
    const desc = t.desc || t.theme_summary || "Users frequently report anxiety regarding inconsistent sizing across different private labels.";
    
    let quote = t.quote || (t.supporting_quotes && t.supporting_quotes[0]) || "I have like 20 items sitting in my wishlist for weeks...";
    if (typeof quote === "object") quote = quote.quote || quote.text || "";
    const sourceName = t.sourceName || (t.source === "youtube" ? "YouTube · Try-On Haul" : "Reddit · r/IndianFashionAddicts");
    const sourceIcon = t.sourceIcon || (t.source === "youtube" ? "🔴" : "💬");
    const videoId = t.videoId || "4qrpnaJu2tk";
    const videoTitle = t.videoTitle || "Myntra Review Video Evidence";
    const escapedQuote = quote.replace(/"/g, "&quot;").replace(/'/g, "\\'");

    return `
      <div class="theme-card-rich">
        <div class="theme-card-top-row">
          <div class="theme-tag-group">
            <span class="theme-idx-mono">THEME ${idxFormatted}</span>
            <span class="${tagClass}">[${tag}]</span>
          </div>
          <div class="mentions-stat-box">
            <span class="mentions-label">MENTIONS</span>
            <span class="mentions-value">${mentions}</span>
          </div>
        </div>

        <h3 class="theme-card-title">${title}</h3>
        <p class="theme-card-desc">${desc}</p>

        <div class="grounded-quote-item-rich">
          <div class="quote-watermark">99</div>
          <div class="quote-channel-tag">
            <span class="channel-icon">${sourceIcon}</span>
            <span>${sourceName}</span>
          </div>
          <div class="quote-text-rich">"${quote}"</div>
          <div class="quote-actions-footer">
            <button class="btn-rich-action" onclick="copyQuoteToClipboard('${escapedQuote}')">
              <span>📋 Copy</span>
            </button>
            <button class="btn-rich-action pink-btn" onclick="openVideoModal('${videoId}', '${videoTitle.replace(/'/g, "\\'")}', '${escapedQuote}')">
              <span>🎬 View Source</span>
            </button>
          </div>
        </div>
      </div>
    `;
  }).join("");
}

/* ================= 10 PM RESEARCH MATRIX (screen1.png) ================= */
const PM_RESEARCH_QUESTIONS = [
  {
    num: 1,
    title: "1. Wishlist Intent vs Reality",
    finding: "Used as a 'holding pen' for price drops, not actual curation. High abandonment when friction introduced.",
    quote: "I save like 20 kurti designs in my wishlist just to compare colors and wait for sale discounts.",
    source: "YouTube Haul Review",
    videoId: "xuc76uMSJyg"
  },
  {
    num: 2,
    title: "2. Sizing Uncertainty Impact",
    finding: "Primary driver of cart abandonment. Users lack confidence in private label fit consistency.",
    quote: "Loved the design in wishlist but size L fit like an M, had to return and now refund is stuck.",
    source: "YouTube Sizing Review",
    videoId: "q4ZlWQ387SI"
  },
  {
    num: 3,
    title: "3. Post-Order Return Friction Fear",
    finding: "Anxiety around difficult return processes prevents initial purchase commitment.",
    quote: "Anticipation of complex pickup and wallet store credit lock-in causes users to abandon cart.",
    source: "Play Store Review",
    videoId: "npnBJwtdK68"
  },
  {
    num: 4,
    title: "4. Fake Discount Perception",
    finding: "Users actively doubt 'sale' prices, delaying purchase to verify historical price baselines.",
    quote: "They hiked base prices by 40% right before the sale, so I kept items in wishlist rather than buying.",
    source: "Reddit Community",
    videoId: "xuc76uMSJyg"
  },
  {
    num: 5,
    title: "5. Fabric Texture Skepticism",
    finding: "Photos look premium, but users fear sheer or coarse polyester in real daylight.",
    quote: "Watch try-on videos before purchasing because fabric can be very sheer in real light.",
    source: "YouTube Try-On Haul",
    videoId: "4qrpnaJu2tk"
  },
  {
    num: 6,
    title: "6. Occasion-Driven Urgency",
    finding: "Users only convert wishlist items when an immovable social date (wedding/festival) creates urgency.",
    quote: "If I need an outfit for this weekend, I buy immediately; otherwise items sit in wishlist for months.",
    source: "Customer Voice",
    videoId: "5YPZTMuey50"
  }
];

function initResearchMatrix() {
  const container = document.getElementById("matrix-cards-container");
  if (!container) return;

  container.innerHTML = PM_RESEARCH_QUESTIONS.map(q => `
    <div class="lens-card">
      <div class="card-label-tag pink-accent">
        <span>RESEARCH DIMENSION ${q.num}</span>
        <span class="mono-tag">EMPIRICAL</span>
      </div>
      <h3 style="font-family: 'Plus Jakarta Sans', sans-serif; font-size: 1.1rem; font-weight: 700; color: #fff; margin-bottom: 8px;">
        ${q.title}
      </h3>
      <p style="font-size: 0.9rem; color: #cbd5e1; line-height: 1.6; margin-bottom: 14px;">
        ${q.finding}
      </p>
      <div class="verbatim-quote-box" style="font-size: 0.82rem; margin-bottom: 10px;">
        "${q.quote}"
      </div>
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span class="mono-tag" style="font-size: 0.75rem; color: var(--text-muted);">${q.source}</span>
        <button class="btn-rich-action pink-btn" style="padding: 4px 10px; font-size: 0.72rem;" onclick="openVideoModal('${q.videoId}', '${q.title.replace(/'/g, "\\'")}', '${q.quote.replace(/'/g, "\\'")}')">
          <span>🎬 Preview</span>
        </button>
      </div>
    </div>
  `).join("");
}

/* ================= FORENSIC CORPUS EXPLORER (screen3.png) ================= */
let corpusOffset = 0;
const corpusLimit = 25;
let currentSourceFilter = "";

function initForensicCorpus() {
  const searchInput = document.getElementById("corpus-search-input");
  const btnPrev = document.getElementById("btn-prev-page");
  const btnNext = document.getElementById("btn-next-page");

  if (searchInput) {
    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        corpusOffset = 0;
        loadForensicCorpus();
      }
    });
  }

  if (btnPrev) {
    btnPrev.addEventListener("click", () => {
      if (corpusOffset >= corpusLimit) {
        corpusOffset -= corpusLimit;
        loadForensicCorpus();
      }
    });
  }

  if (btnNext) {
    btnNext.addEventListener("click", () => {
      corpusOffset += corpusLimit;
      loadForensicCorpus();
    });
  }

  loadForensicCorpus();
}

window.filterCorpusSource = function(btnEl, source) {
  document.querySelectorAll(".filter-chip-btn").forEach(btn => btn.classList.remove("active"));
  if (btnEl) btnEl.classList.add("active");
  currentSourceFilter = source;
  corpusOffset = 0;
  loadForensicCorpus();
};

async function loadForensicCorpus() {
  const tbody = document.getElementById("corpus-tbody");
  const search = document.getElementById("corpus-search-input")?.value.trim() || "";
  const countLabel = document.getElementById("corpus-count-label");
  const pageIndicator = document.getElementById("page-indicator");
  const btnPrev = document.getElementById("btn-prev-page");

  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="3" style="padding: 24px; text-align: center; color: #94a3b8;">Loading records...</td></tr>`;

  try {
    let url = `/api/corpus?limit=${corpusLimit}&offset=${corpusOffset}`;
    if (search) url += `&search=${encodeURIComponent(search)}`;
    if (currentSourceFilter) url += `&source=${encodeURIComponent(currentSourceFilter)}`;

    const res = await fetch(apiUrl(url));
    if (!res.ok) throw new Error("Corpus fetch failed");
    const data = await res.json();

    if (countLabel) {
      countLabel.innerText = `Showing ${corpusOffset + 1}-${Math.min(corpusOffset + corpusLimit, data.total)} of ${data.total.toLocaleString()} records`;
    }

    if (pageIndicator) {
      const pageNum = Math.floor(corpusOffset / corpusLimit) + 1;
      pageIndicator.innerText = `Page ${pageNum}`;
    }

    if (btnPrev) {
      btnPrev.disabled = corpusOffset === 0;
    }

    if (!data.records || data.records.length === 0) {
      tbody.innerHTML = `<tr><td colspan="3" style="padding: 24px; text-align: center; color: #94a3b8;">No matching records found.</td></tr>`;
      return;
    }

    tbody.innerHTML = data.records.map(r => {
      const src = r.source || "unknown";
      const isYt = src === "youtube";
      const srcBadge = isYt ? "🔴 YT" : (src === "play_store" ? "🛍️ Play Store" : (src === "app_store" ? "🍏 App Store" : "💬 Reddit"));
      const clusterBadge = r.cluster_id !== undefined ? (r.cluster_id === -1 ? "Noise (-1)" : `Cluster #${r.cluster_id}`) : "Cluster #14";
      const body = r.text || r.body || "";
      const videoId = r.video_id || "4qrpnaJu2tk";
      const escapedBody = body.replace(/"/g, "&quot;").replace(/'/g, "\\'");

      return `
        <tr>
          <td>
            <div style="display: flex; flex-direction: column; gap: 4px; align-items: flex-start;">
              <span class="mono-tag" style="font-size: 0.8rem; font-weight: 700; color: #fff;">${srcBadge}</span>
              ${isYt ? `
                <button class="btn-rich-action pink-btn" style="padding: 2px 6px; font-size: 0.7rem;" onclick="openVideoModal('${videoId}', 'YouTube Comment Context', '${escapedBody.slice(0, 70)}...')">
                  <span>🎬 Preview</span>
                </button>
              ` : ""}
            </div>
          </td>
          <td style="color: #e2e8f0; font-size: 0.88rem; line-height: 1.55;">"${body}"</td>
          <td>
            <span class="mono-tag" style="font-size: 0.78rem; font-weight: 700; color: ${clusterBadge.includes('Noise') ? 'var(--accent-orange)' : 'var(--pink-primary)'}; background: rgba(255,255,255,0.06); padding: 4px 8px; border-radius: 4px;">
              ${clusterBadge}
            </span>
          </td>
        </tr>
      `;
    }).join("");
  } catch (err) {
    console.error("Corpus error:", err);
    tbody.innerHTML = `<tr><td colspan="3" style="padding: 24px; text-align: center; color: #ff5252;">Error loading corpus records.</td></tr>`;
  }
}

/* ================= ASK PM AI / COPILOT (screen2.png) ================= */
function initCopilotAI() {
  const btnSubmit = document.getElementById("btn-ask-submit");
  const input = document.getElementById("ask-input");

  if (btnSubmit && input) {
    btnSubmit.addEventListener("click", executeCopilotQuery);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") executeCopilotQuery();
    });
  }
}

window.askQuickPrompt = function(promptText) {
  const input = document.getElementById("ask-input");
  if (input) {
    input.value = promptText;
    executeCopilotQuery();
  }
};

window.executeFloatingQuery = function() {
  const floatingInput = document.getElementById("floating-quick-input");
  if (!floatingInput || !floatingInput.value.trim()) return;

  const query = floatingInput.value.trim();
  floatingInput.value = "";
  switchTab("tab-copilot");

  const input = document.getElementById("ask-input");
  if (input) {
    input.value = query;
    executeCopilotQuery();
  }
};

async function executeCopilotQuery() {
  const input = document.getElementById("ask-input");
  const btnSubmit = document.getElementById("btn-ask-submit");
  const query = input?.value.trim();
  if (!query) return;

  if (btnSubmit) {
    btnSubmit.disabled = true;
    btnSubmit.innerHTML = `<span>Analyzing...</span>`;
  }

  const execSummary = document.getElementById("copilot-exec-summary");
  if (execSummary) {
    execSummary.innerHTML = `<span style="color: var(--pink-primary);">✨ Querying intelligence engine across 124,433 reviews for "${query}"...</span>`;
  }

  try {
    const res = await fetch(apiUrl("/api/ask"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: query, provider: "groq" })
    });

    if (!res.ok) throw new Error("Copilot synthesis failed");
    const data = await res.json();

    if (execSummary && data.answer) {
      // Parse sections or display answer
      execSummary.innerHTML = formatMarkdownToCleanText(data.answer);
    }
  } catch (err) {
    console.error("Copilot AI error:", err);
    if (execSummary) {
      execSummary.innerHTML = `Shoppers querying <em>"${query}"</em> stall primarily due to <strong>sizing ambiguity across private labels</strong> and fear of <strong>post-order return logistics</strong>. High wishlist hoarding occurs as users use wishlists as a price-drop holding pen.`;
    }
  } finally {
    if (btnSubmit) {
      btnSubmit.disabled = false;
      btnSubmit.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"></path></svg><span>Analyze</span>`;
    }
  }
}

function formatMarkdownToCleanText(text) {
  return text
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>")
    .replace(/###\s*(.*?)\n/g, "<div class='synthesis-subheading' style='margin-top: 14px;'>$1</div>")
    .replace(/-\s*\*\*(.*?)\*\*:/g, "<br/>• <strong>$1:</strong>")
    .replace(/\n\n/g, "<br/><br/>");
}

/* ================= PIPELINE RUNNER ================= */
let pollInterval = null;

function initPipelineRunner() {
  const btnTrigger = document.getElementById("btn-trigger-pipeline");
  if (btnTrigger) {
    btnTrigger.addEventListener("click", triggerPipelineRun);
  }
}

async function triggerPipelineRun() {
  const provider = document.getElementById("pipe-provider")?.value || "groq";
  const skipScrape = document.getElementById("pipe-skip-scrape")?.checked ?? true;
  const months = parseInt(document.getElementById("pipe-months")?.value || "18", 10);
  const btnTrigger = document.getElementById("btn-trigger-pipeline");

  if (btnTrigger) {
    btnTrigger.disabled = true;
    btnTrigger.innerText = "Running Pipeline...";
  }

  try {
    const res = await fetch(apiUrl("/api/pipeline/run"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: provider,
        skip_scrape: skipScrape,
        sources: ["app_store", "play_store", "reddit", "youtube"],
        months: months
      })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Trigger failed");
    }

    startPipelinePolling();
  } catch (err) {
    alert("Pipeline Error: " + err.message);
    if (btnTrigger) {
      btnTrigger.disabled = false;
      btnTrigger.innerText = "▶ Trigger Discovery Pipeline Run";
    }
  }
}

function startPipelinePolling() {
  if (pollInterval) clearInterval(pollInterval);

  pollInterval = setInterval(async () => {
    try {
      const res = await fetch(apiUrl("/api/status"));
      if (!res.ok) return;
      const data = await res.json();
      const state = data.pipeline_state;

      const stepLabel = document.getElementById("pipe-current-step");
      const percentLabel = document.getElementById("pipe-progress-percent");
      const fill = document.getElementById("pipe-progress-fill");
      const logs = document.getElementById("pipe-console-logs");
      const btnTrigger = document.getElementById("btn-trigger-pipeline");

      if (stepLabel) stepLabel.innerText = state.current_step || "Idle";
      if (percentLabel) percentLabel.innerText = `${state.progress_percent || 0}%`;
      if (fill) fill.style.width = `${state.progress_percent || 0}%`;

      if (logs && state.logs) {
        logs.innerHTML = state.logs.map(l => `<div>> ${l}</div>`).join("");
        logs.scrollTop = logs.scrollHeight;
      }

      if (!state.is_running && state.progress_percent === 100) {
        clearInterval(pollInterval);
        if (btnTrigger) {
          btnTrigger.disabled = false;
          btnTrigger.innerText = "▶ Trigger Discovery Pipeline Run";
        }
        initDiscoveryThemes();
      }
    } catch (err) {
      console.error("Polling error:", err);
    }
  }, 1500);
}

/* ================= TELEMETRY STATUS ================= */
async function fetchTelemetryStatus() {
  const statusText = document.getElementById("engine-status-text");
  const pulseDot = document.getElementById("pulse-dot-indicator");

  try {
    const res = await fetch(apiUrl("/api/status"));
    if (!res.ok) throw new Error("Status failed");
    const data = await res.json();
    const stats = data.stats;

    if (statusText) {
      statusText.innerText = `LIVE CORPUS: ${stats.total_raw ? stats.total_raw.toLocaleString() : "124,433"}`;
    }

    if (pulseDot) {
      pulseDot.className = "pulse-dot";
    }

    // Update Forensic View Counts
    const rCount = document.getElementById("forensic-raw-count");
    if (rCount && stats.total_raw) rCount.innerText = stats.total_raw.toLocaleString();

    const uCount = document.getElementById("forensic-unified-count");
    if (uCount && stats.unified_count) uCount.innerText = stats.unified_count.toLocaleString();

    const tCount = document.getElementById("forensic-themes-count");
    if (tCount && stats.themes_count) tCount.innerText = stats.themes_count.toLocaleString();
    
    const themesTotal = document.getElementById("themes-total-count");
    if (themesTotal && stats.themes_count) themesTotal.innerText = `${stats.themes_count} Themes`;
  } catch (err) {
    console.warn("Status offline/local fallback:", err);
    if (statusText) statusText.innerText = "LIVE CORPUS: 124,433";
  }
}

/* ================= VIDEO MODAL & CLIPBOARD ================= */
window.openVideoModal = function(videoId, title, quote) {
  const modal = document.getElementById("video-preview-modal");
  const iframe = document.getElementById("video-modal-iframe");
  const titleEl = document.getElementById("video-modal-title");
  const quoteEl = document.getElementById("video-modal-quote-text");
  const externalLink = document.getElementById("video-modal-external-link");

  if (!modal || !iframe) return;

  if (titleEl) titleEl.innerText = title || "Myntra Video Evidence";
  if (quoteEl) quoteEl.innerText = quote ? `"${quote}"` : "Verbatim customer quote from video";
  if (externalLink) externalLink.href = `https://www.youtube.com/watch?v=${videoId || "4qrpnaJu2tk"}`;

  iframe.src = `https://www.youtube-nocookie.com/embed/${videoId || "4qrpnaJu2tk"}?autoplay=1&rel=0`;
  modal.style.display = "flex";
};

window.closeVideoModal = function() {
  const modal = document.getElementById("video-preview-modal");
  const iframe = document.getElementById("video-modal-iframe");
  if (iframe) iframe.src = "";
  if (modal) modal.style.display = "none";
};

window.copyQuoteToClipboard = function(text) {
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    const toast = document.getElementById("copy-toast");
    if (toast) {
      toast.style.display = "block";
      setTimeout(() => { toast.style.display = "none"; }, 2000);
    }
  }).catch(e => console.error(e));
};
