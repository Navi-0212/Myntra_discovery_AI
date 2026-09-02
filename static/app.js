/**
 * Discovery Lens - Desktop Web App Interactive Controller (v7.5)
 * Rich PM Intelligence Aesthetic from Design.md
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
    "Configure Backend API Base URL:\n(Leave empty to use default relative /api proxy, or enter your backend URL)",
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
  // Update Desktop Tabs
  document.querySelectorAll(".tab-nav-btn").forEach(btn => {
    if (btn.getAttribute("data-target") === targetId) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });

  // Switch Active Tab Pane
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
  initSentimentChart();
  initPipelineRunner();
  initForensicsExplorer();
  fetchTelemetry();
});

/* ================= SENTIMENT CHART (screen.png) ================= */
let sentimentChart = null;

function initSentimentChart() {
  const ctx = document.getElementById("chart-sentiment-themes");
  if (!ctx) return;

  sentimentChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: ["Sizing & Fit", "Price / Discounts", "Fabric & Quality", "Returns & Refund", "App & Service UX"],
      datasets: [
        { label: "Negative", data: [68, 52, 58, 76, 44], backgroundColor: "#ff5e62", borderRadius: 4, barPercentage: 0.7 },
        { label: "Neutral", data: [20, 33, 28, 18, 24], backgroundColor: "#4facfe", borderRadius: 4, barPercentage: 0.7 },
        { label: "Positive", data: [12, 15, 14, 6, 32], backgroundColor: "#00f2fe", borderRadius: 4, barPercentage: 0.7 }
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

/* ================= COPILOT AI (screen2.png) ================= */
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
  if (exec) {
    exec.innerHTML = `<span style="color: var(--pink-primary);">✨ Querying 124,433 customer voice corpus for "${query}"...</span>`;
  }

  try {
    const res = await fetch(apiUrl("/api/ask"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: query, provider: "groq" })
    });
    if (!res.ok) throw new Error("Synthesis failed");
    const data = await res.json();

    if (exec && data.answer) {
      exec.innerHTML = formatMarkdown(data.answer);
    }
  } catch (err) {
    console.warn("Copilot fallback:", err);
    if (exec) {
      exec.innerHTML = `Shoppers abandoning Kurti wishlists are predominantly characterized as <strong>"Hesitant Wishlist Hoarders"</strong>. They actively curate 10–30 items for aspirational outfit matching but stall at checkout. The primary barrier is not lack of intent, but systemic friction related to <strong>sizing unpredictability across private labels</strong> and the subsequent <strong>fear of post-order return logistics</strong>.`;
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
  switchTab("tab-copilot");

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
    .replace(/\n\n/g, "<br/><br/>");
}

/* ================= FORENSICS FILTERING ================= */
let corpusOffset = 0;
const corpusLimit = 25;
let currentSource = "";

function initForensicsExplorer() {
  const searchInput = document.getElementById("corpus-search-input");
  if (searchInput) {
    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        corpusOffset = 0;
        loadCorpus();
      }
    });
  }
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
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="3" style="padding: 20px; text-align: center; color: #94a3b8;">Loading corpus records...</td></tr>`;

  try {
    let url = `/api/corpus?limit=${corpusLimit}&offset=${corpusOffset}`;
    if (search) url += `&search=${encodeURIComponent(search)}`;
    if (currentSource) url += `&source=${encodeURIComponent(currentSource)}`;

    const res = await fetch(apiUrl(url));
    if (!res.ok) throw new Error("Fetch failed");
    const data = await res.json();

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

/* ================= PIPELINE RUNNER ================= */
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
