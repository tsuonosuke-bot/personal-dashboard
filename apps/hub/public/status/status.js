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

const levelLabels = { ok: "余裕あり", warn: "注意", critical: "逼迫" };

function formatBytes(value) {
  if (!Number.isFinite(value)) return "—";
  const mb = value / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  if (mb >= 1) return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`;
  return `${Math.max(0, Math.round(value / 1024))} KB`;
}

/** SupabaseのDB容量。使用量・上限に対する割合・大きい表。3アプリが同じDBを使うのでPersonalのカードに出す。 */
function usageRows(usage) {
  if (!usage) return [["DB容量", "確認できません（DB migrationの適用前か、取得に失敗しました）"]];
  const percent = Math.round(usage.ratio * 100);
  const rows = [
    ["DB容量", `${formatBytes(usage.usedBytes)} / ${formatBytes(usage.limitBytes)}（${percent}%・${levelLabels[usage.level] || usage.level}）`],
  ];
  if (usage.topTables.length) {
    rows.push(["大きい表", usage.topTables.map((table) => `${table.name} ${formatBytes(table.bytes)}`).join("\n")]);
  }
  return rows;
}

const kindLabels = { generate: "問題の生成", grade: "回答の採点" };

/** Knowledgeの生成・採点バッチ。最終成功時刻・直近24時間の失敗・pg_cronの状態を、状態カードの行に直す。 */
function batchRows(batches) {
  if (!batches) return [["復習バッチ", "確認できません（DB migrationの適用前か、取得に失敗しました）"]];
  const rows = [["復習バッチの警告", batches.alerts.length ? batches.alerts.join("\n") : "なし"]];
  for (const [kind, label] of Object.entries(kindLabels)) {
    const batch = batches[kind];
    rows.push([
      `${label}`,
      [
        `最終成功 ${formatDate(batch.lastOkAt)}`,
        `直近24時間: 全体の失敗 ${batch.failed24h}回 / 一部のカードの失敗 ${batch.partial24h}回`,
        batch.lastFailureNote ? `最後の失敗: ${batch.lastFailureNote}` : null,
      ].filter(Boolean).join("\n"),
    ]);
  }
  for (const job of batches.cron) {
    rows.push([
      `定期実行 ${job.jobname}`,
      [
        job.active ? `最終実行 ${formatDate(job.lastRunAt)}（${job.lastStatus || "記録なし"}）` : "停止中",
        `直近24時間の失敗 ${job.failed24h}回`,
      ].join("\n"),
    ]);
  }
  return rows;
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
      ...(service.id === "personal" && service.lastSuccessAt ? usageRows(service.databaseUsage) : []),
      ...(service.id === "knowledge" && service.lastSuccessAt ? batchRows(service.reviewBatches) : []),
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
