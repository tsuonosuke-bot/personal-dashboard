// Loaded synchronously in <head> so the resolved theme is applied before the first paint.
// Shared verbatim by personal-dashboard, knowledge-dashboard and financial-dashboard; Knowledge and
// Finance are proxied under the Hub origin, so one saved preference covers all three there.
(() => {
  const KEY = "dashboard-theme";
  const DARK_THEME_COLOR = "#1a1a18";
  // Extra palettes sit on top of a light or dark base: data-theme stays "light"/"dark" so every
  // existing rule keeps working, and data-palette selects the tinted variant (see build-dark-theme.mjs).
  const PALETTES = {
    cream: { scheme: "light", color: "#f3ead3" },
    navy: { scheme: "dark", color: "#131a29" },
    forest: { scheme: "dark", color: "#141f19" },
  };
  const isPreference = (value) => value === "light" || value === "dark" || Object.prototype.hasOwnProperty.call(PALETTES, value);
  const root = document.documentElement;
  const media = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  let memoryPreference = "system";

  const readPreference = () => {
    try {
      const value = window.localStorage.getItem(KEY);
      return isPreference(value) ? value : "system";
    } catch {
      return memoryPreference;
    }
  };

  const apply = () => {
    const preference = readPreference();
    const palette = PALETTES[preference];
    const theme = palette ? palette.scheme : preference === "system" ? (media && media.matches ? "dark" : "light") : preference;
    root.dataset.theme = theme;
    root.dataset.themePreference = preference;
    if (palette) root.dataset.palette = preference;
    else delete root.dataset.palette;
    // Declaring "light dark" lets the browser draw form controls for the OS theme; pin it to the
    // resolved theme so a manual choice never pairs white UA text with white authored backgrounds.
    root.style.colorScheme = theme;
    const scheme = document.querySelector('meta[name="color-scheme"]');
    if (scheme) scheme.content = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      if (!meta.dataset.lightColor) meta.dataset.lightColor = meta.content;
      meta.content = palette ? palette.color : theme === "dark" ? DARK_THEME_COLOR : meta.dataset.lightColor;
    }
    document.querySelectorAll("select[data-theme-select]").forEach((select) => {
      select.value = preference;
    });
  };

  const setPreference = (preference) => {
    try {
      if (isPreference(preference)) window.localStorage.setItem(KEY, preference);
      else window.localStorage.removeItem(KEY);
    } catch {
      // Storage can be unavailable (private mode); the choice then lasts only for this page.
      memoryPreference = isPreference(preference) ? preference : "system";
    }
    apply();
  };

  window.dashboardTheme = { get: readPreference, set: setPreference };
  if (media) media.addEventListener("change", apply);
  window.addEventListener("storage", (event) => {
    if (event.key === KEY) apply();
  });
  document.addEventListener("change", (event) => {
    const target = event.target;
    if (target instanceof HTMLSelectElement && target.matches("[data-theme-select]")) setPreference(target.value);
  });
  document.addEventListener("DOMContentLoaded", apply);
  apply();
})();
