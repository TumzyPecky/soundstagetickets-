const ADMIN_NAV = [
  { href: "/index.html", label: "Dashboard", icon: "dashboard" },
  { href: "/orders.html", label: "Orders", icon: "orders" },
  { href: "/customers.html", label: "Customers", icon: "customers" },
  { href: "/tickets.html", label: "Ticket Types", icon: "ticket" },
  { href: "/distributors.html", label: "Distributors", icon: "distributors" },
  { href: "/commissions.html", label: "Commissions", icon: "commissions" },
];

function renderAdminShell(activeHref, contentHtml) {
  const nav = ADMIN_NAV.map(
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
          <span>Admin</span>
        </div>
        <nav class="admin-nav">${nav}</nav>
        <div class="connection-note" title="${base}">
          <span class="dot"></span> Connected
        </div>
        <div class="admin-logout">
          <a href="/settings.html" style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:10px;font-size:14px;color:rgba(232,238,252,0.75);">
            ${Icon("settings", { size: 16 })} Settings
          </a>
          <button id="logout-btn">${Icon("logout", { size: 16 })} Sign Out</button>
        </div>
      </aside>
      <main class="admin-main" id="admin-content">${contentHtml}</main>
    </div>`;

  document.getElementById("logout-btn").addEventListener("click", async () => {
    try {
      await api("/api/admin/logout", { method: "POST" });
    } catch {
      // Ignore network errors on logout - clear local state regardless.
    }
    clearToken();
    window.location.href = "/login.html";
  });
}

/**
 * Guards every admin page. Redirects to /setup.html if no backend has
 * been configured yet, or /login.html if not authenticated against that
 * backend.
 */
async function requireAdminSession() {
  if (!getApiBase()) {
    window.location.href = "/setup.html";
    return false;
  }
  if (!getToken()) {
    window.location.href = "/login.html";
    return false;
  }
  try {
    await api("/api/admin/me");
    return true;
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
