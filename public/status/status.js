import { readApiJson } from "../api-client.js";

const storageKey = "personal-hub.connection-last-success.v1";
const els = Object.fromEntries(["refreshButton", "loadingState", "errorState", "errorMessage", "retryButton", "statusGrid"]
  .map((id) => [id, document.getElementById(id)]));

function readLastSuccess() {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) || "{}");
    return typeof value === "object" && value !== null ? value : {};
  } catch {
    return {};
  }
}

function formatDate(value) {
  if (!value) return "まだ確認できません";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "まだ確認できません";
  return new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(parsed);
}

function render(services) {
  const previous = readLastSuccess();
  const next = { ...previous };
  els.statusGrid.replaceChildren(...services.map((service) => {
    if (service.lastSuccessAt) next[service.id] = service.lastSuccessAt;
    const article = document.createElement("article");
    article.className = `status-card${service.lastSuccessAt ? " live" : " unavailable"}`;
    const title = document.createElement("h2");
    title.textContent = service.name;
    article.append(title);
    const values = [
      ["認証方式", service.authMethod],
      ["接続先", service.destination],
      ["DB migration", service.migration],
      ["最終成功時刻", formatDate(service.lastSuccessAt || previous[service.id])],
    ];
    const list = document.createElement("dl");
    values.forEach(([label, value]) => {
      const row = document.createElement("div");
      const term = document.createElement("dt");
      const description = document.createElement("dd");
      term.textContent = label;
      description.textContent = value;
      row.append(term, description);
      list.append(row);
    });
    article.append(list);
    return article;
  }));
  try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* storage is optional */ }
}

async function loadStatus() {
  els.refreshButton.disabled = true;
  els.loadingState.hidden = false;
  els.errorState.hidden = true;
  els.statusGrid.hidden = true;
  try {
    const response = await fetch("/api/connection-status", { headers: { Accept: "application/json" }, cache: "no-store" });
    const payload = await readApiJson(response);
    if (!response.ok || !Array.isArray(payload.services)) throw new Error(payload.error?.message || "接続状態を確認できませんでした。");
    render(payload.services);
    els.loadingState.hidden = true;
    els.statusGrid.hidden = false;
  } catch (error) {
    els.loadingState.hidden = true;
    els.errorMessage.textContent = error instanceof Error ? error.message : "接続状態を確認できませんでした。";
    els.errorState.hidden = false;
  } finally {
    els.refreshButton.disabled = false;
  }
}

els.refreshButton.addEventListener("click", loadStatus);
els.retryButton.addEventListener("click", loadStatus);
loadStatus();
