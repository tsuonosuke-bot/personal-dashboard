import { escapeHtml } from "./shared/html.js";

/** @param {unknown} value @param {string} label @param {string} [unit] */
function countLabel(value, label, unit = "件") {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? `${label} ${value}${unit}` : "件数を取得できません";
}

/** Existing Hub summaries only; preview arrays are not totals. Links never come from API data. */
/** @type {typeof import("./learning-stages.d.ts").learningStages} */
export function learningStages(summary = {}, availability = {}) {
  return [
    { id: "strategy", title: "戦略", status: countLabel(availability.projects === false ? null : summary.activeProjects, "進行中"),
      links: [{ label: "Projects", url: "/projects/" }, { label: "Wants", url: "/compass/?view=wants" }] },
    { id: "input", title: "インプット", status: countLabel(availability.inbox === false ? null : summary.pendingInbox, "未整理"),
      links: [{ label: "Inbox", url: "/compass/?view=inbox" }, { label: "Journal", url: "/#journalTitle" }] },
    { id: "structure", title: "抽象化・構造化", status: "問い・ノート・タグ",
      links: [{ label: "整理する", url: "/knowledge/?view=organize" }, { label: "ノート", url: "/knowledge/?view=organize&tab=notes" }] },
    { id: "stock", title: "ストック・取り出し", status: countLabel(availability.knowledge === false ? null : summary.reviewReadyDue, "今解ける", "問"),
      links: [{ label: "復習する", url: "/knowledge/?view=quiz&mode=daily" }, { label: "検索する", url: "/knowledge/?view=search" }] },
  ];
}

/** @type {typeof import("./learning-stages.d.ts").renderLearningStages} */
export function renderLearningStages(summary, availability) {
  return learningStages(summary, availability).map((stage, index) => `<li data-learning-stage="${stage.id}">
    <div class="learning-stage-heading"><span aria-hidden="true">${index + 1}</span><h3>${stage.title}</h3></div>
    <p>${escapeHtml(stage.status)}</p>
    <div class="learning-stage-links">${stage.links.map((link) => `<a href="${escapeHtml(link.url)}">${link.label} <span aria-hidden="true">→</span></a>`).join("")}</div>
  </li>`).join("");
}
