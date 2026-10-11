import { readApiJson } from "./api-client.js";
import { ARROWS, appendFragment, appendToken, frequentFragments, parseNotation, removeLastToken } from "./sf6-notation.js";
import { bestStreakOf, MASTERY, setplaysAfter, shouldRaiseMastery, situationOptions, STREAK_GOAL, usableNow } from "./sf6-plan.js";

// SF6ページ。コンボ帳・起き攻め・注意点・練習メニュー・対戦振り返りの5タブ。
// 編集は1つのモーダルを使い回し、FORMS の定義から入力欄を組み立てる。

const CHARACTERS = [
  "リュウ", "ルーク", "ジェイミー", "春麗", "ガイル", "キンバリー", "ジュリ", "ケン", "ブランカ", "ダルシム",
  "エドモンド本田", "ディージェイ", "マノン", "マリーザ", "JP", "ザンギエフ", "リリー", "キャミィ",
  "ラシード", "A.K.I.", "エド", "豪鬼", "ベガ", "テリー", "舞", "エレナ", "サガット", "C.ヴァイパー", "アレックス", "イングリッド",
];
const POSITIONS = { anywhere: "どこでも", midscreen: "画面中央", corner: "画面端" };
const CATEGORIES = { self: "自分の癖", general: "立ち回り", matchup: "対キャラ" };
const RESULTS = { win: "勝ち", lose: "負け", draw: "引き分け" };
const MODES = { ranked: "ランクマ", casual: "カジュアル", battle_hub: "バトルハブ", tournament: "大会", other: "その他" };
const SA_LEVELS = { 0: "なし", 1: "SA1", 2: "SA2", 3: "SA3", 4: "CA" };
const DRIVE_STEPS = Object.fromEntries(Array.from({ length: 13 }, (_, index) => [String(index / 2), String(index / 2)]));
const RECOVERIES = { back_roll: "後ろ受け身 可", no_back_roll: "後ろ受け身 不可", none: "ダウンなし" };
const END_PURPOSES = { damage: "ダメージ重視", oki: "起き攻め重視", carry: "運び重視" };
const LAYERINGS = { meaty: "持続重ね", safe_jump: "安全飛び", other: "その他" };
const AIMS = { strike: "打撃", throw: "投げ", shimmy: "シミー" };
const CHECKED = { ok: "対応", ng: "非対応", unknown: "未確認" };
const OPPONENT_OPTIONS = {
  reversal: "無敵技", backdash: "バクステ", jump: "ジャンプ", tech: "グラップ",
  delay_tech: "遅らせグラップ", parry: "パリィ", drive_reversal: "ドライブリバーサル",
};
const OUTCOME_MARKS = { win: "○", lose: "×", unknown: "–" };
const GUARD_SETTINGS = { none: "ガードしない", all: "全部ガード", random: "ランダムガード" };
const COUNTER_SETTINGS = { normal: "通常", counter: "カウンター", punish_counter: "パニッシュカウンター", random: "ランダム" };
const RECOVERY_SETTINGS = { neutral: "その場起き", back: "後ろ受け身", random: "受け身ランダム" };
const TABS = ["combos", "setplays", "notes", "drills", "matches"];
const ADD_LABELS = { combos: "コンボを追加", setplays: "起き攻めを追加", notes: "注意点を追加", drills: "練習を追加", matches: "振り返りを追加" };

const state = {
  data: null,
  tab: "combos",
  comboCharacter: "",
  comboPosition: "",
  /** 「状況から引く」の条件。drive・saはnullなら指定なし。 */
  conditions: { situation: "", drive: null, sa: null, ca: false, burnout: false },
  setplayCharacter: "",
  noteOpponent: "",
  /** モーダルで編集中の記録。{ resource, item(null=追加), values } */
  editing: null,
  saving: false,
};

const ids = [
  "sourceBadge", "refreshButton", "addButton", "addLabel", "loadingState", "errorState", "errorMessage", "retryButton",
  "countCombos", "countSetplays", "countNotes", "countDrills", "countMatches",
  "comboCharacter", "comboPosition", "comboSituation", "comboConditions", "conditionDrive", "conditionSa", "conditionCa", "conditionBurnout",
  "conditionSummary", "comboList", "comboArchiveFold", "comboArchiveCount", "comboArchive",
  "setplayCharacter", "setplayList", "setplayArchiveFold", "setplayArchiveCount", "setplayArchive",
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

function frames(value) {
  return value === null || value === undefined ? "" : `${value > 0 ? "+" : ""}${value}F`;
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

function chips(list) {
  return list.length ? `<div class="tags">${list.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>` : "";
}

/** レシピを矢印と色付きのボタンで表示する。読めない語は文字のまま出す。 */
function notationHtml(text) {
  const parts = parseNotation(text).map((part) => {
    if (part.type === "command" || part.type === "motion") {
      const jump = part.jump ? '<span class="cmd-jump" title="ジャンプ">J</span>' : "";
      const arrows = part.arrows.length ? `<span class="cmd-arrows">${part.arrows.map(escapeHtml).join("")}</span>` : "";
      const button = part.type === "command"
        ? `<span class="cmd-button ${part.limb} ${part.strength}">${escapeHtml(part.button)}</span>`
        : "";
      return `<span class="cmd">${jump}${arrows}${button}</span>`;
    }
    if (part.type === "link") return `<span class="cmd-link ${part.kind}" title="${escapeHtml(part.title)}">${escapeHtml(part.label)}</span>`;
    return `<span class="cmd-text">${escapeHtml(part.text)}</span>`;
  });
  return `<div class="notation" aria-label="${escapeHtml(text)}">${parts.join("")}</div>`;
}

const PALETTE = {
  directions: ["7", "8", "9", "4", "5", "6", "1", "2", "3"],
  attacks: ["弱P", "中P", "強P", "PP", "弱K", "中K", "強K", "KK"],
  motions: [["236", "波動"], ["214", "竜巻"], ["623", "昇龍"], ["41236", "半回転"], ["22", "↓↓"], ["J", "ジャンプ"]],
  links: [">", "xx", "TC", "DR", "DI", "パリィ", "投げ", "SA1", "SA2", "SA3", "CA"],
  moves: ["前ステ", "バクステ", "前歩き", "微歩き", "垂直J", "前J", "空振り", "重ね", "待ち"],
};
const LINK_LABELS = { ">": "› つなぎ", xx: "キャンセル" };

/** withMoves: 起き攻め用に移動・タイミングの基準の行を先頭に出す。 */
function paletteHtml(withMoves) {
  const key = (token, label, className = "") =>
    `<button type="button" class="pal-key ${className}" data-token="${escapeHtml(token)}">${escapeHtml(label)}</button>`;
  return `<div class="palette" role="group" aria-label="手順の入力パレット">
    ${withMoves ? `<div class="pal-row">${PALETTE.moves.map((token) => key(token, token, "move")).join("")}</div>` : ""}
    <div class="pal-row pal-main">
      <div class="pal-pad">${PALETTE.directions.map((digit) => key(digit, ARROWS[digit], "dir")).join("")}</div>
      <div class="pal-attacks">${PALETTE.attacks.map((button) => key(button, button, `atk ${button.endsWith("P") ? "punch" : "kick"}`)).join("")}</div>
    </div>
    <div class="pal-row">${PALETTE.motions.map(([token, label]) => key(token, label, "motion")).join("")}</div>
    <div class="pal-row">${PALETTE.links.map((token) => key(token, LINK_LABELS[token] || token, "link")).join("")}</div>
    <div class="pal-row pal-edit">
      <button type="button" class="pal-key edit" data-palette="backspace">⌫ 1つ戻す</button>
      <button type="button" class="pal-key edit" data-palette="clear">クリア</button>
    </div>
  </div>`;
}

/** よく使う出だし。フォームのキャラの記録から拾い、なければ全キャラから。 */
function fragmentsHtml(resource, character) {
  const list = state.data[resource].filter((item) => !item.archived);
  const own = list.filter((item) => item.character === character);
  const fragments = frequentFragments((own.length ? own : list).map((item) => item.notation));
  if (!fragments.length) return "";
  return `<span class="frag-label">よく使う</span>${fragments.map((fragment) =>
    `<button type="button" class="frag" data-fragment="${escapeHtml(fragment)}">${escapeHtml(fragment)}</button>`).join("")}`;
}

function refreshNotationAssist() {
  const input = document.getElementById("field-notation");
  if (!input || !state.editing) return;
  const preview = document.getElementById("notationPreview");
  preview.innerHTML = input.value.trim() ? notationHtml(input.value) : '<p class="notation-empty">下のボタンを押すとここに手順が並びます</p>';
  const fragments = document.getElementById("notationFragments");
  const character = document.getElementById("field-character")?.value.trim() || "";
  fragments.innerHTML = fragmentsHtml(state.editing.resource, character);
  fragments.hidden = !fragments.innerHTML;
}

function editNotation(change) {
  const input = document.getElementById("field-notation");
  if (!input) return;
  input.value = change(input.value).slice(0, 1000);
  refreshNotationAssist();
}

// ---------- 通信 ----------

async function load() {
  els.refreshButton.disabled = true;
  try {
    const response = await fetch("/api/sf6", { headers: { Accept: "application/json" }, cache: "no-store" });
    const payload = await readApiJson(response);
    if (!response.ok) throw new Error(errorMessage(payload, "読み込みに失敗しました。"));
    state.data = { setplays: [], ...payload };
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

/** DB側の「削除時にnullにする」紐づけを手元にも反映する。 */
function removeItem(resource, id) {
  state.data[resource] = state.data[resource].filter((entry) => entry.id !== id);
  if (resource === "drills") state.data.logs = state.data.logs.filter((log) => log.drillId !== id);
  if (resource === "combos") {
    state.data.drills.forEach((drill) => { if (drill.comboId === id) drill.comboId = null; });
    state.data.setplays.forEach((setplay) => {
      if (setplay.followComboId === id) setplay.followComboId = null;
    });
  }
  if (resource === "setplays") state.data.drills.forEach((drill) => { if (drill.setplayId === id) drill.setplayId = null; });
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
  const { combos, setplays, notes, drills, matches } = state.data;
  els.countCombos.textContent = combos.filter((combo) => !combo.archived).length || "";
  els.countSetplays.textContent = setplays.filter((setplay) => !setplay.archived).length || "";
  els.countNotes.textContent = notes.filter((note) => !note.resolved).length || "";
  els.countDrills.textContent = drills.filter((drill) => drill.status === "active").length || "";
  els.countMatches.textContent = matches.length || "";
  const known = new Set([...CHARACTERS, ...charactersIn(combos, "character"), ...charactersIn(matches, "opponent"), ...charactersIn(notes, "opponent")]);
  els.characterOptions.innerHTML = [...known].map((name) => `<option value="${escapeHtml(name)}"></option>`).join("");
  renderTabs();
  renderCombos();
  renderSetplays();
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

function masteryHtml(resource, item) {
  const steps = MASTERY.map((label, level) =>
    `<button type="button" class="mastery-step${level <= item.mastery && item.mastery > 0 ? " on" : ""}" data-mastery="${level}" data-resource="${resource}" data-id="${item.id}" aria-label="${label}" title="${label}"${level === item.mastery ? ' aria-current="true"' : ""}></button>`).join("");
  return `<div class="mastery" role="group" aria-label="習得度">${steps}<small>${MASTERY[item.mastery]}</small></div>`;
}

function endLine(combo) {
  const parts = [
    combo.endAdvantage !== null ? `締め後 ${frames(combo.endAdvantage)}` : "",
    combo.recovery ? RECOVERIES[combo.recovery] : "",
    combo.endPurpose ? END_PURPOSES[combo.endPurpose] : "",
  ].filter(Boolean);
  return parts.length ? `<p class="end-line">${parts.map(escapeHtml).join(" · ")}</p>` : "";
}

function comboCard(combo) {
  const conditions = [
    combo.position !== "anywhere" ? POSITIONS[combo.position] : "",
    combo.damage !== null ? `${combo.damage.toLocaleString()}ダメ` : "",
    combo.driveCost ? `Dゲージ${combo.driveCost}` : "",
    combo.saCost ? SA_LEVELS[combo.saCost] : "",
    combo.burnoutOk ? "バーンアウト中も可" : "",
  ].filter(Boolean);
  const drill = state.data.drills.find((entry) => entry.comboId === combo.id && entry.status === "active");
  const next = combo.archived ? [] : setplaysAfter(combo, state.data.setplays);
  const nextHtml = next.length
    ? `<div class="next-setplays"><span>起き攻め</span>${next.map(({ setplay, fit }) =>
      `<button type="button" class="next-chip ${fit}" data-goto-setplay="${setplay.id}" title="${fit === "near" ? "有利Fが1〜2Fずれています。重ねが変わる可能性があります" : ""}">${escapeHtml(setplay.title)}${fit === "near" ? ` <small>${escapeHtml(frames(setplay.startAdvantage))} 注意</small>` : ""}</button>`).join("")}</div>`
    : "";
  return `<article class="card combo-card">
    <div class="card-head">
      <h3>${escapeHtml(combo.title)}</h3>
      <button type="button" class="ghost-button" data-edit="combos" data-id="${combo.id}">編集</button>
    </div>
    ${combo.situations.length ? `<div class="situations">${combo.situations.map((situation) => `<span>${escapeHtml(situation)}</span>`).join("")}</div>` : ""}
    ${notationHtml(combo.notation)}
    ${chips(conditions)}
    ${endLine(combo)}
    ${nextHtml}
    ${combo.memo ? `<p class="memo">${escapeHtml(combo.memo)}</p>` : ""}
    <div class="card-foot">
      ${masteryHtml("combos", combo)}
      <span class="foot-actions">
        ${combo.archived || combo.endAdvantage === null ? "" : `<button type="button" class="ghost-button" data-setplay-from-combo="${combo.id}">起き攻めを追加</button>`}
        ${combo.archived ? "" : drill
          ? '<span class="linked">練習中</span>'
          : `<button type="button" class="ghost-button" data-drill-from-combo="${combo.id}">練習に追加</button>`}
      </span>
    </div>
  </article>`;
}

function conditionsActive() {
  const { situation, drive, sa, burnout } = state.conditions;
  return Boolean(situation) || drive !== null || sa !== null || burnout;
}

function renderCombos() {
  const combos = state.data.combos;
  fillSelect(els.comboCharacter, charactersIn(combos, "character"), state.comboCharacter, "全キャラ");
  const situations = situationOptions(combos);
  fillSelect(els.comboSituation, situations, state.conditions.situation, "状況：すべて");
  els.comboPosition.querySelectorAll("button").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.value === state.comboPosition));
  });
  const { drive, sa, ca, burnout } = state.conditions;
  els.conditionDrive.value = drive === null ? "" : String(drive);
  els.conditionSa.value = sa === null ? "" : String(sa);
  els.conditionCa.checked = ca;
  els.conditionBurnout.checked = burnout;
  const summary = [drive !== null ? `Dゲージ${drive}` : "", sa !== null ? `SA${sa}本` : "", ca ? "CA可" : "", burnout ? "バーンアウト中" : ""].filter(Boolean);
  els.conditionSummary.textContent = summary.length ? summary.join("・") : "指定なし";
  const visible = combos.filter((combo) => (!state.comboCharacter || combo.character === state.comboCharacter)
    && usableNow(combo, { ...state.conditions, position: state.comboPosition }));
  const active = visible.filter((combo) => !combo.archived);
  // 状況・条件で絞ったときは、ダメージの大きい順に並べる
  if (conditionsActive()) active.sort((a, b) => (b.damage ?? -1) - (a.damage ?? -1));
  const archived = visible.filter((combo) => combo.archived);
  const groups = new Map();
  active.forEach((combo) => groups.set(combo.character, [...(groups.get(combo.character) || []), combo]));
  els.comboList.innerHTML = active.length
    ? [...groups].map(([character, list]) => `<h2 class="list-title">${escapeHtml(character)}<small>${list.length}</small></h2>${list.map(comboCard).join("")}`).join("")
    : empty(combos.length ? "この状況・条件で使えるコンボはありません" : "まだコンボがありません。右上の「＋」から追加できます");
  els.comboArchiveFold.hidden = archived.length === 0;
  els.comboArchiveCount.textContent = archived.length;
  els.comboArchive.innerHTML = archived.map(comboCard).join("");
}

function outcomesHtml(outcomes) {
  if (!Object.keys(outcomes).length) return '<p class="meta outcomes-empty">相手の行動ごとの結果：未確認</p>';
  return `<div class="outcomes" aria-label="相手の行動ごとの結果">${Object.entries(OPPONENT_OPTIONS).map(([key, label]) => {
    const value = outcomes[key] || "unknown";
    return `<span class="outcome ${value}" title="${escapeHtml(label)}：${value === "win" ? "こちらが勝つ" : value === "lose" ? "こちらが負ける" : "未確認"}"><b>${OUTCOME_MARKS[value]}</b>${escapeHtml(label)}</span>`;
  }).join("")}</div>`;
}

function setplayCard(setplay) {
  const combos = state.data.combos.filter((combo) => setplay.comboIds.includes(combo.id));
  const follow = setplay.followComboId ? state.data.combos.find((combo) => combo.id === setplay.followComboId) : null;
  const start = [frames(setplay.startAdvantage), POSITIONS[setplay.position], RECOVERIES[setplay.recovery]].filter(Boolean);
  const tags = [
    AIMS[setplay.aim],
    setplay.layering ? LAYERINGS[setplay.layering] : "",
    setplay.recovery === "back_roll" ? `後ろ受け身：${CHECKED[setplay.backRollOk]}` : "",
  ].filter(Boolean);
  const drill = state.data.drills.find((entry) => entry.setplayId === setplay.id && entry.status === "active");
  return `<article class="card setplay-card" id="setplay-${setplay.id}">
    <div class="card-head">
      <h3>${escapeHtml(setplay.title)}</h3>
      <button type="button" class="ghost-button" data-edit="setplays" data-id="${setplay.id}">編集</button>
    </div>
    <p class="start-line"><b>起点</b>${escapeHtml(start.join(" · "))}${combos.length ? `<span>${combos.map((combo) => escapeHtml(combo.title)).join("、")}の後</span>` : ""}</p>
    ${notationHtml(setplay.notation)}
    ${chips(tags)}
    ${outcomesHtml(setplay.outcomes)}
    ${follow ? `<p class="end-line">重ねがヒットしたら → ${escapeHtml(follow.title)}</p>` : ""}
    ${setplay.memo ? `<p class="memo">${escapeHtml(setplay.memo)}</p>` : ""}
    <div class="card-foot">
      ${masteryHtml("setplays", setplay)}
      ${setplay.archived ? "" : drill
        ? '<span class="linked">練習中</span>'
        : `<button type="button" class="ghost-button" data-drill-from-setplay="${setplay.id}">練習に追加</button>`}
    </div>
  </article>`;
}

function renderSetplays() {
  const setplays = state.data.setplays;
  fillSelect(els.setplayCharacter, charactersIn(setplays, "character"), state.setplayCharacter, "全キャラ");
  const visible = setplays.filter((setplay) => !state.setplayCharacter || setplay.character === state.setplayCharacter);
  const active = visible.filter((setplay) => !setplay.archived);
  const archived = visible.filter((setplay) => setplay.archived);
  const groups = new Map();
  active.forEach((setplay) => groups.set(setplay.character, [...(groups.get(setplay.character) || []), setplay]));
  els.setplayList.innerHTML = active.length
    ? [...groups].map(([character, list]) => `<h2 class="list-title">${escapeHtml(character)}<small>${list.length}</small></h2>${list
      .sort((a, b) => b.startAdvantage - a.startAdvantage).map(setplayCard).join("")}`).join("")
    : empty(setplays.length ? "条件に合う起き攻めはありません" : "まだ起き攻めがありません。コンボの「起き攻めを追加」から作ると、締めの有利Fが入ります");
  els.setplayArchiveFold.hidden = archived.length === 0;
  els.setplayArchiveCount.textContent = archived.length;
  els.setplayArchive.innerHTML = archived.map(setplayCard).join("");
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

function drillTarget(drill) {
  if (drill.comboId) {
    const combo = state.data.combos.find((entry) => entry.id === drill.comboId);
    if (combo) return { resource: "combos", item: combo };
  }
  if (drill.setplayId) {
    const setplay = state.data.setplays.find((entry) => entry.id === drill.setplayId);
    if (setplay) return { resource: "setplays", item: setplay };
  }
  return null;
}

function drillStats(drill) {
  const logs = state.data.logs.filter((log) => log.drillId === drill.id);
  const recent = logs.filter((log) => log.attempts !== null).slice(0, 5);
  const attempts = recent.reduce((sum, log) => sum + log.attempts, 0);
  const successes = recent.reduce((sum, log) => sum + log.successes, 0);
  return { logs, sessions: logs.length, last: logs[0]?.practicedOn || null, rate: percent(successes, attempts), hasRate: attempts > 0, streak: bestStreakOf(logs) };
}

function trainerChips(drill) {
  return [
    drill.guardSetting ? GUARD_SETTINGS[drill.guardSetting] : "",
    drill.counterSetting ? COUNTER_SETTINGS[drill.counterSetting] : "",
    drill.recoverySetting ? RECOVERY_SETTINGS[drill.recoverySetting] : "",
    drill.reversalRecorded ? "無敵技を録画再生" : "",
  ].filter(Boolean);
}

function drillCard(drill) {
  const target = drillTarget(drill);
  const stats = drillStats(drill);
  const meta = [
    stats.last ? `最終 ${daysAgo(stats.last)}` : "まだ記録なし",
    stats.sessions ? `${stats.sessions}回練習` : "",
    stats.hasRate ? `直近成功率 ${stats.rate}` : "",
    stats.streak ? `最高${stats.streak}連続` : "",
  ].filter(Boolean);
  const raise = drill.status === "active" && target && shouldRaiseMastery(target.item, stats.logs)
    ? `<button type="button" class="raise-button" data-raise="${drill.id}">${STREAK_GOAL}連続達成 → 習得度を「${MASTERY[2]}」にする</button>`
    : "";
  const settings = trainerChips(drill);
  return `<article class="card drill-card${drill.status === "done" ? " done" : ""}">
    <div class="card-head">
      <h3>${escapeHtml(drill.title)}</h3>
      <button type="button" class="ghost-button" data-edit="drills" data-id="${drill.id}">編集</button>
    </div>
    ${target ? `${target.resource === "setplays" ? '<span class="kind-label">起き攻め</span>' : ""}${notationHtml(target.item.notation)}` : ""}
    ${settings.length ? `<div class="tags trainer"><span class="trainer-label">トレモ</span>${settings.map((setting) => `<span>${escapeHtml(setting)}</span>`).join("")}</div>` : ""}
    ${drill.detail ? `<p class="memo">${escapeHtml(drill.detail)}</p>` : ""}
    ${raise}
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
    : empty("練習メニューはありません。コンボや起き攻めの「練習に追加」、右上の「＋」から作れます");
  els.drillDoneFold.hidden = done.length === 0;
  els.drillDoneCount.textContent = done.length;
  els.drillDone.innerHTML = done.map(drillCard).join("");
  const titles = new Map(drills.map((drill) => [drill.id, drill.title]));
  const logs = state.data.logs.slice(0, 15);
  els.logList.innerHTML = logs.length
    ? logs.map((log) => `<div class="log-row">
        <span class="log-date">${escapeHtml(formatDay(log.practicedOn))}</span>
        <span class="log-copy"><b>${escapeHtml(titles.get(log.drillId) || "")}</b>${log.note ? `<small>${escapeHtml(log.note)}</small>` : ""}</span>
        <span class="log-rate">${log.attempts !== null ? `${log.successes}/${log.attempts}` : ""}${log.bestStreak ? `<small>${log.bestStreak}連続</small>` : ""}</span>
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

const MASTERY_OPTIONS = Object.fromEntries(MASTERY.map((label, level) => [level, label]));
const FRAME_HINT = "トレモのフレームメーターで、相手が起き上がって動けるまでに自分が先に動けるF";

const FORMS = {
  combos: {
    title: "コンボ",
    fields: [
      { key: "character", label: "キャラ", type: "character", required: true },
      { key: "title", label: "名前", type: "text", max: 120, required: true, placeholder: "例：中足ラッシュ基本" },
      { key: "situations", label: "使える状況", type: "situations", required: true },
      { key: "notation", label: "レシピ", type: "notation", max: 1000, required: true },
      { key: "position", label: "位置", type: "select", options: POSITIONS, half: true },
      { key: "damage", label: "ダメージ", type: "number", min: 0, max: 20000, nullable: true, half: true },
      { key: "driveCost", label: "Dゲージ", type: "select", options: DRIVE_STEPS, numeric: true, half: true },
      { key: "saCost", label: "SA", type: "select", options: SA_LEVELS, numeric: true, half: true },
      { key: "burnoutOk", label: "バーンアウト中も使える", type: "checkbox" },
      { key: "endAdvantage", label: "締め後の有利F", type: "number", min: -99, max: 300, nullable: true, required: true, hint: FRAME_HINT, placeholder: "例：31" },
      { key: "recovery", label: "ダウン", type: "select", options: { "": "未設定", ...RECOVERIES }, half: true },
      { key: "endPurpose", label: "締めの目的", type: "select", options: { "": "未設定", ...END_PURPOSES }, half: true },
      { key: "mastery", label: "習得度", type: "select", options: MASTERY_OPTIONS, numeric: true },
      { key: "memo", label: "メモ", type: "textarea", max: 2000, rows: 2, placeholder: "コツ・ヒット確認の目安など" },
      { key: "archived", label: "アーカイブ（一覧から隠す）", type: "checkbox", editOnly: true },
    ],
    defaults: () => ({
      character: stored("sf6-character", ""), title: "", situations: [], notation: "", position: "anywhere", damage: null,
      driveCost: 0, saCost: 0, burnoutOk: false, endAdvantage: null, recovery: null, endPurpose: null, mastery: 0, memo: null, archived: false,
    }),
  },
  setplays: {
    title: "起き攻め",
    fields: [
      { key: "character", label: "キャラ", type: "character", required: true },
      { key: "title", label: "名前", type: "text", max: 120, required: true, placeholder: "例：強昇龍締め 前ステ中P重ね" },
      { key: "comboIds", label: "起点のコンボ（締め）", type: "comboIds", hint: "選ぶと有利F・位置・ダウンがそのコンボから入ります" },
      { key: "startAdvantage", label: "起点の有利F", type: "number", min: -99, max: 300, required: true, hint: FRAME_HINT },
      { key: "position", label: "位置", type: "select", options: POSITIONS, half: true },
      { key: "recovery", label: "ダウン", type: "select", options: RECOVERIES, half: true },
      { key: "notation", label: "手順", type: "notation", max: 1000, required: true, moves: true },
      { key: "layering", label: "重ね方", type: "select", options: { "": "未設定", ...LAYERINGS }, half: true },
      { key: "aim", label: "狙い", type: "radio", options: AIMS },
      { key: "backRollOk", label: "後ろ受け身されても成立", type: "select", options: CHECKED, showIf: (values) => values.recovery === "back_roll" },
      { key: "outcomes", label: "相手の行動ごとの結果", type: "outcomes", hint: "押すたびに ○（こちらが勝つ）→ ×（負ける）→ –（未確認）" },
      { key: "followComboId", label: "重ねがヒットしたら", type: "combo" },
      { key: "mastery", label: "習得度", type: "select", options: MASTERY_OPTIONS, numeric: true },
      { key: "memo", label: "メモ", type: "textarea", max: 2000, rows: 2, placeholder: "タイミングの目安など" },
      { key: "archived", label: "アーカイブ（一覧から隠す）", type: "checkbox", editOnly: true },
    ],
    defaults: () => ({
      character: stored("sf6-character", ""), title: "", comboIds: [], startAdvantage: null, position: "anywhere", recovery: "back_roll",
      notation: "", layering: null, aim: "strike", backRollOk: "unknown", outcomes: {}, followComboId: null, mastery: 0, memo: null, archived: false,
    }),
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
      { key: "detail", label: "やり方・目標", type: "textarea", max: 2000, rows: 2, placeholder: "例：ランダムガードで10回連続" },
      { key: "target", label: "練習する対象", type: "target" },
      { key: "guardSetting", label: "ガード", type: "select", options: { "": "指定なし", ...GUARD_SETTINGS }, half: true },
      { key: "counterSetting", label: "カウンター", type: "select", options: { "": "指定なし", ...COUNTER_SETTINGS }, half: true },
      { key: "recoverySetting", label: "受け身", type: "select", options: { "": "指定なし", ...RECOVERY_SETTINGS }, half: true },
      { key: "reversalRecorded", label: "無敵技を録画して再生する", type: "checkbox" },
      { key: "status", label: "状態", type: "select", options: { active: "練習中", done: "完了" }, editOnly: true },
    ],
    defaults: () => ({
      title: "", detail: null, comboId: null, setplayId: null, status: "active",
      guardSetting: null, counterSetting: null, recoverySetting: null, reversalRecorded: false,
    }),
  },
  logs: {
    title: "練習記録",
    fields: [
      { key: "drillId", type: "hidden", numeric: true },
      { key: "practicedOn", label: "日付", type: "date", required: true },
      { key: "attempts", label: "回数", type: "number", min: 1, max: 10000, nullable: true, half: true },
      { key: "successes", label: "成功", type: "number", min: 0, max: 10000, nullable: true, half: true },
      { key: "bestStreak", label: "最高の連続成功", type: "number", min: 0, max: 10000, nullable: true, half: true, hint: `${STREAK_GOAL}回連続で習得度を上げる目安` },
      { key: "note", label: "メモ", type: "textarea", max: 2000, rows: 2, placeholder: "気づいたこと" },
    ],
    defaults: () => ({ drillId: null, practicedOn: state.data.today, attempts: null, successes: null, bestStreak: null, note: null }),
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

function situationsHtml(selected) {
  const list = [...new Set([...situationOptions(state.data.combos), ...selected])];
  return list.map((situation) => {
    const on = selected.includes(situation);
    return `<button type="button" class="toggle-chip" data-situation="${escapeHtml(situation)}" aria-pressed="${on}">${escapeHtml(situation)}</button>`;
  }).join("");
}

function comboIdsHtml(selected, character) {
  const combos = state.data.combos.filter((combo) => (!combo.archived || selected.includes(combo.id))
    && (!character || combo.character === character));
  if (!combos.length) return '<p class="field-hint">このキャラのコンボがまだありません</p>';
  return combos.map((combo) => `<label class="check-row"><input type="checkbox" data-combo-id="${combo.id}"${selected.includes(combo.id) ? " checked" : ""} />
    <span>${escapeHtml(combo.title)}<small>${escapeHtml([frames(combo.endAdvantage), combo.recovery ? RECOVERIES[combo.recovery] : ""].filter(Boolean).join(" · "))}</small></span></label>`).join("");
}

function fieldHtml(field, value, isEdit) {
  if (field.editOnly && !isEdit) return "";
  const id = `field-${field.key}`;
  const label = `<span>${escapeHtml(field.label)}${field.required ? " <b>必須</b>" : ""}</span>`;
  const hint = field.hint ? `<small class="field-hint">${escapeHtml(field.hint)}</small>` : "";
  const text = value === null || value === undefined ? "" : String(value);
  const half = field.half ? " half" : "";
  switch (field.type) {
    case "hidden":
      return `<input type="hidden" id="${id}" value="${escapeHtml(text)}" />`;
    case "checkbox":
      return `<label class="check-field" data-field="${field.key}"><input type="checkbox" id="${id}"${value ? " checked" : ""} /><span>${escapeHtml(field.label)}</span></label>`;
    case "notation":
      return `<div class="notation-field" data-field="${field.key}">
        <span class="field-label">${escapeHtml(field.label)} <b>必須</b></span>
        <div class="notation-preview" id="notationPreview" aria-live="polite"></div>
        <div class="fragments" id="notationFragments" hidden></div>
        ${paletteHtml(field.moves)}
        <details class="notation-raw"><summary>文字で直接編集</summary>
          <textarea id="${id}" rows="2" maxlength="${field.max}" placeholder="例：2中K > DR 5中P > 2強P xx 236強P">${escapeHtml(text)}</textarea>
        </details>
      </div>`;
    case "situations":
      return `<div class="chip-field" data-field="${field.key}">
        <span class="field-label">${escapeHtml(field.label)} <b>必須</b></span>
        <div class="toggle-chips" id="situationChips">${situationsHtml(value || [])}</div>
        <div class="add-situation"><input id="newSituation" maxlength="60" placeholder="自分の状況を追加（例：昇龍ガード後）" /><button type="button" class="secondary-button small" data-add-situation>追加</button></div>
      </div>`;
    case "comboIds":
      return `<div class="chip-field" data-field="${field.key}">
        <span class="field-label">${escapeHtml(field.label)}</span>${hint}
        <div class="check-list" id="comboIdList">${comboIdsHtml(value || [], state.editing?.values.character || "")}</div>
      </div>`;
    case "outcomes":
      return `<div class="chip-field" data-field="${field.key}">
        <span class="field-label">${escapeHtml(field.label)}</span>${hint}
        <div class="outcome-buttons">${Object.entries(OPPONENT_OPTIONS).map(([key, name]) => {
          const current = (value || {})[key] || "unknown";
          return `<button type="button" class="outcome ${current}" data-outcome="${key}" data-value="${current}"><b>${OUTCOME_MARKS[current]}</b>${escapeHtml(name)}</button>`;
        }).join("")}</div>
      </div>`;
    case "target": {
      const { comboId, setplayId } = state.editing.values;
      const selected = comboId ? `c:${comboId}` : setplayId ? `s:${setplayId}` : "";
      const option = (value, name) => `<option value="${value}"${value === selected ? " selected" : ""}>${escapeHtml(name)}</option>`;
      const combos = state.data.combos.filter((combo) => !combo.archived || combo.id === comboId);
      const setplays = state.data.setplays.filter((setplay) => !setplay.archived || setplay.id === setplayId);
      return `<label data-field="${field.key}">${label}<select id="${id}"><option value="">なし</option>
        ${combos.length ? `<optgroup label="コンボ">${combos.map((combo) => option(`c:${combo.id}`, `${combo.character}：${combo.title}`)).join("")}</optgroup>` : ""}
        ${setplays.length ? `<optgroup label="起き攻め">${setplays.map((setplay) => option(`s:${setplay.id}`, `${setplay.character}：${setplay.title}`)).join("")}</optgroup>` : ""}
      </select></label>`;
    }
    case "textarea":
      return `<label data-field="${field.key}">${label}<textarea id="${id}" rows="${field.rows || 3}" maxlength="${field.max}" placeholder="${escapeHtml(field.placeholder || "")}">${escapeHtml(text)}</textarea></label>`;
    case "select":
      return `<label class="${half}" data-field="${field.key}">${label}<select id="${id}">${options(field.options, text)}</select>${hint}</label>`;
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
      return `<label class="${half}" data-field="${field.key}">${label}<input id="${id}" type="number" inputmode="numeric" min="${field.min}" max="${field.max}" step="1" value="${escapeHtml(text)}" placeholder="${escapeHtml(field.placeholder || "")}" />${hint}</label>`;
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
    if (field.type === "situations") {
      values.situations = [...els.formFields.querySelectorAll("[data-situation][aria-pressed=true]")].map((chip) => chip.dataset.situation);
      continue;
    }
    if (field.type === "comboIds") {
      values.comboIds = [...els.formFields.querySelectorAll("[data-combo-id]:checked")].map((input) => Number(input.dataset.comboId));
      continue;
    }
    if (field.type === "outcomes") {
      values.outcomes = Object.fromEntries([...els.formFields.querySelectorAll("[data-outcome]")]
        .filter((button) => button.dataset.value !== "unknown")
        .map((button) => [button.dataset.outcome, button.dataset.value]));
      continue;
    }
    const input = document.getElementById(`field-${field.key}`);
    if (!input) continue;
    if (field.type === "target") {
      const [kind, id] = input.value.split(":");
      values.comboId = kind === "c" ? Number(id) : null;
      values.setplayId = kind === "s" ? Number(id) : null;
    } else if (field.type === "checkbox") values[field.key] = input.checked;
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
  refreshNotationAssist();
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
    if (wrapper?.hidden || (field.editOnly && !state.editing.item)) continue;
    const value = values[field.key];
    if (field.required && (value === null || value === "" || (Array.isArray(value) && value.length === 0))) {
      return field.type === "situations" ? "使える状況を1つ以上選んでください。" : `「${field.label}」を入力してください。`;
    }
    if (field.type === "number" && value !== null && (!Number.isInteger(value) || value < field.min || value > field.max)) {
      return `「${field.label}」は${field.min}〜${field.max}の整数で入力してください。`;
    }
  }
  if (resource === "notes" && values.category === "matchup" && !values.opponent) return "相手キャラを入力してください。";
  if (resource === "logs" && (values.attempts === null) !== (values.successes === null)) return "回数と成功は両方入力するか、両方空欄にしてください。";
  if (resource === "logs" && values.attempts !== null && values.successes > values.attempts) return "成功は回数以下にしてください。";
  if (resource === "logs" && values.bestStreak !== null && (values.successes === null || values.bestStreak > values.successes)) {
    return "連続成功は成功以下にしてください（回数・成功も入力してください）。";
  }
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
    if (resource === "logs") {
      state.data.logs.unshift(saved);
      state.data.logs.sort((a, b) => b.practicedOn.localeCompare(a.practicedOn) || b.id - a.id);
    } else replaceItem(resource, saved);
    if ((resource === "combos" || resource === "setplays") && fields.character) store("sf6-character", fields.character);
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

/** 起点のコンボを選んだら、その締めの有利F・位置・ダウンを入れる（空欄のときだけ上書きしないよう、最初の1件で埋める）。 */
function fillStartFromCombo(comboId) {
  const combo = state.data.combos.find((entry) => entry.id === comboId);
  if (!combo) return;
  const advantage = document.getElementById("field-startAdvantage");
  if (combo.endAdvantage !== null && advantage.value === "") advantage.value = String(combo.endAdvantage);
  if (combo.position !== "anywhere") document.getElementById("field-position").value = combo.position;
  if (combo.recovery) document.getElementById("field-recovery").value = combo.recovery;
  syncConditional("setplays");
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
els.comboSituation.addEventListener("change", () => {
  state.conditions.situation = els.comboSituation.value;
  renderCombos();
});
els.comboConditions.addEventListener("change", () => {
  state.conditions.drive = els.conditionDrive.value === "" ? null : Number(els.conditionDrive.value);
  state.conditions.sa = els.conditionSa.value === "" ? null : Number(els.conditionSa.value);
  state.conditions.ca = els.conditionCa.checked;
  state.conditions.burnout = els.conditionBurnout.checked;
  renderCombos();
});
els.setplayCharacter.addEventListener("change", () => {
  state.setplayCharacter = els.setplayCharacter.value;
  renderSetplays();
});
els.noteOpponent.addEventListener("change", () => {
  state.noteOpponent = els.noteOpponent.value;
  renderNotes();
});

function drillPresetFromCombo(combo) {
  const confirm = combo.situations.includes("ヒット確認");
  return {
    title: `${combo.title}（${combo.character}）`,
    comboId: combo.id,
    guardSetting: "random",
    counterSetting: combo.situations.includes("パニッシュカウンター") ? "punish_counter" : combo.situations.includes("カウンター") ? "counter" : null,
    detail: confirm ? "ランダムガードでヒット確認して10回連続" : "ランダムガードで10回連続",
  };
}

function drillPresetFromSetplay(setplay) {
  return {
    title: `${setplay.title}（${setplay.character}）`,
    setplayId: setplay.id,
    recoverySetting: setplay.recovery === "back_roll" ? "random" : null,
    reversalRecorded: true,
    detail: "無敵技を録画再生してガードが間に合うか、重ねが成立するかを確認",
  };
}

document.querySelector("main").addEventListener("click", async (event) => {
  const target = event.target.closest("button");
  if (!target || !state.data) return;
  const { dataset } = target;
  if (dataset.edit) openModal(dataset.edit, find(dataset.edit, dataset.id));
  else if (dataset.mastery !== undefined) {
    const resource = dataset.resource || "combos";
    const item = find(resource, dataset.id);
    const level = Number(dataset.mastery);
    // 今の段階をもう一度押すと1段下げる
    const next = level === item.mastery ? Math.max(0, level - 1) : level;
    if (next !== item.mastery) await patch(resource, item, { mastery: next }, `習得度：${MASTERY[next]}`);
  } else if (dataset.drillFromCombo) {
    openModal("drills", null, drillPresetFromCombo(find("combos", dataset.drillFromCombo)));
  } else if (dataset.drillFromSetplay) {
    openModal("drills", null, drillPresetFromSetplay(find("setplays", dataset.drillFromSetplay)));
  } else if (dataset.setplayFromCombo) {
    const combo = find("combos", dataset.setplayFromCombo);
    openModal("setplays", null, {
      character: combo.character, comboIds: [combo.id], startAdvantage: combo.endAdvantage,
      position: combo.position, recovery: combo.recovery || "back_roll",
    });
  } else if (dataset.gotoSetplay) {
    selectTab("setplays");
    state.setplayCharacter = "";
    renderSetplays();
    const card = document.getElementById(`setplay-${dataset.gotoSetplay}`);
    card?.scrollIntoView({ block: "center" });
    card?.classList.add("flash");
    setTimeout(() => card?.classList.remove("flash"), 1200);
  } else if (dataset.raise) {
    const drill = find("drills", dataset.raise);
    const goal = drillTarget(drill);
    if (goal) await patch(goal.resource, goal.item, { mastery: 2 }, `習得度：${MASTERY[2]}`);
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
  if (state.tab === "combos") {
    openModal("combos", null, {
      ...(state.comboCharacter ? { character: state.comboCharacter } : {}),
      ...(state.conditions.situation ? { situations: [state.conditions.situation] } : {}),
    });
  } else if (state.tab === "setplays") openModal("setplays", null, state.setplayCharacter ? { character: state.setplayCharacter } : {});
  else openModal(state.tab);
});
els.formFields.addEventListener("change", (event) => {
  if (!state.editing) return;
  if (event.target.dataset.comboId && event.target.checked) fillStartFromCombo(Number(event.target.dataset.comboId));
  if (event.target.id === "field-character" && document.getElementById("comboIdList")) {
    const values = readForm(state.editing.resource, state.editing.values);
    document.getElementById("comboIdList").innerHTML = comboIdsHtml(values.comboIds, values.character || "");
  }
  syncConditional(state.editing.resource);
  refreshNotationAssist();
});
els.formFields.addEventListener("input", (event) => {
  if (event.target.id === "field-notation") refreshNotationAssist();
});
els.formFields.addEventListener("keydown", (event) => {
  if (event.target.id === "newSituation" && event.key === "Enter") {
    event.preventDefault();
    els.formFields.querySelector("[data-add-situation]").click();
  }
});
els.formFields.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.token) editNotation((text) => appendToken(text, button.dataset.token));
  else if (button.dataset.fragment) editNotation((text) => appendFragment(text, button.dataset.fragment));
  else if (button.dataset.palette === "backspace") editNotation(removeLastToken);
  else if (button.dataset.palette === "clear") editNotation(() => "");
  else if (button.dataset.situation) button.setAttribute("aria-pressed", String(button.getAttribute("aria-pressed") !== "true"));
  else if (button.dataset.addSituation !== undefined) {
    const input = document.getElementById("newSituation");
    const name = input.value.trim().slice(0, 60);
    if (!name) return;
    const selected = [...new Set([...readForm("combos", state.editing.values).situations, name])];
    document.getElementById("situationChips").innerHTML = situationsHtml(selected);
    input.value = "";
  } else if (button.dataset.outcome) {
    const order = ["unknown", "win", "lose"];
    const next = order[(order.indexOf(button.dataset.value) + 1) % order.length];
    button.dataset.value = next;
    button.className = `outcome ${next}`;
    button.firstElementChild.textContent = OUTCOME_MARKS[next];
  }
});
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

els.conditionDrive.innerHTML = `<option value="">指定なし</option>${options(DRIVE_STEPS, "")}`;
els.conditionSa.innerHTML = `<option value="">指定なし</option>${options({ 0: "0本", 1: "1本", 2: "2本", 3: "3本" }, "")}`;
const requestedTab = new URL(window.location.href).searchParams.get("tab");
state.tab = TABS.includes(requestedTab) ? requestedTab : TABS.includes(stored("sf6-tab", "")) ? stored("sf6-tab", "") : "combos";
state.comboCharacter = stored("sf6-combo-character", "");
renderTabs();
load();
