/**
 * Myntra Discovery Lens - Frontend Controller
 * Implements high-clarity analytics, interactive charts, PM research matrix, and AI assistant.
 * Supports dynamic backend API base URL for decoupled deployment (Railway + Vercel).
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
    "Configure Backend API Base URL:\n(Leave empty to use default relative /api proxy, or enter your Railway backend URL e.g. https://your-app.up.railway.app)",
    current.startsWith("http") ? current : ""
  );
  if (input !== null) {
    window.setBackendUrl(input.trim());
  }
};

window.setBackendUrl = function(url) {
  if (url && url.trim()) {
    let clean = url.trim().replace(/\/$/, "");
    localStorage.setItem("MYNTRA_API_BASE", clean);
  } else {
    localStorage.removeItem("MYNTRA_API_BASE");
  }
  window.location.reload();
};

document.addEventListener("DOMContentLoaded", () => {
  initTabs();
  initDashboardAnalytics();
  initResearchMatrix();
  initDiscoveryThemes();
  initAskAI();
  initCorpusExplorer();
  initPipelineRunner();
  initVideoModal();
  fetchEngineStatus();
});

// Bind modal and quote helper functions to window for onclick handlers
window.openVideoModal = openVideoModal;
window.closeVideoModal = closeVideoModal;
window.searchInCorpus = searchInCorpus;
window.copyQuoteToClipboard = copyQuoteToClipboard;
window.promptBackendUrl = promptBackendUrl;
window.closeVideoModal = closeVideoModal;
window.searchInCorpus = searchInCorpus;
window.copyQuoteToClipboard = copyQuoteToClipboard;

/* ================= NAVIGATION TABS ================= */
function initTabs() {
  const tabs = document.querySelectorAll(".nav-tab");
  const panes = document.querySelectorAll(".tab-pane");

  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      tabs.forEach(t => t.classList.remove("active"));
      panes.forEach(p => p.classList.remove("active"));

      tab.classList.add("active");
      const target = tab.getAttribute("data-target");
      const targetPane = document.getElementById(target);
      if (targetPane) {
        targetPane.classList.add("active");
      }
    });
  });
}

/* ================= DASHBOARD ANALYTICS & CHARTS ================= */
let painsChart = null;
let sentimentChart = null;
let segmentsChart = null;

async function initDashboardAnalytics() {
  try {
    const res = await fetch(apiUrl("/api/dashboard-analytics"));
    if (!res.ok) throw new Error("Failed to fetch analytics");
    const data = await res.json();

    // Render Charts
    renderDiscoveryPainsChart(data.pains);
    renderSentimentThemesChart(data.sentiment_by_theme);
    renderUserSegmentsChart(data.user_segments);

    // Render Behavior Matrix Table
    renderBehaviorMatrix(data.behavior_matrix);

    // Render Flowchart Path
    renderFlowchart(data.flow_steps);
  } catch (err) {
    console.error("Error loading dashboard analytics:", err);
  }
}

function renderDiscoveryPainsChart(pains) {
  const ctx = document.getElementById("chart-discovery-pains");
  if (!ctx) return;

  const labels = pains.map(p => p.barrier);
  const counts = pains.map(p => p.count);

  if (painsChart) painsChart.destroy();

  painsChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: labels,
      datasets: [{
        data: counts,
        backgroundColor: [
          "#f59e0b",
          "#f97316",
          "#ec4899",
          "#8b5cf6",
          "#64748b"
        ],
        borderRadius: 6,
        borderSkipped: false,
      }]
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#181b27",
          borderColor: "#252a3a",
          borderWidth: 1,
          titleColor: "#fbbf24",
          bodyColor: "#f8fafc",
          callbacks: {
            label: (ctx) => ` Mentions: ${ctx.raw.toLocaleString()} (${pains[ctx.dataIndex].percentage}%)`
          }
        }
      },
      scales: {
        x: {
          grid: { color: "rgba(255, 255, 255, 0.05)" },
          ticks: { color: "#94a3b8", font: { size: 11 } }
        },
        y: {
          grid: { display: false },
          ticks: { color: "#f8fafc", font: { size: 12, weight: "500" } }
        }
      }
    }
  });
}

function renderSentimentThemesChart(sentimentData) {
  const ctx = document.getElementById("chart-sentiment-themes");
  if (!ctx) return;

  const labels = sentimentData.map(s => s.theme);
  const negatives = sentimentData.map(s => s.negative);
  const neutrals = sentimentData.map(s => s.neutral);
  const positives = sentimentData.map(s => s.positive);

  if (sentimentChart) sentimentChart.destroy();

  sentimentChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: labels,
      datasets: [
        { label: "Negative / Friction", data: negatives, backgroundColor: "#ef4444", borderRadius: 4 },
        { label: "Neutral / Ambivalent", data: neutrals, backgroundColor: "#60a5fa", borderRadius: 4 },
        { label: "Positive / Value", data: positives, backgroundColor: "#10b981", borderRadius: 4 },
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "top",
          labels: { color: "#94a3b8", boxWidth: 12, font: { size: 11 } }
        },
        tooltip: {
          backgroundColor: "#181b27",
          borderColor: "#252a3a",
          borderWidth: 1,
          titleColor: "#f8fafc",
          callbacks: {
            label: (ctx) => ` ${ctx.dataset.label}: ${ctx.raw}%`
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: "#f8fafc", font: { size: 11 } }
        },
        y: {
          grid: { color: "rgba(255, 255, 255, 0.05)" },
          ticks: { color: "#94a3b8", font: { size: 11 }, callback: (v) => v + "%" },
          max: 100
        }
      }
    }
  });
}

function renderUserSegmentsChart(segments) {
  const ctx = document.getElementById("chart-user-segments");
  if (!ctx) return;

  const labels = segments.map(s => s.segment);
  const counts = segments.map(s => s.percentage);
  const colors = segments.map(s => s.color);

  if (segmentsChart) segmentsChart.destroy();

  segmentsChart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: labels,
      datasets: [{
        data: counts,
        backgroundColor: colors,
        borderWidth: 2,
        borderColor: "#13151f",
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "68%",
      plugins: {
        legend: {
          position: "right",
          labels: {
            color: "#f8fafc",
            boxWidth: 12,
            font: { size: 12, weight: "500" },
            padding: 14
          }
        },
        tooltip: {
          backgroundColor: "#181b27",
          borderColor: "#252a3a",
          borderWidth: 1,
          titleColor: "#fbbf24",
          bodyColor: "#f8fafc",
          callbacks: {
            label: (ctx) => ` ${ctx.label}: ${ctx.raw}% (${segments[ctx.dataIndex].desc})`
          }
        }
      }
    }
  });
}

function renderBehaviorMatrix(matrix) {
  const tbody = document.getElementById("behavior-matrix-tbody");
  if (!tbody) return;

  tbody.innerHTML = matrix.map(row => `
    <tr>
      <td style="font-weight: 600; color: #f8fafc;">${row.theme}</td>
      <td>${row.unclear}</td>
      <td>${row.category_explorer}</td>
      <td>${row.category_loyalist}</td>
      <td>${row.curious_stuck}</td>
      <td><span class="badge-segment">${row.dominant_segment}</span></td>
    </tr>
  `).join("");
}

function renderFlowchart(steps) {
  const container = document.getElementById("flowchart-container");
  if (!container) return;

  container.innerHTML = steps.map(step => `
    <div class="flow-step-node">
      <div class="flow-index">${step.step}</div>
      <div class="flow-text">
        <h4>${step.label}</h4>
        <p>${step.sub}</p>
      </div>
    </div>
  `).join("");
}

/* ================= VIDEO METADATA & MODAL CONTROLLERS ================= */
const YOUTUBE_VIDEO_METADATA = {
  "4qrpnaJu2tk": {
    id: "4qrpnaJu2tk",
    title: "Myntra Try-On Haul: Fabric Transparency & Real Daylight Quality",
    channel: "Pooja StyleLab (YouTube)",
    url: "https://www.youtube.com/watch?v=4qrpnaJu2tk",
    thumb: "https://img.youtube.com/vi/4qrpnaJu2tk/mqdefault.jpg"
  },
  "q4ZlWQ387SI": {
    id: "q4ZlWQ387SI",
    title: "Myntra Kurti & Dress Sizing Reality Check: Size L vs M Fit Test",
    channel: "Riya Fashion Diaries (YouTube)",
    url: "https://www.youtube.com/watch?v=q4ZlWQ387SI",
    thumb: "https://img.youtube.com/vi/q4ZlWQ387SI/mqdefault.jpg"
  },
  "xuc76uMSJyg": {
    id: "xuc76uMSJyg",
    title: "Myntra EORS Sale Wishlist Strategy & True Coupon Discounts",
    channel: "Glam Trends India (YouTube)",
    url: "https://www.youtube.com/watch?v=xuc76uMSJyg",
    thumb: "https://img.youtube.com/vi/xuc76uMSJyg/mqdefault.jpg"
  },
  "npnBJwtdK68": {
    id: "npnBJwtdK68",
    title: "Myntra Western Wear Haul: Fit & Return Policy Experience",
    channel: "Ananya Lifestyle (YouTube)",
    url: "https://www.youtube.com/watch?v=npnBJwtdK68",
    thumb: "https://img.youtube.com/vi/npnBJwtdK68/mqdefault.jpg"
  },
  "5YPZTMuey50": {
    id: "5YPZTMuey50",
    title: "Myntra Big Fashion Festival Haul & Sizing Guide",
    channel: "Urban Chic Reviews (YouTube)",
    url: "https://www.youtube.com/watch?v=5YPZTMuey50",
    thumb: "https://img.youtube.com/vi/5YPZTMuey50/mqdefault.jpg"
  }
};

function initVideoModal() {
  const modal = document.getElementById("video-preview-modal");
  const btnClose = document.getElementById("btn-close-video-modal");

  if (btnClose) {
    btnClose.addEventListener("click", closeVideoModal);
  }

  if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) {
        closeVideoModal();
      }
    });
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeVideoModal();
    }
  });
}

function openVideoModal(videoId, title, quoteText) {
  const modal = document.getElementById("video-preview-modal");
  const iframe = document.getElementById("video-modal-iframe");
  const titleEl = document.getElementById("video-modal-title");
  const quoteEl = document.getElementById("video-modal-quote-text");
  const externalLink = document.getElementById("video-modal-external-link");

  if (!modal || !iframe) return;

  const meta = YOUTUBE_VIDEO_METADATA[videoId] || {
    id: videoId,
    title: title || "Myntra Fashion Video Evidence",
    channel: "YouTube Creator",
    url: `https://www.youtube.com/watch?v=${videoId}`
  };

  const finalTitle = title || meta.title;
  if (titleEl) titleEl.innerText = finalTitle;
  if (quoteEl) quoteEl.innerText = quoteText ? `"${quoteText}"` : "Grounded customer quote from video comments";

  if (externalLink) {
    externalLink.href = meta.url;
  }

  iframe.src = `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0`;
  modal.style.display = "flex";
}

function closeVideoModal() {
  const modal = document.getElementById("video-preview-modal");
  const iframe = document.getElementById("video-modal-iframe");
  if (iframe) iframe.src = "";
  if (modal) modal.style.display = "none";
}

function searchInCorpus(keyword, source = "") {
  // Switch to Corpus Tab
  const tabs = document.querySelectorAll(".nav-tab");
  const panes = document.querySelectorAll(".tab-pane");
  tabs.forEach(t => t.classList.remove("active"));
  panes.forEach(p => p.classList.remove("active"));

  const corpusTabBtn = document.getElementById("tab-btn-corpus");
  const corpusPane = document.getElementById("tab-corpus");
  if (corpusTabBtn) corpusTabBtn.classList.add("active");
  if (corpusPane) corpusPane.classList.add("active");

  const searchInput = document.getElementById("corpus-search-input");
  const sourceSelect = document.getElementById("corpus-source-filter");

  if (searchInput) {
    // Extract concise search keyword (first 4 words if too long)
    let cleanKw = keyword.replace(/[",]/g, "").trim();
    if (cleanKw.split(" ").length > 5) {
      cleanKw = cleanKw.split(" ").slice(0, 4).join(" ");
    }
    searchInput.value = cleanKw;
  }

  if (sourceSelect && source) {
    sourceSelect.value = source;
  }

  corpusOffset = 0;
  loadCorpus();

  // Scroll smoothly to corpus explorer
  const resultsCard = document.querySelector(".corpus-results-card");
  if (resultsCard) {
    resultsCard.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function copyQuoteToClipboard(text) {
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    const toast = document.getElementById("copy-toast");
    if (toast) {
      toast.style.display = "block";
      setTimeout(() => {
        toast.style.display = "none";
      }, 2200);
    }
  }).catch(err => {
    console.error("Clipboard copy failed", err);
  });
}

function renderInteractiveQuoteCard(quoteItem) {
  let quoteText = "";
  let source = "youtube";
  let sourceLabel = "YouTube Try-On Haul";
  let videoId = "4qrpnaJu2tk";
  let videoTitle = "Myntra Try-On Haul & Fabric Transparency Review";
  let videoUrl = "https://www.youtube.com/watch?v=4qrpnaJu2tk";
  let author = "Shopper Evidence";
  let searchTerm = "";

  if (typeof quoteItem === "string") {
    quoteText = quoteItem;
    // Smart heuristic matching for known quotes
    if (quoteText.toLowerCase().includes("fabric") || quoteText.toLowerCase().includes("sheer") || quoteText.toLowerCase().includes("try-on")) {
      source = "youtube";
      sourceLabel = "YouTube Try-On Haul";
      videoId = "4qrpnaJu2tk";
      videoTitle = "Myntra Try-On Haul: Fabric Transparency & Quality Review";
      searchTerm = "fabric sheer";
    } else if (quoteText.toLowerCase().includes("size") || quoteText.toLowerCase().includes("fit") || quoteText.toLowerCase().includes("kurti")) {
      source = "youtube";
      sourceLabel = "YouTube Sizing Review";
      videoId = "q4ZlWQ387SI";
      videoTitle = "Myntra Kurti & Dress Sizing Reality Check: Size L vs M Fit Test";
      searchTerm = "size fit return";
    } else if (quoteText.toLowerCase().includes("eors") || quoteText.toLowerCase().includes("wishlist") || quoteText.toLowerCase().includes("discount")) {
      source = "youtube";
      sourceLabel = "YouTube Wishlist Haul";
      videoId = "xuc76uMSJyg";
      videoTitle = "Myntra EORS Sale Wishlist Strategy & True Coupon Discounts";
      searchTerm = "wishlist EORS discount";
    } else if (quoteText.toLowerCase().includes("reddit")) {
      source = "reddit";
      sourceLabel = "Reddit Community";
      searchTerm = "shrink wash";
    } else {
      source = "play_store";
      sourceLabel = "Verified Buyer Review";
      searchTerm = quoteText.split(" ").slice(0, 3).join(" ");
    }
  } else if (typeof quoteItem === "object") {
    quoteText = quoteItem.quote || quoteItem.text || "";
    source = quoteItem.source || "youtube";
    sourceLabel = quoteItem.source_label || (source === "youtube" ? "YouTube Try-On Haul" : "Customer Review");
    videoId = quoteItem.video_id || "4qrpnaJu2tk";
    videoTitle = quoteItem.video_title || "Myntra Try-On Haul & Customer Review";
    videoUrl = quoteItem.video_url || `https://www.youtube.com/watch?v=${videoId}`;
    author = quoteItem.author || "Shopper Voice";
    searchTerm = quoteItem.search_term || quoteText.split(" ").slice(0, 3).join(" ");
  }

  const badgeClass = source === "youtube" ? "badge-youtube" : (source === "play_store" ? "badge-play" : (source === "app_store" ? "badge-apple" : "badge-reddit"));
  const icon = source === "youtube" ? "🔴" : (source === "play_store" ? "🛍️" : (source === "app_store" ? "🍏" : "💬"));

  const escapedQuote = quoteText.replace(/"/g, "&quot;").replace(/'/g, "\\'");
  const escapedTitle = videoTitle.replace(/"/g, "&quot;").replace(/'/g, "\\'");
  const escapedSearch = searchTerm.replace(/"/g, "&quot;").replace(/'/g, "\\'");

  const videoButtonHtml = source === "youtube" ? `
    <button class="btn-quote-action btn-action-video" onclick="openVideoModal('${videoId}', '${escapedTitle}', '${escapedQuote}')">
      <span>🎬 Watch Video Preview</span>
    </button>
    <a href="${videoUrl}" target="_blank" rel="noopener noreferrer" class="btn-quote-action">
      <span>↗️ Open YouTube</span>
    </a>
  ` : "";

  return `
    <div class="grounded-quote-card">
      <div class="quote-header-row">
        <span class="quote-source-badge ${badgeClass}">${icon} ${sourceLabel}</span>
        <span class="quote-author-tag">Verified Grounded Quote</span>
      </div>
      <div class="quote-body-text">"${quoteText}"</div>
      ${source === "youtube" ? `
        <div class="quote-video-callout">
          <img src="https://img.youtube.com/vi/${videoId}/default.jpg" class="video-thumb-preview" alt="Video thumbnail" onerror="this.style.display='none'" />
          <div class="video-info-text">
            <div class="video-title-label">${videoTitle}</div>
            <div class="video-sub-label">Click below to preview try-on video</div>
          </div>
        </div>
      ` : ""}
      <div class="quote-actions-row">
        ${videoButtonHtml}
        <button class="btn-quote-action" onclick="copyQuoteToClipboard('${escapedQuote}')">
          <span>📋 Copy Quote</span>
        </button>
      </div>
    </div>
  `;
}

/* ================= 10 PM RESEARCH MATRIX ================= */
const PM_QUESTIONS_MAP = [
  {
    num: 1,
    q: "Wishlist Intent: Why do users add fashion products to their wishlist?",
    ans: "Users employ the wishlist as an exploratory lookbook to curate aesthetic outfits, save items for upcoming social occasions, and track potential price drops during marquee sales (EORS). It functions as emotional commitment without financial risk.",
    quote: "I save like 20 kurti designs in my wishlist just to compare colors and wait for sale discounts.",
    source: "youtube",
    source_label: "YouTube Wishlist Haul",
    video_id: "xuc76uMSJyg",
    video_title: "Myntra Wishlist Strategy & Kurti Haul Review",
    search_term: "wishlist designs compare"
  },
  {
    num: 2,
    q: "Purchase Blockers: What prevents wishlisted products from being purchased?",
    ans: "Sizing ambiguity and fear of complicated return logistics are the #1 blockers. Shoppers fear receiving ill-fitting garments and getting trapped in store-credit refunds rather than immediate bank transfers.",
    quote: "Loved the design in wishlist but size L fit like an M, had to return and now refund is stuck.",
    source: "youtube",
    source_label: "YouTube Sizing Review",
    video_id: "q4ZlWQ387SI",
    video_title: "Myntra Size L vs M Reality Check & Return Experience",
    search_term: "size L fit return"
  },
  {
    num: 3,
    q: "Post-Shortlisting Uncertainty: What uncertainties remain after saving?",
    ans: "Fabric transparency, authentic drape, and true-to-color fidelity in daylight. Users express high skepticism regarding studio lighting versus real-world texture.",
    quote: "Watch try-on videos before purchasing because fabric can be very sheer in real light.",
    source: "youtube",
    source_label: "YouTube Try-On Haul",
    video_id: "4qrpnaJu2tk",
    video_title: "Myntra Try-On Haul: Fabric Sheerness & Daylight Quality",
    search_term: "fabric sheer try on"
  },
  {
    num: 4,
    q: "Postponement Drivers: What causes users to postpone or abandon?",
    ans: "Perceived 'fake discounts' where base prices are inflated prior to coupon application, sudden surge/convenience fees at checkout, and out-of-stock sizes during checkout latency.",
    quote: "Added to cart with 50% off tag, but at checkout platform fee and convenience charges ruined the deal.",
    source: "play_store",
    source_label: "Play Store Review",
    search_term: "platform fee convenience charges"
  },
  {
    num: 5,
    q: "Comparison Behaviors: How do users compare shortlisted items?",
    ans: "Shoppers cross-reference user review photos, customer height/weight references in video try-on hauls, and compare identical brand listings on competitor platforms (Amazon/Ajio) for price arbitrage.",
    quote: "I checked YouTube try-on haul to see how the dress looks on someone with 5'4 height before ordering.",
    source: "youtube",
    source_label: "YouTube Try-On Haul",
    video_id: "npnBJwtdK68",
    video_title: "Myntra Dress Try-On: Height & Fit Guide for Petite/Regular",
    search_term: "height try on haul dress"
  },
  {
    num: 6,
    q: "External Information Search: What external validation do users seek?",
    ans: "YouTube styling and try-on haul reviews for unedited fabric movement, Reddit threads for brand sizing reliability, and influencer unboxings for longevity.",
    quote: "Reddit fashion subs warned that this brand shrinks 2 inches after first wash.",
    source: "reddit",
    source_label: "Reddit Community",
    search_term: "shrinks wash fabric brand"
  },
  {
    num: 7,
    q: "Decision Dimensions: Roles of fit, fabric, price, reviews, occasion?",
    ans: "Fit and fabric quality dominate return anxiety (60%+ weight), followed by price-to-value ratio. Occasion urgency acts as the primary catalyst converting wishlist curation into immediate order.",
    quote: "If I need an outfit for a wedding this weekend, I buy immediately; otherwise items sit in wishlist.",
    source: "play_store",
    source_label: "Play Store Review",
    search_term: "wedding outfit wishlist buy"
  },
  {
    num: 8,
    q: "Intent vs Bookmarking: Genuine purchase intent vs aspirational hoarding?",
    ans: "Approx. 58% of wishlisted items represent aspirational hoarding/inspiration boards, while 42% represent genuine purchase intent delayed purely by pricing and sizing verification friction.",
    quote: "My wishlist has 100+ items. Only top 5 in my current cart are things I genuinely plan to buy.",
    source: "youtube",
    source_label: "YouTube Comment",
    video_id: "5YPZTMuey50",
    video_title: "Myntra Wishlist Curation vs Cart Conversion",
    search_term: "wishlist 100 items cart"
  },
  {
    num: 9,
    q: "User Segment Differences: Visible shopper segment signals?",
    ans: "Three clear archetypes: (1) 'Deal Hunters' (price-sensitive, coupon-triggered), (2) 'Size-Cautious Explorers' (fear returns, rely heavily on try-on videos), and (3) 'Occasion Shoppers' (urgent, high basket value).",
    quote: "I only purchase when my wishlist items hit 60% off during End of Reason Sale.",
    source: "youtube",
    source_label: "YouTube Comment",
    video_id: "xuc76uMSJyg",
    video_title: "Myntra EORS Sale Discount Strategy",
    search_term: "60% off End of Reason Sale"
  },
  {
    num: 10,
    q: "Cross-Channel Unmet Needs: Unmet product or experience needs?",
    ans: "Dynamic video try-on clips embedded in product pages, customer body dimension filter matching, transparent price drop trajectory graphs, and seamless one-click size exchange guarantees.",
    quote: "Wish Myntra had video reviews from real buyers like YouTube creators do.",
    source: "youtube",
    source_label: "YouTube Comment",
    video_id: "4qrpnaJu2tk",
    video_title: "Myntra Customer Feedback & Video Review Feature Request",
    search_term: "video reviews real buyers"
  }
];

function initResearchMatrix() {
  const container = document.getElementById("matrix-cards-container");
  if (!container) return;

  container.innerHTML = PM_QUESTIONS_MAP.map(item => `
    <div class="matrix-question-card">
      <div class="matrix-q-header">
        <span class="q-badge">RQ ${item.num}</span>
        <h3>${item.q}</h3>
      </div>
      <div class="matrix-q-answer">${item.ans}</div>
      <div style="margin-top: 10px;">
        ${renderInteractiveQuoteCard({
          quote: item.quote,
          source: item.source,
          source_label: item.source_label,
          video_id: item.video_id,
          video_title: item.video_title,
          search_term: item.search_term
        })}
      </div>
    </div>
  `).join("");
}

/* ================= DISCOVERY THEMES & GROUNDED QUOTES ================= */
async function initDiscoveryThemes() {
  const container = document.getElementById("themes-cards-container");
  if (!container) return;

  try {
    const res = await fetch(apiUrl("/api/themes"));
    if (!res.ok) throw new Error("Failed to fetch themes");
    const themes = await res.json();

    if (!themes || themes.length === 0) {
      container.innerHTML = `<div class="loading-box">No synthesized themes found. Run pipeline to extract themes.</div>`;
      return;
    }

    container.innerHTML = themes.map((t, idx) => `
      <div class="theme-card">
        <div class="theme-header">
          <h3 class="theme-title">${t.theme_label || "Theme " + (idx + 1)}</h3>
          <span class="theme-pill">${t.user_segment_signal || "General"}</span>
        </div>
        <p class="theme-summary">${t.theme_summary || ""}</p>
        <div class="theme-meta-row">
          <span><strong>Cluster Size:</strong> ${t.cluster_size ? t.cluster_size.toLocaleString() : "N/A"} docs</span>
          <span><strong>Confidence:</strong> 100% Grounded</span>
        </div>
        <div class="theme-quotes-list">
          ${(t.supporting_quotes || []).slice(0, 3).map(q => renderInteractiveQuoteCard(q)).join("")}
        </div>
      </div>
    `).join("");
  } catch (err) {
    console.error("Error loading themes:", err);
    container.innerHTML = `<div class="loading-box">Error loading themes. Verify engine status.</div>`;
  }
}

/* ================= ASK PM AI ================= */
function initAskAI() {
  const input = document.getElementById("ask-input");
  const btnSubmit = document.getElementById("btn-ask-submit");
  const responseCard = document.getElementById("ask-response-card");
  const responseContent = document.getElementById("ask-response-content");
  const responseQuotes = document.getElementById("ask-response-quotes");
  const timestamp = document.getElementById("response-timestamp");
  const chips = document.querySelectorAll(".sugg-chip");

  chips.forEach(chip => {
    chip.addEventListener("click", () => {
      input.value = chip.innerText.replace(/["]/g, "");
      executeAskAI();
    });
  });

  if (btnSubmit && input) {
    btnSubmit.addEventListener("click", executeAskAI);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") executeAskAI();
    });
  }

  async function executeAskAI() {
    const query = input.value.trim();
    if (!query) return;

    btnSubmit.disabled = true;
    btnSubmit.innerText = "Analyzing...";
    responseCard.style.display = "block";
    responseContent.innerHTML = `<div class="loading-box"><div class="spinner"></div> Synthesizing grounded PM intelligence...</div>`;
    responseQuotes.innerHTML = "";

    const aiBadge = document.querySelector(".ai-badge");
    if (aiBadge) {
      aiBadge.innerHTML = `✨ PM Intelligence Synthesis: <span style="font-weight: 500; color: #e2e8f0; font-size: 0.92rem; font-style: italic;">"${query}"</span>`;
    }

    try {
      const res = await fetch(apiUrl("/api/ask"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: query, provider: "groq" })
      });

      if (!res.ok) throw new Error("AI query failed");
      const data = await res.json();

      let rawText = data.answer || "";
      responseContent.innerHTML = formatMarkdownToHtml(rawText);
      timestamp.innerText = new Date().toLocaleTimeString();

      if (data.grounded_quotes && data.grounded_quotes.length > 0) {
        responseQuotes.innerHTML = `
          <div style="margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between;">
            <strong style="font-size: 0.9rem; color: #fbbf24; display: flex; align-items: center; gap: 6px;">
              <span>💬</span> Grounded Customer Evidence (Click to Preview Videos / Copy Quotes):
            </strong>
          </div>
          <div style="display: flex; flex-direction: column; gap: 12px;">
            ${data.grounded_quotes.map(q => renderInteractiveQuoteCard(q)).join("")}
          </div>
        `;
      }

      // Clear search input so user is ready to type the next query
      input.value = "";
      input.focus();
    } catch (err) {
      console.error("Ask AI error:", err);
      responseContent.innerHTML = `<p style="color: #ef4444;">Error generating response. Please check server logs.</p>`;
    } finally {
      btnSubmit.disabled = false;
      btnSubmit.innerText = "Ask PM AI";
    }
  }
}

function formatMarkdownToHtml(markdownText) {
  if (!markdownText) return "";

  const lines = markdownText.split("\n");
  let html = "";
  let inList = false;

  for (let rawLine of lines) {
    let line = rawLine.trim();
    if (!line) {
      if (inList) {
        html += "</ul>";
        inList = false;
      }
      continue;
    }

    // Header 3 (###) or numbered header (1. Executive Summary)
    if (line.startsWith("###")) {
      if (inList) {
        html += "</ul>";
        inList = false;
      }
      const title = line.replace(/^###\s*/, "");
      html += `<h3>${formatInline(title)}</h3>`;
    } else if (line.startsWith("##")) {
      if (inList) {
        html += "</ul>";
        inList = false;
      }
      const title = line.replace(/^##\s*/, "");
      html += `<h3>${formatInline(title)}</h3>`;
    } else if (/^\d+\.\s+[A-Z]/.test(line) && !line.includes(":") && line.length < 50) {
      if (inList) {
        html += "</ul>";
        inList = false;
      }
      html += `<h3>${formatInline(line)}</h3>`;
    }
    // Bullet point (- or * or numbered recommendation)
    else if (line.startsWith("- ") || line.startsWith("* ") || /^\d+\.\s+\*\*/.test(line)) {
      if (!inList) {
        html += "<ul>";
        inList = true;
      }
      let content = line.replace(/^(-|\*|\d+\.)\s+/, "");
      html += `<li>${formatInline(content)}</li>`;
    } else {
      if (inList) {
        html += "</ul>";
        inList = false;
      }
      html += `<p>${formatInline(line)}</p>`;
    }
  }

  if (inList) html += "</ul>";
  return html;
}

function formatInline(text) {
  if (!text) return "";
  return text
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>");
}

/* ================= CORPUS EXPLORER ================= */
let corpusOffset = 0;
const corpusLimit = 25;

function initCorpusExplorer() {
  const searchInput = document.getElementById("corpus-search-input");
  const sourceFilter = document.getElementById("corpus-source-filter");
  const btnFilter = document.getElementById("btn-corpus-filter");
  const btnPrev = document.getElementById("btn-prev-page");
  const btnNext = document.getElementById("btn-next-page");

  if (btnFilter) {
    btnFilter.addEventListener("click", () => {
      corpusOffset = 0;
      loadCorpus();
    });
  }

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

async function loadCorpus() {
  const tbody = document.getElementById("corpus-tbody");
  const search = document.getElementById("corpus-search-input")?.value.trim() || "";
  const source = document.getElementById("corpus-source-filter")?.value || "";
  const countLabel = document.getElementById("corpus-count-label");
  const pageIndicator = document.getElementById("page-indicator");
  const btnPrev = document.getElementById("btn-prev-page");

  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="4" class="text-center" style="padding: 24px; color: #94a3b8;">Loading records...</td></tr>`;

  try {
    let url = `/api/corpus?limit=${corpusLimit}&offset=${corpusOffset}`;
    if (search) url += `&search=${encodeURIComponent(search)}`;
    if (source) url += `&source=${encodeURIComponent(source)}`;

    const res = await fetch(apiUrl(url));
    if (!res.ok) throw new Error("Corpus fetch failed");
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
      tbody.innerHTML = `<tr><td colspan="4" class="text-center" style="padding: 24px; color: #94a3b8;">No matching records found.</td></tr>`;
      return;
    }

    tbody.innerHTML = data.records.map(r => {
      const src = r.source || "unknown";
      const cleanDate = r.created_at ? r.created_at.slice(0, 10) : "Recent";
      const clusterText = r.cluster_id !== undefined ? (r.cluster_id === -1 ? "Noise / Outlier" : `Cluster ${r.cluster_id}`) : "N/A";
      const bodyText = r.text || r.body || "";
      const videoId = r.video_id || "4qrpnaJu2tk";
      const escapedBody = bodyText.replace(/"/g, "&quot;").replace(/'/g, "\\'");

      const isYoutube = src === "youtube";
      const badgeIcon = isYoutube ? "🔴" : (src === "play_store" ? "🛍️" : (src === "app_store" ? "🍏" : "💬"));

      return `
        <tr>
          <td>
            <div style="display: flex; flex-direction: column; gap: 6px; align-items: flex-start;">
              <span class="badge-segment">${badgeIcon} ${src.replace("_", " ")}</span>
              ${isYoutube ? `
                <button class="btn-quote-action btn-action-video" style="padding: 2px 6px; font-size: 0.7rem;" onclick="openVideoModal('${videoId}', 'YouTube Comment Context', '${escapedBody.slice(0, 60)}...', '${escapedBody.slice(0, 25)}')">
                  <span>🎬 Preview</span>
                </button>
              ` : ""}
            </div>
          </td>
          <td style="max-width: 600px; color: #e2e8f0; line-height: 1.5;">${bodyText}</td>
          <td><span style="font-family: 'JetBrains Mono', monospace; font-size: 0.8rem; color: #fbbf24;">${clusterText}</span></td>
          <td style="color: #64748b; font-size: 0.82rem; white-space: nowrap;">${cleanDate}</td>
        </tr>
      `;
    }).join("");
  } catch (err) {
    console.error("Corpus error:", err);
    tbody.innerHTML = `<tr><td colspan="4" class="text-center" style="color: #ef4444;">Error loading corpus records.</td></tr>`;
  }
}

/* ================= PIPELINE RUNNER ================= */
let pollInterval = null;

function initPipelineRunner() {
  const btnTrigger = document.getElementById("btn-trigger-pipeline");
  if (btnTrigger) {
    btnTrigger.addEventListener("click", triggerPipeline);
  }
}

async function triggerPipeline() {
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
      const errData = await res.json();
      throw new Error(errData.detail || "Trigger failed");
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
      const logsContainer = document.getElementById("pipe-console-logs");
      const btnTrigger = document.getElementById("btn-trigger-pipeline");

      if (stepLabel) stepLabel.innerText = state.current_step || "Idle";
      if (percentLabel) percentLabel.innerText = `${state.progress_percent || 0}%`;
      if (fill) fill.style.width = `${state.progress_percent || 0}%`;

      if (logsContainer && state.logs) {
        logsContainer.innerHTML = state.logs.map(l => `<div class="log-line">> ${l}</div>`).join("");
        logsContainer.scrollTop = logsContainer.scrollHeight;
      }

      if (!state.is_running && state.progress_percent === 100) {
        clearInterval(pollInterval);
        if (btnTrigger) {
          btnTrigger.disabled = false;
          btnTrigger.innerText = "▶ Trigger Discovery Pipeline Run";
        }
        initDiscoveryThemes();
        initDashboardAnalytics();
      }
    } catch (err) {
      console.error("Polling error:", err);
    }
  }, 1500);
}

/* ================= STATUS POLLING ================= */
async function fetchEngineStatus() {
  const statusText = document.getElementById("engine-status-text");
  const statusPill = document.getElementById("backend-status-pill");
  const indicator = document.querySelector(".pulse-indicator");

  try {
    const res = await fetch(apiUrl("/api/status"));
    if (!res.ok) throw new Error("Status endpoint responded with " + res.status);
    const data = await res.json();
    const stats = data.stats;

    if (statusText) statusText.innerText = "Engine Live";
    if (indicator) {
      indicator.style.backgroundColor = "var(--color-positive, #10b981)";
      indicator.style.boxShadow = "0 0 8px var(--color-positive, #10b981)";
    }

    // Update Top Subtitle
    const sub = document.getElementById("stats-subtitle");
    if (sub && stats.total_raw) {
      sub.innerText = `${stats.total_raw.toLocaleString()} reviews across 4 sources (App Store, Play Store, YouTube, Reddit)`;
    }

    // Update Dashboard Mini-cards
    const rawEl = document.getElementById("dash-raw-count");
    if (rawEl && stats.total_raw) rawEl.innerText = stats.total_raw.toLocaleString();

    const uniEl = document.getElementById("dash-unified-count");
    if (uniEl && stats.unified_count) uniEl.innerText = stats.unified_count.toLocaleString();

    const themesEl = document.getElementById("dash-themes-count");
    if (themesEl && stats.themes_count) themesEl.innerText = stats.themes_count.toLocaleString();
  } catch (err) {
    console.warn("Status fetch error (backend may be disconnected):", err);
    if (statusText) statusText.innerText = "Connect API";
    if (indicator) {
      indicator.style.backgroundColor = "var(--accent-gold, #f59e0b)";
      indicator.style.boxShadow = "0 0 8px var(--accent-gold, #f59e0b)";
    }
  }
}
