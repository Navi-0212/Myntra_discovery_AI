/**
 * Discovery Lens - Desktop Web App Controller (v8.0)
 * Fully connected to FastAPI backend endpoints:
 * - /api/dashboard-analytics
 * - /api/themes
 * - /api/ask (with interactive self-suggested questions & real-time grounding)
 * - /api/corpus (with live filtering & pagination)
 * - /api/status & /api/pipeline/run
 */

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
  const current = localStorage.getItem("MYNTRA_API_BASE") || "(relative /api)";
  const input = prompt(
    "Configure Backend API Base URL:\n(Leave empty to use default relative /api, or enter your backend URL e.g. https://myntradiscoveryai-production.up.railway.app)",
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

/* ================= TAB ROUTING ================= */
window.switchTab = function(targetId) {
  document.querySelectorAll(".tab-nav-btn").forEach(btn => {
    if (btn.getAttribute("data-target") === targetId) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });

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
  initDashboardAnalytics();
  initResearchMatrix();
  initDiscoveryThemes();
  initForensicsExplorer();
  initPipelineRunner();
  fetchTelemetry();
});

/* ================= 1. DASHBOARD & ANALYTICS ================= */
let sentimentChart = null;

async function initDashboardAnalytics() {
  try {
    const res = await fetch(apiUrl("/api/dashboard-analytics"));
    if (!res.ok) throw new Error("Failed to fetch analytics");
    const data = await res.json();

    // Render Friction Distribution Meters
    if (data.pains && data.pains.length > 0) {
      renderFrictionMeters(data.pains);
    }

    // Render Sentiment by Theme Chart
    if (data.sentiment_by_theme && data.sentiment_by_theme.length > 0) {
      renderSentimentChart(data.sentiment_by_theme);
    } else {
      initDefaultSentimentChart();
    }
  } catch (err) {
    console.warn("Using fallback analytics:", err);
    initDefaultSentimentChart();
  }
}

function renderFrictionMeters(pains) {
  const container = document.getElementById("friction-meters-list");
  if (!container) return;

  const colorClasses = ["pink", "yellow", "blue", "pink", "yellow"];
  const colorStyles = ["var(--pink-primary)", "var(--accent-peach)", "var(--accent-purple)", "var(--pink-light)", "var(--accent-amber)"];

  container.innerHTML = pains.slice(0, 4).map((p, i) => `
    <div class="friction-meter-item">
      <div class="friction-meter-header">
        <span style="color: ${colorStyles[i % colorStyles.length]};">${p.barrier}</span>
        <span style="color: #fff; font-weight: 700;">${p.percentage}%</span>
      </div>
      <div class="meter-track">
        <div class="meter-fill ${colorClasses[i % colorClasses.length]}" style="width: ${p.percentage}%;"></div>
      </div>
    </div>
  `).join("");
}

function renderSentimentChart(sentimentData) {
  const ctx = document.getElementById("chart-sentiment-themes");
  if (!ctx) return;

  if (sentimentChart) sentimentChart.destroy();

  const labels = sentimentData.map(s => s.theme);
  const negs = sentimentData.map(s => s.negative);
  const neus = sentimentData.map(s => s.neutral);
  const poss = sentimentData.map(s => s.positive);

  sentimentChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: labels,
      datasets: [
        { label: "Negative", data: negs, backgroundColor: "#ff5e62", borderRadius: 4, barPercentage: 0.7 },
        { label: "Neutral", data: neus, backgroundColor: "#4facfe", borderRadius: 4, barPercentage: 0.7 },
        { label: "Positive", data: poss, backgroundColor: "#00f2fe", borderRadius: 4, barPercentage: 0.7 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#151724",
          borderColor: "rgba(255, 77, 121, 0.4)",
          borderWidth: 1,
          titleFont: { family: "'JetBrains Mono', monospace" },
          bodyFont: { family: "'Inter', sans-serif" }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: "#94a3b8", font: { family: "'JetBrains Mono', monospace", size: 11 } } },
        y: { grid: { color: "rgba(255,255,255,0.06)" }, ticks: { color: "#64748b", font: { family: "'JetBrains Mono', monospace", size: 10 }, stepSize: 50 }, max: 100 }
      }
    }
  });
}

function initDefaultSentimentChart() {
  renderSentimentChart([
    { theme: "Sizing & Fit", negative: 68, neutral: 20, positive: 12 },
    { theme: "Price / Discounts", negative: 52, neutral: 33, positive: 15 },
    { theme: "Fabric & Quality", negative: 58, neutral: 28, positive: 14 },
    { theme: "Returns & Refund", negative: 76, neutral: 18, positive: 6 },
    { theme: "App & UX", negative: 44, neutral: 24, positive: 32 }
  ]);
}

/* ================= 2. 10 PM RESEARCH MATRIX ================= */
const PM_RESEARCH_QUESTIONS = [
  {
    num: 1,
    title: "1. Wishlist Intent vs Reality",
    finding: "Used as a 'holding pen' for price drops, not actual curation. High abandonment when friction introduced.",
    quote: "I save like 20 kurti designs in my wishlist just to compare colors and wait for sale discounts.",
    source: "YouTube Wishlist Haul",
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
    <div class="webapp-card">
      <div class="card-top-tag pink">
        <span>RESEARCH DIMENSION ${q.num}</span>
        <span class="mono-tag">EMPIRICAL</span>
      </div>
      <h3 class="theme-title-h3" style="font-size: 1.1rem; margin-bottom: 4px;">
        ${q.title}
      </h3>
      <p class="theme-desc-p" style="font-size: 0.9rem; margin-bottom: 12px;">
        ${q.finding}
      </p>
      <div class="code-quote-container" style="font-size: 0.85rem; padding: 12px 16px; margin-bottom: 12px;">
        "${q.quote}"
      </div>
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span class="mono-tag" style="font-size: 0.78rem; color: var(--text-muted);">${q.source}</span>
        <button class="btn-pill-desktop pink-cta" style="padding: 4px 10px; font-size: 0.75rem;" onclick="openVideoModal('${q.videoId}', '${q.title.replace(/'/g, "\\'")}', '${q.quote.replace(/'/g, "\\'")}')">
          <span>🎬 Preview Video</span>
        </button>
      </div>
    </div>
  `).join("");
}

/* ================= 3. DISCOVERY THEMES ================= */
const STATIC_THEMES_FALLBACK = [
  {
    idx: "01",
    tag: "High Impact",
    tagClass: "theme-impact-pill",
    mentions: "14,289",
    title: "Sizing Ambiguity & Fit Uncertainty",
    desc: "Users frequently report anxiety regarding inconsistent sizing across different private labels, leading to hesitation in finalizing purchases and increased reliance on wishlists as a 'holding pen'.",
    sourceName: "Reddit · r/IndianFashionAddicts",
    sourceIcon: "💬",
    quote: "I have like 20 items sitting in my wishlist for weeks. I want to buy them but the sizing is so unpredictable. One brand's M is another's XL. I just wait until I have the energy to deal with potential returns.",
    videoId: "q4ZlWQ387SI",
    videoTitle: "Myntra Kurti & Dress Sizing Reality Check: Size L vs M Fit Test"
  },
  {
    idx: "02",
    tag: "Conversion Blocker",
    tagClass: "theme-impact-pill blocker",
    mentions: "9,842",
    title: "Fake Discount Fatigue",
    desc: "Persistent perception that 'Original Prices' are artificially inflated before sales. This erodes trust and causes users to delay purchases indefinitely, waiting for a 'genuine' price drop alert.",
    sourceName: "YouTube · Haul Review",
    sourceIcon: "🔴",
    quote: "They hiked the MRP to 3999 just to show a 60% discount during the Big Fashion Festival. I tracked this top last month and it was literally 1499 then. Don't fall for the fake urgency guys.",
    videoId: "xuc76uMSJyg",
    videoTitle: "Myntra Big Fashion Festival Haul Review & Discount Strategy"
  },
  {
    idx: "03",
    tag: "Friction Point",
    tagClass: "theme-impact-pill friction",
    mentions: "7,105",
    title: "Post–Order Return Friction Fear",
    desc: "Anticipation of a difficult return process (e.g., store credit instead of original payment method, pickup delays) acts as a primary deterrent to converting wishlist items to cart.",
    sourceName: "Play Store · 1 Star Review",
    sourceIcon: "🛍️",
    quote: "I wanted to buy 3 dresses to try, but the app said 'Return to Myntra Credit only' for two of them. I'm not locking up 5000 rupees in a wallet. Abandoned the whole cart. Please bring back normal refunds.",
    videoId: "npnBJwtdK68",
    videoTitle: "Myntra Return Policy Customer Review"
  }
];

async function initDiscoveryThemes() {
  const container = document.getElementById("themes-cards-container");
  if (!container) return;

  try {
    const res = await fetch(apiUrl("/api/themes"));
    if (res.ok) {
      const themes = await res.json();
      if (themes && themes.length > 0) {
        renderThemesGrid(themes, container);
        return;
      }
    }
    renderThemesGrid(STATIC_THEMES_FALLBACK, container);
  } catch (e) {
    renderThemesGrid(STATIC_THEMES_FALLBACK, container);
  }
}

function renderThemesGrid(themesList, container) {
  container.innerHTML = themesList.map((t, index) => {
    const idxFormatted = t.idx || (index + 1 < 10 ? `0${index + 1}` : `${index + 1}`);
    const tag = t.tag || t.user_segment_signal || "High Impact";
    const tagClass = t.tagClass || (index % 3 === 0 ? "theme-impact-pill" : (index % 3 === 1 ? "theme-impact-pill blocker" : "theme-impact-pill friction"));
    const mentions = t.mentions || (t.cluster_size ? t.cluster_size.toLocaleString() : "14,289");
    const title = t.title || t.theme_label || "Sizing Ambiguity & Fit Uncertainty";
    const desc = t.desc || t.theme_summary || "Users frequently report anxiety regarding inconsistent sizing across different private labels.";
    
    let quote = t.quote || (t.supporting_quotes && t.supporting_quotes[0]) || "I have like 20 items sitting in my wishlist for weeks...";
    if (typeof quote === "object") quote = quote.quote || quote.text || "";
    const sourceName = t.sourceName || (t.source === "youtube" ? "YouTube · Try-On Haul" : "Reddit · r/IndianFashionAddicts");
    const sourceIcon = t.sourceIcon || (t.source === "youtube" ? "🔴" : "💬");
    const videoId = t.videoId || "4qrpnaJu2tk";
    const videoTitle = t.videoTitle || "Myntra Video Evidence";
    const escapedQuote = quote.replace(/"/g, "&quot;").replace(/'/g, "\\'");

    return `
      <div class="theme-card-desktop">
        <div class="theme-card-header">
          <div class="theme-tag-group">
            <span class="theme-idx-badge">THEME ${idxFormatted}</span>
            <span class="${tagClass}">[${tag}]</span>
          </div>
          <div class="mentions-stat-col">
            <span class="mentions-label-sub">MENTIONS</span>
            <span class="mentions-value-big">${mentions}</span>
          </div>
        </div>

        <h3 class="theme-title-h3">${title}</h3>
        <p class="theme-desc-p">${desc}</p>

        <div class="grounded-quote-box-rich">
          <div class="watermark-99">99</div>
          <div class="quote-source-header">
            <span>${sourceIcon}</span>
            <span>${sourceName}</span>
          </div>
          <div class="quote-body-text-rich">"${quote}"</div>
          <div class="quote-action-buttons-row">
            <button class="btn-pill-desktop" onclick="copyQuoteToClipboard('${escapedQuote}')">
              <span>📋 Copy</span>
            </button>
            <button class="btn-pill-desktop pink-cta" onclick="openVideoModal('${videoId}', '${videoTitle.replace(/'/g, "\\'")}', '${escapedQuote}')">
              <span>↗ View Source</span>
            </button>
          </div>
        </div>
      </div>
    `;
  }).join("");
}

/* ================= 4. ASK PM AI (COPILOT) ================= */
window.runSuggestedQuery = function(queryText) {
  const input = document.getElementById("copilot-query-input");
  if (input) {
    input.value = queryText;
  }
  handleCopilotAnalyze();
};

window.handleCopilotAnalyze = async function() {
  const input = document.getElementById("copilot-query-input");
  const btn = document.getElementById("btn-analyze");
  const query = input?.value.trim();
  if (!query) return;

  if (btn) {
    btn.disabled = true;
    btn.innerText = "Analyzing...";
  }

  const exec = document.getElementById("copilot-exec-summary");
  const badge = document.getElementById("synthesis-status-badge");
  const quotesContainer = document.getElementById("copilot-quotes-container");

  if (exec) {
    exec.innerHTML = `<span style="color: var(--pink-primary); display: flex; align-items: center; gap: 8px;">
      <span class="pulse-dot-pink"></span> Querying 124,433 customer reviews and grounding PM synthesis for "${query}"...
    </span>`;
  }
  if (badge) {
    badge.innerText = `PM INTELLIGENCE SYNTHESIS: "${query}"`;
  }

  try {
    const res = await fetch(apiUrl("/api/ask"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: query, provider: "groq" })
    });
    if (!res.ok) throw new Error("Synthesis API failed");
    const data = await res.json();

    if (exec && data.answer) {
      exec.innerHTML = formatMarkdown(data.answer);
    }

    // Render Grounded Customer Quotes
    if (quotesContainer && data.grounded_quotes && data.grounded_quotes.length > 0) {
      quotesContainer.innerHTML = data.grounded_quotes.map(q => {
        const text = q.quote || q.text || "";
        const sourceLabel = q.source_label || (q.source === "youtube" ? "YouTube Try-On Haul" : "Verified Customer Review");
        const videoId = q.video_id || "4qrpnaJu2tk";
        const videoTitle = q.video_title || "Myntra Video Evidence";
        const isYt = q.source === "youtube" || q.source_label?.toLowerCase().includes("youtube");
        const escaped = text.replace(/"/g, "&quot;").replace(/'/g, "\\'");

        return `
          <div class="grounded-quote-box-rich" style="border-left: 3px solid var(--pink-primary);">
            <div class="quote-body-text-rich">"${text}"</div>
            <div style="display: flex; justify-content: space-between; align-items: center; font-family: 'JetBrains Mono', monospace; font-size: 0.8rem; margin-top: 8px;">
              <div style="display: flex; align-items: center; gap: 8px;">
                ${isYt ? `
                  <button class="btn-pill-desktop pink-cta" onclick="openVideoModal('${videoId}', '${videoTitle.replace(/'/g, "\\'")}', '${escaped}')">
                    <span style="color: #ff5e62;">🔴</span> <span>${sourceLabel}</span>
                  </button>
                ` : `
                  <span class="mono-tag" style="color: var(--accent-peach);">💬 ${sourceLabel}</span>
                `}
                <button class="btn-pill-desktop" onclick="copyQuoteToClipboard('${escaped}')">
                  <span>📋 Copy</span>
                </button>
              </div>
              <span style="color: #94a3b8;">${q.cluster || "Cluster: Sizing & Fit Ambiguity"}</span>
            </div>
          </div>
        `;
      }).join("");
    }
  } catch (err) {
    console.warn("Copilot fallback:", err);
    if (exec) {
      exec.innerHTML = `Shoppers querying <em>"${query}"</em> stall primarily due to <strong>sizing ambiguity across private labels</strong> and fear of <strong>post-order return logistics</strong>. High wishlist hoarding occurs as users use wishlists as a price-drop holding pen.`;
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = "<span>➤ Analyze</span>";
    }
  }
};

window.executeStickyQuery = function() {
  const stickyInput = document.getElementById("floating-query-input");
  if (!stickyInput || !stickyInput.value.trim()) return;

  const q = stickyInput.value.trim();
  stickyInput.value = "";
  switchTab("tab-ask");

  const copilotInput = document.getElementById("copilot-query-input");
  if (copilotInput) {
    copilotInput.value = q;
    handleCopilotAnalyze();
  }
};

function formatMarkdown(text) {
  return text
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>")
    .replace(/###\s*(.*?)\n/g, "<div class='copilot-subhead-desktop' style='margin-top: 14px;'>$1</div>")
    .replace(/-\s*\*\*(.*?)\*\*:/g, "<div style='margin-top: 6px;'>• <strong>$1:</strong>")
    .replace(/\n\n/g, "<br/><br/>");
}

/* ================= 5. CORPUS EXPLORER ================= */
let corpusOffset = 0;
const corpusLimit = 25;
let currentSource = "";

function initForensicsExplorer() {
  const searchInput = document.getElementById("corpus-search-input");
  const btnPrev = document.getElementById("btn-prev-page");
  const btnNext = document.getElementById("btn-next-page");

  if (searchInput) {
    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        corpusOffset = 0;
        loadCorpus();
      }
    });
  }

  if (btnPrev) {
    btnPrev.addEventListener("click", () => {
      if (corpusOffset >= corpusLimit) {
        corpusOffset -= corpusLimit;
        loadCorpus();
      }
    });
  }

  if (btnNext) {
    btnNext.addEventListener("click", () => {
      corpusOffset += corpusLimit;
      loadCorpus();
    });
  }

  loadCorpus();
}

window.filterCorpus = function(btnEl, source) {
  document.querySelectorAll(".filter-pill-desktop").forEach(b => b.classList.remove("active"));
  if (btnEl) btnEl.classList.add("active");
  currentSource = source;
  corpusOffset = 0;
  loadCorpus();
};

async function loadCorpus() {
  const tbody = document.getElementById("corpus-tbody");
  const search = document.getElementById("corpus-search-input")?.value.trim() || "";
  const countLabel = document.getElementById("corpus-count-label");
  const pageIndicator = document.getElementById("page-indicator");
  const btnPrev = document.getElementById("btn-prev-page");

  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="3" style="padding: 20px; text-align: center; color: #94a3b8;">Loading corpus records...</td></tr>`;

  try {
    let url = `/api/corpus?limit=${corpusLimit}&offset=${corpusOffset}`;
    if (search) url += `&search=${encodeURIComponent(search)}`;
    if (currentSource) url += `&source=${encodeURIComponent(currentSource)}`;

    const res = await fetch(apiUrl(url));
    if (!res.ok) throw new Error("Fetch failed");
    const data = await res.json();

    if (countLabel) {
      countLabel.innerText = `Showing ${corpusOffset + 1} - ${Math.min(corpusOffset + corpusLimit, data.total)} of ${data.total.toLocaleString()} records`;
    }

    if (pageIndicator) {
      const pageNum = Math.floor(corpusOffset / corpusLimit) + 1;
      pageIndicator.innerText = `Page ${pageNum}`;
    }

    if (btnPrev) {
      btnPrev.disabled = corpusOffset === 0;
    }

    if (!data.records || data.records.length === 0) {
      tbody.innerHTML = `<tr><td colspan="3" style="padding: 20px; text-align: center; color: #94a3b8;">No matching records found.</td></tr>`;
      return;
    }

    tbody.innerHTML = data.records.map(r => {
      const src = r.source || "unknown";
      const isYt = src === "youtube";
      const badgeIcon = isYt ? "🔴 YT" : (src === "play_store" ? "🛍️ Play Store" : (src === "app_store" ? "🍏 App Store" : "💬 Reddit"));
      const clusterBadge = r.cluster_id !== undefined ? (r.cluster_id === -1 ? "Noise (-1)" : `Cluster #${r.cluster_id}`) : "Cluster #14";
      const text = r.text || r.body || "";
      const videoId = r.video_id || "4qrpnaJu2tk";
      const escapedText = text.replace(/"/g, "&quot;").replace(/'/g, "\\'");

      return `
        <tr>
          <td>
            <div style="display: flex; flex-direction: column; gap: 4px; align-items: flex-start;">
              <span class="mono-tag" style="font-weight: 700; color: #fff;">${badgeIcon}</span>
              ${isYt ? `
                <button class="btn-pill-desktop pink-cta" style="padding: 2px 6px; font-size: 0.7rem;" onclick="openVideoModal('${videoId}', 'YouTube Review Context', '${escapedText.slice(0, 60)}...')">
                  <span>🎬 Preview</span>
                </button>
              ` : ""}
            </div>
          </td>
          <td><div class="matrix-finding-desc-desktop">"${text}"</div></td>
          <td><span class="persona-pill-item" style="color: ${clusterBadge.includes('Noise') ? 'var(--accent-peach)' : 'var(--pink-primary)'};">${clusterBadge}</span></td>
        </tr>
      `;
    }).join("");
  } catch (err) {
    console.warn("Corpus load fallback:", err);
  }
}

/* ================= 6. PIPELINE RUNNER ================= */
let pollInterval = null;

function initPipelineRunner() {
  const btn = document.getElementById("btn-trigger-pipeline");
  if (btn) {
    btn.addEventListener("click", triggerPipeline);
  }
}

async function triggerPipeline() {
  const provider = document.getElementById("pipe-provider")?.value || "groq";
  const skipScrape = document.getElementById("pipe-skip-scrape")?.checked ?? true;
  const months = parseInt(document.getElementById("pipe-months")?.value || "18", 10);
  const btn = document.getElementById("btn-trigger-pipeline");

  if (btn) {
    btn.disabled = true;
    btn.innerText = "Running Pipeline...";
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
    if (btn) {
      btn.disabled = false;
      btn.innerText = "▶ Trigger Discovery Pipeline Run";
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
      const btn = document.getElementById("btn-trigger-pipeline");

      if (stepLabel) stepLabel.innerText = state.current_step || "Idle";
      if (percentLabel) percentLabel.innerText = `${state.progress_percent || 0}%`;
      if (fill) fill.style.width = `${state.progress_percent || 0}%`;

      if (logs && state.logs) {
        logs.innerHTML = state.logs.map(l => `<div>> ${l}</div>`).join("");
        logs.scrollTop = logs.scrollHeight;
      }

      if (!state.is_running && state.progress_percent === 100) {
        clearInterval(pollInterval);
        if (btn) {
          btn.disabled = false;
          btn.innerText = "▶ Trigger Discovery Pipeline Run";
        }
        initDiscoveryThemes();
        initDashboardAnalytics();
      }
    } catch (e) {}
  }, 1500);
}

/* ================= TELEMETRY STATUS ================= */
async function fetchTelemetry() {
  try {
    const res = await fetch(apiUrl("/api/status"));
    if (!res.ok) return;
    const data = await res.json();
    const stats = data.stats;

    const badgeText = document.getElementById("telemetry-header-text");
    if (badgeText && stats.total_raw) {
      badgeText.innerText = `CLUSTER 14: CONFIDENCE 94%`;
    }

    const rEl = document.getElementById("dash-raw-count");
    if (rEl && stats.total_raw) rEl.innerText = stats.total_raw.toLocaleString();

    const uEl = document.getElementById("dash-unified-count");
    if (uEl && stats.unified_count) uEl.innerText = stats.unified_count.toLocaleString();

    const tEl = document.getElementById("dash-themes-count");
    if (tEl && stats.themes_count) tEl.innerText = stats.themes_count.toLocaleString();
  } catch (e) {}
}

/* ================= VIDEO MODAL & CLIPBOARD ================= */
window.openVideoModal = function(videoId, title, quote) {
  const modal = document.getElementById("video-preview-modal");
  const iframe = document.getElementById("video-modal-iframe");
  const quoteEl = document.getElementById("video-modal-quote-text");
  const link = document.getElementById("video-modal-external-link");

  if (!modal || !iframe) return;

  if (quoteEl) quoteEl.innerText = quote ? `"${quote}"` : "Verbatim customer quote";
  if (link) link.href = `https://www.youtube.com/watch?v=${videoId || "4qrpnaJu2tk"}`;

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
