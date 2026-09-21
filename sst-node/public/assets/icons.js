// Minimal dependency-free icon set. Icons(name, {size, color, strokeWidth})
// returns an inline SVG string. Used across all pages instead of emoji.

const ICON_PATHS = {
  lock: '<rect x="4" y="10.5" width="16" height="10" rx="2"/><path d="M7.5 10.5V7a4.5 4.5 0 0 1 9 0v3.5"/>',
  ticket:
    '<path d="M3 8.5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v1.75a2 2 0 1 0 0 3.5V15.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1.75a2 2 0 1 0 0-3.5Z"/><path d="M12 6.5v11" stroke-dasharray="2 2.4"/>',
  "check-circle": '<circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.3 2.3L15.5 9"/>',
  "alert-triangle":
    '<path d="M10.3 3.9 2.6 17.5A1.6 1.6 0 0 0 4 20h16a1.6 1.6 0 0 0 1.4-2.5L13.7 3.9a1.6 1.6 0 0 0-3.4 0Z"/><path d="M12 9.5v4M12 16.5h.01"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  mail: '<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="m3.5 6.5 8.5 6.5 8.5-6.5"/>',
  whatsapp:
    '<path d="M12 3a9 9 0 0 0-7.79 13.5L3 21l4.65-1.19A9 9 0 1 0 12 3Zm4.86 12.68c-.2.57-1.16 1.1-1.6 1.14-.42.05-.86.22-2.86-.6-2.42-1-3.97-3.4-4.1-3.57-.12-.16-.98-1.3-.98-2.48s.62-1.76.84-2c.2-.23.46-.28.62-.28h.44c.14 0 .33-.05.51.4.2.5.68 1.72.74 1.85.06.13.1.28.02.44-.08.17-.13.28-.25.43-.13.15-.27.34-.38.46-.13.13-.26.27-.11.53.14.27.64 1.08 1.39 1.75.96.87 1.77 1.14 2.03 1.27.27.13.42.11.58-.07.16-.18.68-.8.86-1.07.18-.28.36-.23.6-.14.24.09 1.55.75 1.82.88.27.14.44.2.5.32.07.12.07.68-.13 1.24Z"/>',
  "map-pin": '<path d="M12 21s7-6.5 7-11.5A7 7 0 0 0 5 9.5C5 14.5 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.4"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="16" rx="2"/><path d="M8 3v4M16 3v4M3.5 10h17"/>',
  "arrow-right": '<path d="M4 12h16M13 6l6 6-6 6"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/>',
  dashboard:
    '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
  orders: '<path d="M6 3.5h9l3 3v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z"/><path d="M8.5 10h7M8.5 13.5h7M8.5 17h4"/>',
  customers:
    '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c0-3 2.5-5.2 5.5-5.2S14.5 16 14.5 19"/><path d="M16 8.2a3 3 0 1 1 .5 5.96M18 19c0-2.4-1.5-4.3-3.5-5"/>',
  distributors: '<path d="M12 3.5 3.5 8l8.5 4.5L20.5 8Z"/><path d="M3.5 8v8L12 20.5 20.5 16V8"/><path d="M12 12.5V20.5"/>',
  commissions:
    '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v9M14.8 9.8c0-1-1-1.8-2.8-1.8s-2.8.9-2.8 1.9c0 2.8 5.6 1.3 5.6 4.1 0 1.1-1.1 2-2.8 2s-2.8-.8-2.8-1.9"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.3-4.3"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="m21 15-5-5-9 9"/>',
  "x-circle": '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>',
  "thumbs-up": '<path d="M7 11v9H4a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3Zm0 0 4.5-7a2 2 0 0 1 3.6 1.4L14.5 9H19a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 17.8 20H10a3 3 0 0 1-3-3v-6Z"/>',
};

function Icon(name, opts = {}) {
  const { size = 18, strokeWidth = 1.8, color = "currentColor", className = "" } = opts;
  const isFilled = name === "whatsapp";
  const inner = ICON_PATHS[name] || "";
  return `<svg class="icon ${className}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="${
    isFilled ? color : "none"
  }" stroke="${isFilled ? "none" : color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}
