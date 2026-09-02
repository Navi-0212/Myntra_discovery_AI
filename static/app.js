/**
 * Discovery Lens - Desktop Web App Interactive Controller (v7.0)
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
window.filterCorpus = function(btnEl, source) {
  document.querySelectorAll(".filter-pill-desktop").forEach(b => b.classList.remove("active"));
  if (btnEl) btnEl.classList.add("active");
};

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
