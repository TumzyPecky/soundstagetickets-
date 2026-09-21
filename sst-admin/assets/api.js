// This admin panel is a fully separate site from the Sound Stage Tickets
// storefront/backend. It talks to that backend entirely over HTTP, using
// a base URL you configure once (stored in localStorage) and a bearer
// token issued at login (also stored in localStorage). Nothing here
// assumes same-origin hosting - this file works whether the backend is
// on localhost, a different subdomain, or a completely different domain.

const API_BASE_KEY = "sst_admin_api_base";
const TOKEN_KEY = "sst_admin_token";

function getApiBase() {
  return (localStorage.getItem(API_BASE_KEY) || "").replace(/\/+$/, "");
}

function setApiBase(url) {
  localStorage.setItem(API_BASE_KEY, url.replace(/\/+$/, ""));
}

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

function clearApiBase() {
  localStorage.removeItem(API_BASE_KEY);
}

/**
 * Call the connected backend's admin API. Automatically prefixes with the
 * configured base URL and attaches the bearer token. Redirects to the
 * setup page if no backend URL has been configured yet.
 */
async function api(path, options = {}) {
  const base = getApiBase();
  if (!base) {
    window.location.href = "/setup.html";
    throw new Error("No backend connected yet");
  }

  const token = getToken();
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(base + path, { ...options, headers });
  } catch (err) {
    throw new Error(
      "Could not reach the backend. Check the API URL in Settings and that the server is running and reachable."
    );
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (res.status === 401) {
    clearToken();
    window.location.href = "/login.html";
    throw new Error("Session expired. Please sign in again.");
  }

  if (!res.ok) {
    throw new Error((data && data.error) || `Request failed (${res.status})`);
  }
  return data;
}

function formatNaira(kobo) {
  return (kobo / 100).toLocaleString("en-NG", {
    style: "currency",
    currency: "NGN",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function qs(name) {
  return new URLSearchParams(window.location.search).get(name);
}

// Scroll-linked glass mirror shine: maps scroll position to a percentage
// driving the --scroll-shine CSS variable that every .glass / .glass-raised
// surface reads (see assets/styles.css). Purely a function of scrollY -
// no timer, so the shine only moves when the user actually scrolls.
(function initScrollShine() {
  let ticking = false;
  function update() {
    const scrollable = Math.max(document.documentElement.scrollHeight - window.innerHeight, 1);
    const progress = Math.min(Math.max(window.scrollY / scrollable, 0), 1);
    const shinePercent = -20 + progress * 140;
    document.documentElement.style.setProperty("--scroll-shine", shinePercent.toFixed(1) + "%");
    ticking = false;
  }
  window.addEventListener(
    "scroll",
    () => {
      if (!ticking) {
        requestAnimationFrame(update);
        ticking = true;
      }
    },
    { passive: true }
  );
  update();
})();
