// Loaded synchronously in <head> so the resolved theme is applied before the first paint.
// Shared verbatim by personal-dashboard, knowledge-dashboard and financial-dashboard; Knowledge and
// Finance are proxied under the Hub origin, so one saved preference covers all three there.
(() => {
  const KEY = "dashboard-theme";
  const DARK_THEME_COLOR = "#1a1a18";
  const root = document.documentElement;
  const media = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  let memoryPreference = "system";

  const readPreference = () => {
    try {
      const value = window.localStorage.getItem(KEY);
      return value === "light" || value === "dark" ? value : "system";
    } catch {
      return memoryPreference;
    }
  };

  const apply = () => {
    const preference = readPreference();
    const theme = preference === "system" ? (media && media.matches ? "dark" : "light") : preference;
    root.dataset.theme = theme;
    root.dataset.themePreference = preference;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      if (!meta.dataset.lightColor) meta.dataset.lightColor = meta.content;
      meta.content = theme === "dark" ? DARK_THEME_COLOR : meta.dataset.lightColor;
    }
    document.querySelectorAll("select[data-theme-select]").forEach((select) => {
      select.value = preference;
    });
  };

  const setPreference = (preference) => {
    try {
      if (preference === "light" || preference === "dark") window.localStorage.setItem(KEY, preference);
      else window.localStorage.removeItem(KEY);
    } catch {
      // Storage can be unavailable (private mode); the choice then lasts only for this page.
      memoryPreference = preference === "light" || preference === "dark" ? preference : "system";
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
