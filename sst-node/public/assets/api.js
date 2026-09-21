async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    ...options,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
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
    const shinePercent = -20 + progress * 140; // sweeps from -20% to 120%
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
