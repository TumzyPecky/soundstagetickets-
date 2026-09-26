// Distributor portal shell — mirrors the admin shell but for a single
// signed-in distributor (no admin nav, no cross-distributor data).

const DISTRIBUTOR_NAV = [
  { href: "/index.html", label: "Dashboard", icon: "dashboard" },
  { href: "/settings.html", label: "Settings", icon: "settings" },
];

function renderDistributorShell(activeHref, contentHtml) {
  const nav = DISTRIBUTOR_NAV.map(
    (item) => `
    <a href="${item.href}" class="${item.href === activeHref ? "active" : ""}">
      ${Icon(item.icon, { size: 16 })}
      ${item.label}
    </a>`
  ).join("");

  const base = getApiBase();

  document.body.innerHTML = `
    <div class="admin-shell">
      <aside class="admin-sidebar glass">
        <div class="admin-brand">
          <img src="/assets/logo.jpg" alt="Sound Stage Live Concert" />
          <span>Distributor</span>
        </div>
        <nav class="admin-nav">${nav}</nav>
        <div class="connection-note" title="${base}">
          <span class="dot"></span> Connected
        </div>
        <div class="admin-logout">
          <button id="logout-btn">${Icon("logout", { size: 16 })} Sign Out</button>
        </div>
      </aside>
      <main class="admin-main" id="admin-content">${contentHtml}</main>
    </div>`;

  document.getElementById("logout-btn").addEventListener("click", async () => {
    try {
      await api("/api/distributor/logout", { method: "POST" });
    } catch {
      // Ignore network errors on logout — clear local state regardless.
    }
    clearToken();
    window.location.href = "/login.html";
  });
}

/**
 * Guards every distributor page. Redirects to /setup.html if no backend
 * has been configured yet, or /login.html if not authenticated against
 * that backend.
 */
async function requireDistributorSession() {
  if (!getApiBase()) {
    window.location.href = "/setup.html";
    return false;
  }
  if (!getToken()) {
    window.location.href = "/login.html";
    return false;
  }
  try {
    const data = await api("/api/distributor/me");
    return data.distributor;
  } catch {
    window.location.href = "/login.html";
    return false;
  }
}

function statusPill(status) {
  const map = {
    PAID: "green", SUCCESS: "green", SENT: "green", DELIVERED: "green",
    AVAILABLE: "green", ACTIVE: "green", APPROVED: "green", VALID: "green",
    PENDING: "amber", PENDING_REVIEW: "amber", AWAITING_RECEIPT: "amber",
    FAILED: "red", SOLD_OUT: "red", SUSPENDED: "red", DECLINED: "red",
    CANCELLED: "gray", REFUNDED: "gray", DISABLED: "gray",
  };
  const cls = map[status] || "gray";
  const label = status === "PENDING_REVIEW" ? "PENDING REVIEW" : status === "AWAITING_RECEIPT" ? "AWAITING RECEIPT" : status;
  return `<span class="pill pill-${cls}">${label}</span>`;
}

/**
 * Cross-browser copy-to-clipboard. Returns a Promise<boolean>.
 * Uses the modern Clipboard API when available (requires HTTPS or
 * localhost), and falls back to the legacy execCommand approach
 * otherwise.
 */
async function copyText(text) {
  if (!text) return false;

  // Modern API — works on HTTPS and localhost.
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to legacy approach
    }
  }

  // Legacy fallback — works anywhere, including plain http:// on mobile.
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "-1000px";
    textarea.style.left = "-1000px";
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Inline "copy" button helper — returns HTML for a small button that
 * copies the given value when clicked. Wires itself up on the next tick
 * after being injected into the DOM.
 */
function copyBtn(value, { what = "value", label = "Copy" } = {}) {
  const encoded = encodeURIComponent(value ?? "");
  const id = "cp_" + Math.random().toString(36).slice(2, 9);
  // Defer wiring until after the current script finishes injecting HTML.
  setTimeout(() => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("click", async (e) => {
      e.preventDefault();
      const ok = await copyText(decodeURIComponent(encoded));
      const orig = el.innerHTML;
      el.innerHTML = ok ? "Copied" : "Failed";
      setTimeout(() => { el.innerHTML = orig; }, 1400);
    });
  }, 0);
  return `<button type="button" id="${id}" class="copy-inline-btn" title="Copy ${what}" data-copy="${encoded}" style="margin-left:6px;background:transparent;border:1px solid rgba(255,255,255,0.15);color:rgba(232,238,252,0.6);border-radius:6px;padding:2px 6px;font-size:11px;cursor:pointer;">${label || "Copy"}</button>`;
}