import { readApiJson } from "./api-client.js";

// SF6ページ。コンボ帳・注意点・練習メニュー・対戦振り返りの4タブ。
// 編集は1つのモーダルを使い回し、FORMS の定義から入力欄を組み立てる。

const CHARACTERS = [
  "リュウ", "ルーク", "ジェイミー", "春麗", "ガイル", "キンバリー", "ジュリ", "ケン", "ブランカ", "ダルシム",
  "エドモンド本田", "ディージェイ", "マノン", "マリーザ", "JP", "ザンギエフ", "リリー", "キャミィ",
  "ラシード", "A.K.I.", "エド", "豪鬼", "ベガ", "テリー", "舞", "エレナ", "サガット", "C.ヴァイパー", "アレックス", "イングリッド",
];
const POSITIONS = { anywhere: "どこでも", midscreen: "画面中央", corner: "画面端" };
const MASTERY = ["未練習", "練習中", "トレモで安定", "実戦で出せる"];
const CATEGORIES = { self: "自分の癖", general: "立ち回り", matchup: "対キャラ" };
const RESULTS = { win: "勝ち", lose: "負け", draw: "引き分け" };
const MODES = { ranked: "ランクマ", casual: "カジュアル", battle_hub: "バトルハブ", tournament: "大会", other: "その他" };
const TABS = ["combos", "notes", "drills", "matches"];
const ADD_LABELS = { combos: "コンボを追加", notes: "注意点を追加", drills: "練習を追加", matches: "振り返りを追加" };

const state = {
  data: null,
  tab: "combos",
  comboCharacter: "",
  comboPosition: "",
  noteOpponent: "",
  /** モーダルで編集中の記録。{ resource, item(null=追加), preset } */
  editing: null,
  saving: false,
};

const ids = [
  "sourceBadge", "refreshButton", "addButton", "addLabel", "loadingState", "errorState", "errorMessage", "retryButton",
  "countCombos", "countNotes", "countDrills", "countMatches",
  "comboCharacter", "comboPosition", "comboList", "comboArchiveFold", "comboArchiveCount", "comboArchive",
  "noteOpponent", "noteGroups", "noteResolvedFold", "noteResolvedCount", "noteResolved",
  "drillList", "logList", "drillDoneFold", "drillDoneCount", "drillDone",
  "matchStats", "matchList",
  "editModal", "modalTitle", "modalClose", "editForm", "formFields", "formError", "deleteButton", "cancelButton", "saveButton",
  "characterOptions", "toast",
];
const els = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));

// ---------- 小物 ----------

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function stored(key, fallback) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function store(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 保存できなくても表示は続ける
  }
}

function formatDay(value) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00+09:00`);
  return new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric", weekday: "short" }).format(date);
}

function daysAgo(value) {
  if (!value || !state.data) return "";
  const diff = Math.round((Date.parse(`${state.data.today}T00:00:00Z`) - Date.parse(`${value}T00:00:00Z`)) / 86_400_000);
  return diff <= 0 ? "今日" : diff === 1 ? "昨日" : `${diff}日前`;
}

function percent(successes, attempts) {
  return attempts > 0 ? `${Math.round((successes / attempts) * 100)}%` : "—";
}

let toastTimer;
function showToast(message) {
  clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.hidden = false;
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, 3000);
}

function empty(message) {
  return `<div class="empty"><p>${escapeHtml(message)}</p></div>`;
}

function errorMessage(payload, fallback) {
  if (typeof payload?.error === "string") return payload.error;
  if (typeof payload?.error?.message === "string") return payload.error.message;
  return fallback;
}

function options(map, selected) {
  return Object.entries(map).map(([value, label]) =>
    `<option value="${escapeHtml(value)}"${value === selected ? " selected" : ""}>${escapeHtml(label)}</option>`).join("");
}

// ---------- 通信 ----------

async function load() {
  els.refreshButton.disabled = true;
  try {
    const response = await fetch("/api/sf6", { headers: { Accept: "application/json" }, cache: "no-store" });
    const payload = await readApiJson(response);
    if (!response.ok) throw new Error(errorMessage(payload, "読み込みに失敗しました。"));
    state.data = payload;
    els.sourceBadge.className = "source-badge live";
    els.loadingState.hidden = true;
    els.errorState.hidden = true;
    render();
  } catch (error) {
    els.sourceBadge.className = "source-badge error";
    els.sourceBadge.lastElementChild.textContent = "接続エラー";
    if (!state.data) {
      els.loadingState.hidden = true;
      els.errorState.hidden = false;
      els.errorMessage.textContent = error instanceof Error ? error.message : "読み込みに失敗しました。";
    } else {
      showToast(error instanceof Error ? error.message : "読み込みに失敗しました。");
    }
  } finally {
    els.refreshButton.disabled = false;
  }
}

async function send(method, resource, body) {
  const response = await fetch(`/api/sf6/${resource}`, {
    method,
    headers: { "Content-Type": "application/json", Accept: "application/json", "X-Dashboard-Action": "sf6" },
    body: JSON.stringify(body),
  });
  const payload = await readApiJson(response);
  if (!response.ok) throw new Error(errorMessage(payload, "保存できませんでした。"));
  return payload;
}

/** 返ってきた行で手元のデータを差し替える（再読み込みしない）。 */
function replaceItem(resource, item) {
  const list = state.data[resource];
  const index = list.findIndex((entry) => entry.id === item.id);
  if (index >= 0) list[index] = item;
  else list.push(item);
}

function removeItem(resource, id) {
  state.data[resource] = state.data[resource].filter((entry) => entry.id !== id);
  if (resource === "drills") state.data.logs = state.data.logs.filter((log) => log.drillId !== id);
  if (resource === "combos") state.data.drills.forEach((drill) => { if (drill.comboId === id) drill.comboId = null; });
}

/** 一部の項目だけ変える（習得度・ピン留めなど）。サーバーへは全項目を送る。 */
async function patch(resource, item, changes, message) {
  const { id, createdAt, updatedAt, ...fields } = item;
  try {
    const saved = await send("PATCH", resource, { id, updatedAt, ...fields, ...changes });
    replaceItem(resource, saved);
    render();
    if (message) showToast(message);
  } catch (error) {
    showToast(error instanceof Error ? error.message : "保存できませんでした。");
  }
}

// ---------- 描画 ----------

function charactersIn(list, key) {
  return [...new Set(list.map((item) => item[key]).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ja"));
}

function fillSelect(select, values, selected, allLabel) {
  select.innerHTML = `<option value="">${escapeHtml(allLabel)}</option>${values.map((value) =>
    `<option value="${escapeHtml(value)}"${value === selected ? " selected" : ""}>${escapeHtml(value)}</option>`).join("")}`;
  if (!values.includes(selected)) select.value = "";
}

function render() {
  const { combos, notes, drills, matches } = state.data;
  els.countCombos.textContent = combos.filter((combo) => !combo.archived).length || "";
  els.countNotes.textContent = notes.filter((note) => !note.resolved).length || "";
  els.countDrills.textContent = drills.filter((drill) => drill.status === "active").length || "";
  els.countMatches.textContent = matches.length || "";
  const known = new Set([...CHARACTERS, ...charactersIn(combos, "character"), ...charactersIn(matches, "opponent"), ...charactersIn(notes, "opponent")]);
  els.characterOptions.innerHTML = [...known].map((name) => `<option value="${escapeHtml(name)}"></option>`).join("");
  renderTabs();
  renderCombos();
  renderNotes();
  renderDrills();
  renderMatches();
}

function renderTabs() {
  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.setAttribute("aria-selected", String(button.dataset.tab === state.tab));
  });
  TABS.forEach((tab) => { document.getElementById(`panel-${tab}`).hidden = !state.data || tab !== state.tab; });
  els.addLabel.textContent = ADD_LABELS[state.tab];
}

function comboCard(combo) {
  const tags = [
    combo.position !== "anywhere" ? POSITIONS[combo.position] : "",
    combo.damage !== null ? `${combo.damage.toLocaleString()}ダメ` : "",
    combo.driveCost ? `Dゲージ${combo.driveCost}` : "",
    combo.saCost ? `SA${combo.saCost}` : "",
  ].filter(Boolean);
  const steps = MASTERY.map((label, level) =>
    `<button type="button" class="mastery-step${level <= combo.mastery && combo.mastery > 0 ? " on" : ""}" data-mastery="${level}" data-id="${combo.id}" aria-label="${label}" title="${label}"${level === combo.mastery ? ' aria-current="true"' : ""}></button>`).join("");
  const drill = state.data.drills.find((entry) => entry.comboId === combo.id && entry.status === "active");
  return `<article class="card combo-card">
    <div class="card-head">
      <h3>${escapeHtml(combo.title)}</h3>
      <button type="button" class="ghost-button" data-edit="combos" data-id="${combo.id}">編集</button>
    </div>
    <p class="notation">${escapeHtml(combo.notation)}</p>
    ${tags.length ? `<div class="tags">${tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>` : ""}
    ${combo.memo ? `<p class="memo">${escapeHtml(combo.memo)}</p>` : ""}
    <div class="card-foot">
      <div class="mastery" role="group" aria-label="習得度">${steps}<small>${MASTERY[combo.mastery]}</small></div>
      ${combo.archived ? "" : drill
        ? '<span class="linked">練習メニューにあり</span>'
        : `<button type="button" class="ghost-button" data-drill-from-combo="${combo.id}">練習に追加</button>`}
    </div>
  </article>`;
}

function renderCombos() {
  const combos = state.data.combos;
  fillSelect(els.comboCharacter, charactersIn(combos, "character"), state.comboCharacter, "全キャラ");
  els.comboPosition.querySelectorAll("button").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.value === state.comboPosition));
  });
  const visible = combos.filter((combo) => (!state.comboCharacter || combo.character === state.comboCharacter)
    && (!state.comboPosition || combo.position === state.comboPosition || combo.position === "anywhere"));
  const active = visible.filter((combo) => !combo.archived);
  const archived = visible.filter((combo) => combo.archived);
  const groups = new Map();
  active.forEach((combo) => groups.set(combo.character, [...(groups.get(combo.character) || []), combo]));
  els.comboList.innerHTML = active.length
    ? [...groups].map(([character, list]) => `<h2 class="list-title">${escapeHtml(character)}<small>${list.length}</small></h2>${list.map(comboCard).join("")}`).join("")
    : empty(combos.length ? "条件に合うコンボはありません" : "まだコンボがありません。右上の「＋」から追加できます");
  els.comboArchiveFold.hidden = archived.length === 0;
  els.comboArchiveCount.textContent = archived.length;
  els.comboArchive.innerHTML = archived.map(comboCard).join("");
}

function noteCard(note) {
  return `<article class="card note-card${note.pinned ? " pinned" : ""}${note.resolved ? " resolved" : ""}">
    <button type="button" class="pin-button" data-pin="${note.id}" aria-pressed="${note.pinned}" aria-label="${note.pinned ? "ピン留めを外す" : "ピン留め"}" title="ピン留め">★</button>
    <p class="note-body">${escapeHtml(note.body)}</p>
    <div class="note-actions">
      <button type="button" class="ghost-button" data-resolve="${note.id}">${note.resolved ? "戻す" : "直った"}</button>
      <button type="button" class="ghost-button" data-edit="notes" data-id="${note.id}">編集</button>
    </div>
  </article>`;
}

function sortNotes(list) {
  return [...list].sort((a, b) => Number(b.pinned) - Number(a.pinned) || String(b.createdAt).localeCompare(String(a.createdAt)));
}

function renderNotes() {
  const notes = state.data.notes;
  fillSelect(els.noteOpponent, charactersIn(notes, "opponent"), state.noteOpponent, "対キャラ：すべて");
  const open = notes.filter((note) => !note.resolved);
  const groups = [];
  if (!state.noteOpponent) {
    for (const category of ["self", "general"]) {
      const list = open.filter((note) => note.category === category);
      if (list.length) groups.push([CATEGORIES[category], list]);
    }
  }
  charactersIn(open, "opponent")
    .filter((opponent) => !state.noteOpponent || opponent === state.noteOpponent)
    .forEach((opponent) => groups.push([`vs ${opponent}`, open.filter((note) => note.opponent === opponent)]));
  els.noteGroups.innerHTML = groups.length
    ? groups.map(([title, list]) => `<h2 class="list-title">${escapeHtml(title)}<small>${list.length}</small></h2><div class="card-list">${sortNotes(list).map(noteCard).join("")}</div>`).join("")
    : empty(notes.length ? "条件に合う注意点はありません" : "まだ注意点がありません。自分の癖や対キャラの対策を書き留めましょう");
  const resolved = notes.filter((note) => note.resolved && (!state.noteOpponent || note.opponent === state.noteOpponent));
  els.noteResolvedFold.hidden = resolved.length === 0;
  els.noteResolvedCount.textContent = resolved.length;
  els.noteResolved.innerHTML = sortNotes(resolved).map(noteCard).join("");
}

function drillStats(drill) {
  const logs = state.data.logs.filter((log) => log.drillId === drill.id);
  const recent = logs.filter((log) => log.attempts !== null).slice(0, 5);
  const attempts = recent.reduce((sum, log) => sum + log.attempts, 0);
  const successes = recent.reduce((sum, log) => sum + log.successes, 0);
  return { sessions: logs.length, last: logs[0]?.practicedOn || null, rate: percent(successes, attempts), hasRate: attempts > 0 };
}

function drillCard(drill) {
  const combo = drill.comboId ? state.data.combos.find((entry) => entry.id === drill.comboId) : null;
  const stats = drillStats(drill);
  const meta = [
    stats.last ? `最終 ${daysAgo(stats.last)}` : "まだ記録なし",
    stats.sessions ? `${stats.sessions}回練習` : "",
    stats.hasRate ? `直近成功率 ${stats.rate}` : "",
  ].filter(Boolean);
  return `<article class="card drill-card${drill.status === "done" ? " done" : ""}">
    <div class="card-head">
      <h3>${escapeHtml(drill.title)}</h3>
      <button type="button" class="ghost-button" data-edit="drills" data-id="${drill.id}">編集</button>
    </div>
    ${combo ? `<p class="notation">${escapeHtml(combo.notation)}</p>` : ""}
    ${drill.detail ? `<p class="memo">${escapeHtml(drill.detail)}</p>` : ""}
    <div class="card-foot">
      <small class="meta">${meta.map(escapeHtml).join(" · ")}</small>
      ${drill.status === "active"
        ? `<button type="button" class="accent-button" data-log="${drill.id}">記録する</button>`
        : `<button type="button" class="ghost-button" data-reopen="${drill.id}">再開</button>`}
    </div>
  </article>`;
}

function renderDrills() {
  const drills = state.data.drills;
  const active = drills.filter((drill) => drill.status === "active");
  const done = drills.filter((drill) => drill.status === "done");
  els.drillList.innerHTML = active.length
    ? active.map(drillCard).join("")
    : empty("練習メニューはありません。コンボの「練習に追加」や右上の「＋」から作れます");
  els.drillDoneFold.hidden = done.length === 0;
  els.drillDoneCount.textContent = done.length;
  els.drillDone.innerHTML = done.map(drillCard).join("");
  const titles = new Map(drills.map((drill) => [drill.id, drill.title]));
  const logs = state.data.logs.slice(0, 15);
  els.logList.innerHTML = logs.length
    ? logs.map((log) => `<div class="log-row">
        <span class="log-date">${escapeHtml(formatDay(log.practicedOn))}</span>
        <span class="log-copy"><b>${escapeHtml(titles.get(log.drillId) || "")}</b>${log.note ? `<small>${escapeHtml(log.note)}</small>` : ""}</span>
        <span class="log-rate">${log.attempts !== null ? `${log.successes}/${log.attempts}` : ""}</span>
        <button type="button" class="icon-button" data-delete-log="${log.id}" aria-label="この記録を削除">×</button>
      </div>`).join("")
    : empty("まだ練習記録がありません");
}

function renderMatches() {
  const matches = state.data.matches;
  const recent = matches.slice(0, 20);
  const wins = recent.filter((match) => match.result === "win").length;
  const decided = recent.filter((match) => match.result !== "draw").length;
  const byOpponent = new Map();
  matches.forEach((match) => {
    const entry = byOpponent.get(match.opponent) || { win: 0, lose: 0, draw: 0 };
    entry[match.result] += 1;
    byOpponent.set(match.opponent, entry);
  });
  const opponents = [...byOpponent].sort((a, b) => (b[1].win + b[1].lose + b[1].draw) - (a[1].win + a[1].lose + a[1].draw)).slice(0, 8);
  els.matchStats.innerHTML = matches.length ? `
    <div class="stat-main"><span>直近${recent.length}戦</span><strong>${percent(wins, decided)}</strong><small>${wins}勝 ${decided - wins}敗</small></div>
    <div class="stat-table" role="table" aria-label="相手キャラ別の勝敗">
      ${opponents.map(([name, entry]) => `<div role="row"><span role="cell">${escapeHtml(name)}</span><span role="cell">${entry.win}-${entry.lose}</span><span role="cell" class="${entry.win < entry.lose ? "bad" : ""}">${percent(entry.win, entry.win + entry.lose)}</span></div>`).join("")}
    </div>` : "";
  els.matchList.innerHTML = matches.length
    ? matches.map((match) => `<article class="card match-card">
        <div class="card-head">
          <h3><span class="result ${match.result}">${RESULTS[match.result]}</span>${escapeHtml(match.myCharacter)} <small>vs</small> ${escapeHtml(match.opponent)}</h3>
          <button type="button" class="ghost-button" data-edit="matches" data-id="${match.id}">編集</button>
        </div>
        <small class="meta">${escapeHtml(formatDay(match.playedOn))} · ${MODES[match.mode]}</small>
        ${match.good ? `<p class="review good"><b>良</b>${escapeHtml(match.good)}</p>` : ""}
        ${match.bad ? `<p class="review bad"><b>反省</b>${escapeHtml(match.bad)}</p>` : ""}
        ${match.bad ? `<div class="card-foot end">
          <button type="button" class="ghost-button" data-note-from-match="${match.id}">注意点にする</button>
          <button type="button" class="ghost-button" data-drill-from-match="${match.id}">練習にする</button>
        </div>` : ""}
      </article>`).join("")
    : empty("まだ振り返りがありません。試合のあとに良かった点と反省点を残しましょう");
}

// ---------- 編集モーダル ----------

const FORMS = {
  combos: {
    title: "コンボ",
    fields: [
      { key: "character", label: "キャラ", type: "character", required: true },
      { key: "title", label: "名前", type: "text", max: 120, required: true, placeholder: "例：中足ラッシュ基本" },
      { key: "notation", label: "レシピ", type: "textarea", max: 1000, required: true, rows: 3, placeholder: "例：2中K > DR 5中P > 2強P xx 236強P" },
      { key: "position", label: "位置", type: "select", options: POSITIONS, half: true },
      { key: "damage", label: "ダメージ", type: "number", min: 0, max: 20000, nullable: true, half: true },
      { key: "driveCost", label: "Dゲージ", type: "select", options: { 0: "0", 1: "1", 2: "2", 3: "3", 4: "4", 5: "5", 6: "6" }, numeric: true, half: true },
      { key: "saCost", label: "SAゲージ", type: "select", options: { 0: "0", 1: "1", 2: "2", 3: "3" }, numeric: true, half: true },
      { key: "mastery", label: "習得度", type: "select", options: Object.fromEntries(MASTERY.map((label, level) => [level, label])), numeric: true },
      { key: "memo", label: "メモ", type: "textarea", max: 2000, rows: 2, placeholder: "コツ・ヒット確認の目安など" },
      { key: "archived", label: "アーカイブ（一覧から隠す）", type: "checkbox", editOnly: true },
    ],
    defaults: () => ({ character: stored("sf6-character", ""), title: "", notation: "", position: "anywhere", damage: null, driveCost: 0, saCost: 0, mastery: 0, memo: null, archived: false }),
  },
  notes: {
    title: "注意点",
    fields: [
      { key: "category", label: "種類", type: "select", options: CATEGORIES },
      { key: "opponent", label: "相手キャラ", type: "character", showIf: (values) => values.category === "matchup" },
      { key: "body", label: "内容", type: "textarea", max: 2000, required: true, rows: 4, placeholder: "例：起き攻めで暴れすぎる。まずガード" },
      { key: "pinned", label: "ピン留め（上に表示）", type: "checkbox" },
      { key: "resolved", label: "直った", type: "checkbox", editOnly: true },
    ],
    defaults: () => ({ category: state.noteOpponent ? "matchup" : "self", opponent: state.noteOpponent || null, body: "", pinned: false, resolved: false }),
  },
  drills: {
    title: "練習メニュー",
    fields: [
      { key: "title", label: "練習すること", type: "text", max: 200, required: true, placeholder: "例：中足ラッシュをヒット確認" },
      { key: "detail", label: "やり方・目標", type: "textarea", max: 2000, rows: 3, placeholder: "例：ランダムガード設定で10回中8回" },
      { key: "comboId", label: "コンボ", type: "combo" },
      { key: "status", label: "状態", type: "select", options: { active: "練習中", done: "完了" }, editOnly: true },
    ],
    defaults: () => ({ title: "", detail: null, comboId: null, status: "active" }),
  },
  logs: {
    title: "練習記録",
    fields: [
      { key: "drillId", type: "hidden", numeric: true },
      { key: "practicedOn", label: "日付", type: "date", required: true },
      { key: "attempts", label: "回数", type: "number", min: 1, max: 10000, nullable: true, half: true },
      { key: "successes", label: "成功", type: "number", min: 0, max: 10000, nullable: true, half: true },
      { key: "note", label: "メモ", type: "textarea", max: 2000, rows: 2, placeholder: "気づいたこと" },
    ],
    defaults: () => ({ drillId: null, practicedOn: state.data.today, attempts: null, successes: null, note: null }),
  },
  matches: {
    title: "振り返り",
    fields: [
      { key: "playedOn", label: "日付", type: "date", required: true, half: true },
      { key: "mode", label: "モード", type: "select", options: MODES, half: true },
      { key: "myCharacter", label: "使用キャラ", type: "character", required: true, half: true },
      { key: "opponent", label: "相手キャラ", type: "character", required: true, half: true },
      { key: "result", label: "結果", type: "radio", options: RESULTS },
      { key: "good", label: "良かった点", type: "textarea", max: 2000, rows: 2 },
      { key: "bad", label: "反省点", type: "textarea", max: 2000, rows: 3, placeholder: "あとで「注意点にする」「練習にする」で送れます" },
    ],
    defaults: () => {
      const last = state.data.matches[0];
      return { playedOn: state.data.today, mode: last?.mode || "ranked", myCharacter: last?.myCharacter || stored("sf6-character", ""), opponent: "", result: "win", good: null, bad: null };
    },
  },
};

function fieldHtml(field, value, isEdit) {
  if (field.editOnly && !isEdit) return "";
  const id = `field-${field.key}`;
  const label = `<span>${escapeHtml(field.label)}${field.required ? " <b>必須</b>" : ""}</span>`;
  const text = value === null || value === undefined ? "" : String(value);
  const half = field.half ? " half" : "";
  switch (field.type) {
    case "hidden":
      return `<input type="hidden" id="${id}" value="${escapeHtml(text)}" />`;
    case "checkbox":
      return `<label class="check-field" data-field="${field.key}"><input type="checkbox" id="${id}"${value ? " checked" : ""} /><span>${escapeHtml(field.label)}</span></label>`;
    case "textarea":
      return `<label data-field="${field.key}">${label}<textarea id="${id}" rows="${field.rows || 3}" maxlength="${field.max}" placeholder="${escapeHtml(field.placeholder || "")}">${escapeHtml(text)}</textarea></label>`;
    case "select":
      return `<label class="${half}" data-field="${field.key}">${label}<select id="${id}">${options(field.options, text)}</select></label>`;
    case "radio":
      return `<fieldset class="radio-field" data-field="${field.key}"><legend>${escapeHtml(field.label)}</legend>${Object.entries(field.options).map(([option, name]) =>
        `<label><input type="radio" name="${field.key}" value="${option}"${option === text ? " checked" : ""} /><span>${escapeHtml(name)}</span></label>`).join("")}</fieldset>`;
    case "combo": {
      const combos = state.data.combos.filter((combo) => !combo.archived || combo.id === value);
      const list = combos.map((combo) => `<option value="${combo.id}"${combo.id === value ? " selected" : ""}>${escapeHtml(`${combo.character}：${combo.title}`)}</option>`).join("");
      return `<label data-field="${field.key}">${label}<select id="${id}"><option value="">なし</option>${list}</select></label>`;
    }
    case "character":
      return `<label class="${half}" data-field="${field.key}">${label}<input id="${id}" list="characterOptions" maxlength="40" autocomplete="off" value="${escapeHtml(text)}" placeholder="キャラ名" /></label>`;
    case "number":
      return `<label class="${half}" data-field="${field.key}">${label}<input id="${id}" type="number" inputmode="numeric" min="${field.min}" max="${field.max}" step="1" value="${escapeHtml(text)}" /></label>`;
    case "date":
      return `<label class="${half}" data-field="${field.key}">${label}<input id="${id}" type="date" max="${state.data.today}" value="${escapeHtml(text)}" /></label>`;
    default:
      return `<label class="${half}" data-field="${field.key}">${label}<input id="${id}" maxlength="${field.max}" placeholder="${escapeHtml(field.placeholder || "")}" value="${escapeHtml(text)}" /></label>`;
  }
}

/** モーダルの入力値を読む。空欄の任意項目は null。 */
function readForm(resource, base) {
  const values = { ...base };
  for (const field of FORMS[resource].fields) {
    if (field.editOnly && !state.editing.item) continue;
    if (field.type === "radio") {
      values[field.key] = els.formFields.querySelector(`input[name="${field.key}"]:checked`)?.value || base[field.key];
      continue;
    }
    const input = document.getElementById(`field-${field.key}`);
    if (!input) continue;
    if (field.type === "checkbox") values[field.key] = input.checked;
    else if (field.type === "number" || field.type === "combo" || field.numeric) {
      values[field.key] = input.value === "" ? null : Number(input.value);
    } else values[field.key] = input.value.trim() || null;
  }
  return values;
}

function syncConditional(resource) {
  const values = readForm(resource, state.editing.values);
  FORMS[resource].fields.filter((field) => field.showIf).forEach((field) => {
    const wrapper = els.formFields.querySelector(`[data-field="${field.key}"]`);
    if (wrapper) wrapper.hidden = !field.showIf(values);
  });
}

function openModal(resource, item = null, preset = {}) {
  const form = FORMS[resource];
  const values = item ? { ...item } : { ...form.defaults(), ...preset };
  state.editing = { resource, item, values };
  els.modalTitle.textContent = `${form.title}を${item ? "編集" : "追加"}`;
  els.formFields.innerHTML = form.fields.map((field) => fieldHtml(field, values[field.key], Boolean(item))).join("");
  els.formError.hidden = true;
  els.deleteButton.hidden = !item;
  els.saveButton.textContent = item ? "保存する" : "追加する";
  syncConditional(resource);
  els.editModal.hidden = false;
  const first = els.formFields.querySelector("input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=date]), textarea");
  // スマホで勝手にキーボードが開かないよう、フォーカスはPC幅のときだけ
  if (first && window.matchMedia("(min-width: 681px)").matches) first.focus();
}

function closeModal() {
  els.editModal.hidden = true;
  state.editing = null;
}

function validate(resource, values) {
  for (const field of FORMS[resource].fields) {
    const wrapper = els.formFields.querySelector(`[data-field="${field.key}"]`);
    if (wrapper?.hidden) continue;
    if (field.required && (values[field.key] === null || values[field.key] === "")) return `「${field.label}」を入力してください。`;
    if (field.type === "number" && values[field.key] !== null
      && (!Number.isInteger(values[field.key]) || values[field.key] < field.min || values[field.key] > field.max)) {
      return `「${field.label}」は${field.min}〜${field.max}の整数で入力してください。`;
    }
  }
  if (resource === "notes" && values.category === "matchup" && !values.opponent) return "相手キャラを入力してください。";
  if (resource === "logs" && (values.attempts === null) !== (values.successes === null)) return "回数と成功は両方入力するか、両方空欄にしてください。";
  if (resource === "logs" && values.attempts !== null && values.successes > values.attempts) return "成功は回数以下にしてください。";
  return null;
}

async function submitModal(event) {
  event.preventDefault();
  if (!state.editing || state.saving) return;
  const { resource, item } = state.editing;
  const values = readForm(resource, state.editing.values);
  if (resource === "notes" && values.category !== "matchup") values.opponent = null;
  const problem = validate(resource, values);
  if (problem) {
    els.formError.textContent = problem;
    els.formError.hidden = false;
    return;
  }
  const fields = Object.fromEntries(Object.keys(FORMS[resource].defaults()).map((key) => [key, values[key]]));
  state.saving = true;
  els.saveButton.disabled = true;
  try {
    const saved = item
      ? await send("PATCH", resource, { id: item.id, updatedAt: item.updatedAt, ...fields })
      : await send("POST", resource, fields);
    if (resource === "logs") state.data.logs.unshift(saved);
    else replaceItem(resource, saved);
    if (resource === "logs") state.data.logs.sort((a, b) => b.practicedOn.localeCompare(a.practicedOn) || b.id - a.id);
    if (resource === "combos" && fields.character) store("sf6-character", fields.character);
    if (resource === "matches") store("sf6-character", fields.myCharacter);
    closeModal();
    render();
    showToast(item ? "保存しました" : "追加しました");
  } catch (error) {
    els.formError.textContent = error instanceof Error ? error.message : "保存できませんでした。";
    els.formError.hidden = false;
  } finally {
    state.saving = false;
    els.saveButton.disabled = false;
  }
}

async function deleteItem(resource, id, label) {
  if (!window.confirm(`${label}を削除しますか？元に戻せません。`)) return false;
  try {
    await send("DELETE", resource, { id });
    removeItem(resource, id);
    render();
    showToast("削除しました");
    return true;
  } catch (error) {
    showToast(error instanceof Error ? error.message : "削除できませんでした。");
    return false;
  }
}

// ---------- イベント ----------

function find(resource, id) {
  return state.data[resource].find((item) => item.id === Number(id));
}

function selectTab(tab) {
  if (!TABS.includes(tab)) return;
  state.tab = tab;
  store("sf6-tab", tab);
  if (state.data) renderTabs();
}

document.querySelectorAll("[data-tab]").forEach((button) => {
  button.addEventListener("click", () => selectTab(button.dataset.tab));
});

els.comboCharacter.addEventListener("change", () => {
  state.comboCharacter = els.comboCharacter.value;
  store("sf6-combo-character", state.comboCharacter);
  renderCombos();
});
els.comboPosition.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-value]");
  if (!button) return;
  state.comboPosition = button.dataset.value;
  renderCombos();
});
els.noteOpponent.addEventListener("change", () => {
  state.noteOpponent = els.noteOpponent.value;
  renderNotes();
});

document.querySelector("main").addEventListener("click", async (event) => {
  const target = event.target.closest("button");
  if (!target || !state.data) return;
  const { dataset } = target;
  if (dataset.edit) openModal(dataset.edit, find(dataset.edit, dataset.id));
  else if (dataset.mastery !== undefined) {
    const combo = find("combos", dataset.id);
    const level = Number(dataset.mastery);
    // 今の段階をもう一度押すと1段下げる
    const next = level === combo.mastery ? Math.max(0, level - 1) : level;
    if (next !== combo.mastery) await patch("combos", combo, { mastery: next }, `習得度：${MASTERY[next]}`);
  } else if (dataset.drillFromCombo) {
    const combo = find("combos", dataset.drillFromCombo);
    openModal("drills", null, { title: `${combo.title}（${combo.character}）`, comboId: combo.id });
  } else if (dataset.pin) {
    const note = find("notes", dataset.pin);
    await patch("notes", note, { pinned: !note.pinned });
  } else if (dataset.resolve) {
    const note = find("notes", dataset.resolve);
    await patch("notes", note, { resolved: !note.resolved }, note.resolved ? "注意点に戻しました" : "直ったものに移しました");
  } else if (dataset.log) {
    openModal("logs", null, { drillId: Number(dataset.log) });
    els.modalTitle.textContent = `記録：${find("drills", dataset.log).title}`;
  } else if (dataset.reopen) {
    await patch("drills", find("drills", dataset.reopen), { status: "active" }, "練習中に戻しました");
  } else if (dataset.deleteLog) {
    await deleteItem("logs", Number(dataset.deleteLog), "この練習記録");
  } else if (dataset.noteFromMatch) {
    const match = find("matches", dataset.noteFromMatch);
    openModal("notes", null, { category: "matchup", opponent: match.opponent, body: match.bad });
  } else if (dataset.drillFromMatch) {
    const match = find("matches", dataset.drillFromMatch);
    openModal("drills", null, { title: match.bad.split("\n")[0].slice(0, 200), detail: `vs ${match.opponent}（${match.playedOn}の振り返りから）` });
  }
});

els.addButton.addEventListener("click", () => {
  if (!state.data) return;
  if (state.tab === "combos") openModal("combos", null, state.comboCharacter ? { character: state.comboCharacter } : {});
  else openModal(state.tab);
});
els.formFields.addEventListener("change", () => { if (state.editing) syncConditional(state.editing.resource); });
els.editForm.addEventListener("submit", submitModal);
els.modalClose.addEventListener("click", closeModal);
els.cancelButton.addEventListener("click", closeModal);
els.editModal.addEventListener("click", (event) => { if (event.target === els.editModal) closeModal(); });
document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !els.editModal.hidden) closeModal(); });
els.deleteButton.addEventListener("click", async () => {
  if (!state.editing?.item) return;
  const { resource, item } = state.editing;
  if (await deleteItem(resource, item.id, `この${FORMS[resource].title}`)) closeModal();
});
els.refreshButton.addEventListener("click", load);
els.retryButton.addEventListener("click", () => {
  els.errorState.hidden = true;
  els.loadingState.hidden = false;
  load();
});

const requestedTab = new URL(window.location.href).searchParams.get("tab");
state.tab = TABS.includes(requestedTab) ? requestedTab : TABS.includes(stored("sf6-tab", "")) ? stored("sf6-tab", "") : "combos";
state.comboCharacter = stored("sf6-combo-character", "");
renderTabs();
load();
