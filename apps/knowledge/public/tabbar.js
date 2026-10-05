// Phone-width bottom tab bar shared by every page of the Hub, Knowledge and Finance dashboards.
// Shared verbatim by personal-dashboard, knowledge-dashboard and financial-dashboard; each app styles
// `.tabbar` in its own stylesheet (shown only at phone width) so dark mode is generated with the rest.
// Usage: <script src="/tabbar.js" data-page="habits" data-hub="https://hub.example" defer></script>
// data-hub is the Hub origin for apps that are also served on their own domain. When the page is
// already on that origin (Knowledge and Finance proxied under the Hub), links stay same-origin.
(() => {
  const script = document.currentScript;
  const page = script?.dataset.page || "";
  const configuredHub = (script?.dataset.hub || "").replace(/\/+$/, "");
  const hub = configuredHub && new URL(configuredHub).origin !== window.location.origin ? configuredHub : "";

  const ICONS = {
    home: '<path d="M4 11.5 12 5l8 6.5" /><path d="M6 10v10h4v-5h4v5h4V10" />',
    idea: '<path d="M9 18h6M10 21h4" /><path d="M8.5 14.5a6 6 0 1 1 7 0c-.9.7-1.5 1.6-1.5 2.5h-4c0-.9-.6-1.8-1.5-2.5Z" />',
    more: '<circle cx="5" cy="12" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="19" cy="12" r="1.4" />',
    status: '<path d="M3 12h4l2.5-6 5 12 2.5-6h4" />',
  };
  const mark = (item) => item.icon
    ? `<span class="tabbar-mark" aria-hidden="true"><svg viewBox="0 0 24 24">${ICONS[item.icon]}</svg></span>`
    : `<span class="tabbar-mark" aria-hidden="true">${item.glyph}</span>`;

  const MAIN = [
    { id: "hub", label: "ホーム", href: "/", icon: "home" },
    { id: "idea", label: "Idea", href: "/compass/", icon: "idea" },
    { id: "projects", label: "Projects", href: "/projects/", glyph: "P" },
    { id: "habits", label: "Habits", href: "/habits/", glyph: "✓" },
  ];
  const MORE = [
    { id: "writing", label: "Writing", href: "/writing/", glyph: "W" },
    { id: "finance", label: "Finance", href: "/go/financial", glyph: "¥" },
    { id: "knowledge", label: "Knowledge", href: "/go/knowledge", glyph: "K" },
    { id: "status", label: "接続状態", href: "/status/", icon: "status" },
  ];
  const current = (item) => (item.id === page ? ' aria-current="page"' : "");
  const link = (item, className) => `<a class="${className} ${item.id}" href="${hub}${item.href}"${current(item)}>${mark(item)}<span>${item.label}</span></a>`;
  const moreIsCurrent = MORE.some((item) => item.id === page);

  const nav = document.createElement("nav");
  nav.className = "tabbar";
  nav.setAttribute("aria-label", "ページを切り替える");
  nav.innerHTML = `${MAIN.map((item) => link(item, "tabbar-item")).join("")}
    <details class="tabbar-more">
      <summary class="tabbar-item more${moreIsCurrent ? " is-current" : ""}">${mark({ icon: "more" })}<span>その他</span></summary>
      <div class="tabbar-sheet">
        <div class="tabbar-sheet-links">${MORE.map((item) => link(item, "tabbar-sheet-link")).join("")}</div>
        <label class="tabbar-theme"><span>表示</span><select data-theme-select aria-label="表示テーマ"><option value="system">自動</option><option value="light">ライト</option><option value="dark">ダーク</option></select></label>
      </div>
    </details>`;

  const more = nav.querySelector(".tabbar-more");
  const select = nav.querySelector("select");
  if (window.dashboardTheme) select.value = window.dashboardTheme.get();
  document.addEventListener("click", (event) => {
    if (more.open && !more.contains(event.target)) more.open = false;
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !more.open) return;
    more.open = false;
    more.querySelector("summary").focus();
  });

  const mount = () => {
    if (!document.querySelector("nav.tabbar")) document.body.append(nav);
  };
  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount);
})();
