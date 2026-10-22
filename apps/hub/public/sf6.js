import { readApiJson } from "./api-client.js";
import { formatAdvantage, counterText, punishCounterText, punishLevel, punishWindowForMove, searchMoves, starterMove, defaultStateName } from "./sf6-frames.js";
import { ARROWS, appendFragment, appendToken, frequentFragments, parseNotation, removeLastToken } from "./sf6-notation.js";
import { createNotationKeyboard } from "./sf6-keyboard.js";
import { buildFlow, exitsOf } from "./sf6-graph.js";
import {
  bestStreakOf, defaultTitle, drillPreset, findState, leadsInto, MASTERY, OPPONENT_OPTIONS, PRESET, raiseTargets, resultOf,
  routeBack, routeDrillPreset, sequencesFrom, setplaysAfter, situationUsage, sortSequences, startSituationGroups, stateFit, stateLabel, STREAK_GOAL, usableNow,
} from "./sf6-plan.js";

// SF6ページ。コンボ・起き攻め・フレーム・練習メニュー・対戦振り返りの5タブ。
// コンボと起き攻めは同じ「手順」（sequences）で、始動の状況と結果（→次の状況）を持つ。状況（situations）は
// きっかけと局面の2種類。ルートと状況の管理は、1つのシート（#sheet）を使い回して開く。
// 編集は1つのモーダルを使い回し、FORMS の定義から入力欄を組み立てる。

const CHARACTERS = [
  "リュウ", "ルーク", "ジェイミー", "春麗", "ガイル", "キンバリー", "ジュリ", "ケン", "ブランカ", "ダルシム",
  "エドモンド本田", "ディージェイ", "マノン", "マリーザ", "JP", "ザンギエフ", "リリー", "キャミィ",
  "ラシード", "A.K.I.", "エド", "豪鬼", "ベガ", "テリー", "舞", "エレナ", "サガット", "C.ヴァイパー", "アレックス", "イングリッド",
];
const POSITIONS = { anywhere: "どこでも", midscreen: "画面中央", corner: "画面端" };
const RESULTS = { win: "勝ち", lose: "負け", draw: "引き分け" };
const MODES = { ranked: "ランクマ", casual: "カジュアル", battle_hub: "バトルハブ", tournament: "大会", other: "その他" };
const SA_LEVELS = { 0: "なし", 1: "SA1", 2: "SA2", 3: "SA3", 4: "CA" };
// 0, 0.5, 1, … 6 の順に並べるため配列で持つ（オブジェクトだと整数のキーが先に並ぶ）
const DRIVE_STEPS = Array.from({ length: 13 }, (_, index) => [String(index / 2), String(index / 2)]);
const RECOVERIES = { back_roll: "後ろ受け身 可", no_back_roll: "後ろ受け身 不可", none: "ダウンなし" };
const END_PURPOSES = { damage: "ダメージ重視", oki: "起き攻め重視", carry: "運び重視" };
const LAYERINGS = { meaty: "持続重ね", safe_jump: "安全飛び", other: "その他" };
const AIMS = { strike: "打撃", throw: "投げ", shimmy: "シミー" };
const OPPONENT_LABELS = {
  reversal: "無敵技", backdash: "バクステ", jump: "ジャンプ", tech: "グラップ",
  delay_tech: "遅らせグラップ", parry: "パリィ", drive_reversal: "ドライブリバーサル", back_roll: "後ろ受け身",
};
const RESULT_LABELS = { hit: "ヒット", guard: "ガード" };
const OUTCOME_MARKS = { win: "○", lose: "×", unknown: "–" };
const GUARD_SETTINGS = { none: "ガードしない", all: "全部ガード", random: "ランダムガード" };
const COUNTER_SETTINGS = { normal: "通常", counter: "カウンター", punish_counter: "パニッシュカウンター", random: "ランダム" };
const RECOVERY_SETTINGS = { neutral: "その場起き", back: "後ろ受け身", random: "受け身ランダム" };
const SITUATION_KINDS = { trigger: "きっかけ", state: "局面" };
const TABS = ["sequences", "situations", "frames", "drills", "matches"];
const ADD_LABELS = { sequences: "手順を追加", situations: "状況を追加", frames: "", drills: "練習を追加", matches: "振り返りを追加" };
const KIND_ADD_LABELS = { combo: "コンボを追加", setplay: "起き攻めを追加" };
const SEQUENCE_KINDS = { combo: "コンボ", setplay: "起き攻め" };
/** 以前の「コンボ」「起き攻め」タブの保存値・URLを、手順タブ（＋種類の絞り込み）に読み替える。 */
const LEGACY_TABS = { combos: "combo", setplays: "setplay" };

const state = {
  data: null,
  tab: "sequences",
  sequenceCharacter: "",
  /** 手順の種類の絞り込み。"" はすべて、"combo" / "setplay"。 */
  sequenceKind: "",
  sequencePosition: "",
  /** 状況タブのキャラと位置の絞り込み。 */
  situationCharacter: "",
  situationPosition: "",
  situationNear: true,
  /** 「状況から引く」の条件。situationId は状況の id（"none" は状況なし）、drive・sa・punishWindow は null なら指定なし。 */
  conditions: { situationId: null, drive: null, sa: null, ca: false, burnout: false, punishWindow: null },
  frames: { character: "", query: "", category: "", sort: "official", punishableOnly: false, heavyPunishableOnly: false, cancelableOnly: false, open: null },
  opponent: { character: "", moveId: null, loading: false, error: "" },
  /** キャラ名 → GET /api/sf6/moves の応答。タブやモーダルで初めて要るときに1回だけ読む。 */
  moves: new Map(),
  /** シート：{ type: "route", path, character } / { type: "routeStart", character } / { type: "situations", character }
   *  / { type: "flow", character, startSituationId, selected, picking } */
  sheet: null,
  /** モーダルで編集中の記録。{ resource, item(null=追加), values, startRefs, openNext } */
  editing: null,
  saving: false,
};

const ids = [
  "sourceBadge", "refreshButton", "addButton", "addLabel", "loadingState", "errorState", "errorMessage", "retryButton",
  "countSequences", "countSituations", "countDrills", "countMatches",
  "situationCharacter", "situationPosition", "situationNear", "situationList", "situationArchiveFold", "situationArchiveCount", "situationArchive",
  "sequenceCharacter", "sequenceKind", "sequencePosition", "sequenceSituation", "sequenceConditions", "conditionDrive", "conditionSa", "conditionCa", "conditionBurnout",
  "conditionPunish", "opponentCharacter", "opponentMove", "opponentMoveStatus", "opponentMoveRetry", "conditionSummary", "sequenceList", "sequenceArchiveFold", "sequenceArchiveCount", "sequenceArchive",
  "frameCharacter", "frameQuery", "frameCategory", "frameSort", "framePunishable", "frameHeavyPunishable", "frameCancelable", "frameVersion", "frameTable",
  "drillList", "logList", "drillDoneFold", "drillDoneCount", "drillDone",
  "matchStats", "matchList",
  "editModal", "modalTitle", "modalClose", "editForm", "formFields", "formError", "deleteConfirm", "deleteButton", "cancelButton", "saveButton",
  "sheet", "sheetTitle", "sheetClose", "sheetBody",
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

/** map は { 値: ラベル } か、並び順を決めたいときの [[値, ラベル], …]。 */
function options(map, selected) {
  return (Array.isArray(map) ? map : Object.entries(map)).map(([value, label]) =>
    `<option value="${escapeHtml(value)}"${value === selected ? " selected" : ""}>${escapeHtml(label)}</option>`).join("");
}

function chips(list) {
  return list.length ? `<div class="tags">${list.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>` : "";
}

/** レシピを矢印と色付きのボタンで表示する。読めない語は文字のまま出す。inline はフレーム表のコマンド用。 */
function notationHtml(text, inline = false) {
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
  return inline
    ? `<span class="notation inline" aria-label="${escapeHtml(text)}">${parts.join("")}</span>`
    : `<div class="notation" aria-label="${escapeHtml(text)}">${parts.join("")}</div>`;
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
      <button type="button" class="pal-key edit" data-palette="keyboard">⌨ キーボード入力</button>
      <button type="button" class="pal-key edit" data-palette="backspace">⌫ 1つ戻す</button>
      <button type="button" class="pal-key edit" data-palette="clear">クリア</button>
    </div>
  </div>`;
}

// ---------- データの引き方 ----------

function situationsById() {
  return new Map(state.data.situations.map((situation) => [situation.id, situation]));
}

function sequencesById() {
  return new Map(state.data.sequences.map((sequence) => [sequence.id, sequence]));
}

function findSituation(id) {
  return state.data.situations.find((situation) => situation.id === id) || null;
}

function findSequence(id) {
  return state.data.sequences.find((sequence) => sequence.id === id) || null;
}

/** 状況の表示名。局面は数値も添える（名前が数値そのものなら重ねない）。 */
function situationText(situation) {
  if (!situation) return "";
  const label = stateLabel(situation);
  return label && label !== situation.name ? `${situation.name} ${label}` : situation.name;
}

function resultLabel(result) {
  return result.kind === "opponent" ? OPPONENT_LABELS[result.opponentAction] || "" : RESULT_LABELS[result.kind];
}

function sequencesOf(kind) {
  return state.data.sequences.filter((sequence) => sequence.kind === kind);
}

function activeDrillFor(sequenceId) {
  return state.data.drills.find((drill) => drill.status === "active" && drill.sequenceIds.includes(sequenceId)) || null;
}

/** 状況の一覧を出すときのキャラ。タブの絞り込み → 最後に使ったキャラの順。 */
function currentCharacter() {
  return state.sequenceCharacter || stored("sf6-character", "");
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
    if (state.tab === "frames") loadFrames();
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

/** 1キャラの技データを読む（キャラごとに1回）。登録のないキャラは null。 */
async function ensureMoves(character) {
  if (!character || !state.data?.moveSets.some((set) => set.character === character)) return null;
  if (state.moves.has(character)) return state.moves.get(character);
  const response = await fetch(`/api/sf6/moves?character=${encodeURIComponent(character)}`, { headers: { Accept: "application/json" }, cache: "no-store" });
  const payload = await readApiJson(response);
  if (!response.ok) throw new Error(errorMessage(payload, "技データを読み込めませんでした。"));
  state.moves.set(character, payload);
  return payload;
}

function movesOf(character) {
  return state.moves.get(character)?.moves || [];
}

/** 返ってきた行で手元のデータを差し替える（再読み込みしない）。手順は { item, situations } で返る。 */
function applySaved(resource, saved) {
  if (resource === "sequences") {
    state.data.situations = saved.situations;
    replaceItem("sequences", saved.item);
    return;
  }
  replaceItem(resource, saved);
}

function replaceItem(resource, item) {
  const list = state.data[resource];
  const index = list.findIndex((entry) => entry.id === item.id);
  if (index >= 0) list[index] = item;
  else list.push(item);
}

/** DB側の「削除時に外す・nullにする」を手元にも反映する。 */
function removeItem(resource, id) {
  state.data[resource] = state.data[resource].filter((entry) => entry.id !== id);
  if (resource === "drills") state.data.logs = state.data.logs.filter((log) => log.drillId !== id);
  if (resource === "situations") {
    state.data.sequences.forEach((sequence) => {
      sequence.starts = sequence.starts.filter((start) => start !== id);
      sequence.results.forEach((result) => { if (result.nextSituationId === id) result.nextSituationId = null; });
    });
    if (state.conditions.situationId === id) state.conditions.situationId = null;
  }
}

/**
 * 一部の項目だけ変える（習得度など）。サーバーへは全項目を送る。手順の始動・結果は送らない（子表を変えない）。
 * 始動の状況がなくなった手順でも、習得度は変えられる。
 */
async function patch(resource, item, changes, message) {
  const { id, createdAt, updatedAt, presetKey, ...fields } = item;
  if (resource === "sequences") {
    delete fields.starts;
    delete fields.results;
  }
  try {
    const saved = await send("PATCH", resource, { id, updatedAt, ...fields, ...changes });
    applySaved(resource, saved);
    render();
    if (message) showToast(message);
    return true;
  } catch (error) {
    showToast(error instanceof Error ? error.message : "保存できませんでした。");
    return false;
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
  return values.includes(selected) ? selected : "";
}

function render() {
  const { sequences, drills, matches } = state.data;
  els.countSequences.textContent = sequences.filter((entry) => !entry.archived).length || "";
  els.countSituations.textContent = state.data.situations.filter((entry) => entry.kind === "state" && !entry.archived).length || "";
  els.countDrills.textContent = drills.filter((drill) => drill.status === "active").length || "";
  els.countMatches.textContent = matches.length || "";
  const known = new Set([...CHARACTERS, ...charactersIn(sequences, "character"), ...charactersIn(matches, "opponent")]);
  els.characterOptions.innerHTML = [...known].map((name) => `<option value="${escapeHtml(name)}"></option>`).join("");
  renderTabs();
  renderSequences();
  renderSituations();
  renderFrames();
  renderDrills();
  renderMatches();
  if (state.sheet) renderSheet();
}

function renderTabs() {
  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.setAttribute("aria-selected", String(button.dataset.tab === state.tab));
  });
  TABS.forEach((tab) => { document.getElementById(`panel-${tab}`).hidden = !state.data || tab !== state.tab; });
  els.addLabel.textContent = state.tab === "sequences" && state.sequenceKind ? KIND_ADD_LABELS[state.sequenceKind] : ADD_LABELS[state.tab];
  els.addButton.hidden = !ADD_LABELS[state.tab];
}

function masteryHtml(item) {
  const steps = MASTERY.map((label, level) =>
    `<button type="button" class="mastery-step${level <= item.mastery && item.mastery > 0 ? " on" : ""}" data-mastery="${level}" data-id="${item.id}" aria-label="${label}" title="${label}"${level === item.mastery ? ' aria-current="true"' : ""}></button>`).join("");
  return `<div class="mastery" role="group" aria-label="習得度">${steps}<small>${MASTERY[item.mastery]}</small></div>`;
}

/** 結果 → 次の状況の行。タップでルートを開く。 */
function resultLinesHtml(sequence, kinds) {
  const byId = situationsById();
  const lines = sequence.results
    .filter((result) => kinds.includes(result.kind) && byId.get(result.nextSituationId))
    .map((result) => `<button type="button" class="result-line" data-route-from-card="${sequence.id}|${result.kind}|${result.opponentAction || ""}">${escapeHtml(resultLabel(result))} → ${escapeHtml(situationText(byId.get(result.nextSituationId)))} ›</button>`);
  return lines.join("");
}

function drillButtonHtml(sequence) {
  if (sequence.archived) return "";
  return activeDrillFor(sequence.id)
    ? '<span class="linked">練習メニューにあり</span>'
    : `<button type="button" class="ghost-button" data-drill-from-sequence="${sequence.id}">練習に追加</button>`;
}

/** 種類を絞り込んでいない一覧でだけ、コンボか起き攻めかの印を出す。 */
function kindBadgeHtml(sequence) {
  return state.sequenceKind === "" ? `<span class="kind-badge">${SEQUENCE_KINDS[sequence.kind]}</span>` : "";
}

function comboCard(combo) {
  const byId = situationsById();
  const starts = combo.starts.map((id) => byId.get(id)).filter(Boolean);
  const conditions = [
    combo.startup !== null ? `発生${combo.startup}F` : "",
    combo.position !== "anywhere" ? POSITIONS[combo.position] : "",
    combo.damage !== null ? `${combo.damage.toLocaleString()}ダメ` : "",
    combo.driveCost ? `Dゲージ${combo.driveCost}` : "",
    combo.saCost ? SA_LEVELS[combo.saCost] : "",
  ].filter(Boolean);
  const hitState = byId.get(resultOf(combo, "hit")?.nextSituationId);
  const results = resultLinesHtml(combo, ["hit", "guard"]);
  const purpose = combo.endPurpose ? `<span class="meta">${escapeHtml(END_PURPOSES[combo.endPurpose])}</span>` : "";
  const next = combo.archived ? [] : setplaysAfter(combo, state.data.sequences, state.data.situations);
  const nextHtml = next.length
    ? `<div class="next-setplays"><span>起き攻め</span>${next.map(({ sequence, fit }) => {
      const start = sequence.starts.map((id) => byId.get(id)).find((entry) => entry && stateFit(hitState, entry));
      return `<button type="button" class="next-chip ${fit}" data-goto-sequence="${sequence.id}" title="${fit === "near" ? "有利Fが1〜2Fずれています。重ねが変わる可能性があります" : ""}">${escapeHtml(sequence.title)}${fit === "near" && start ? ` <small>${escapeHtml(stateLabel(start))} 注意</small>` : ""}</button>`;
    }).join("")}</div>`
    : "";
  return `<article class="card combo-card" id="sequence-${combo.id}">
    <div class="card-head">
      <h3>${kindBadgeHtml(combo)}${escapeHtml(combo.title)}</h3>
      <button type="button" class="ghost-button" data-edit="sequences" data-id="${combo.id}">編集</button>
    </div>
    <div class="situations">${starts.length
      ? starts.map((situation) => `<button type="button" data-route-situation="${situation.id}" data-character="${escapeHtml(combo.character)}">${escapeHtml(situation.name)}</button>`).join("")
      : '<span class="none">状況なし</span>'}</div>
    ${notationHtml(combo.notation)}
    ${chips(conditions)}
    ${results || purpose ? `<div class="result-lines">${results}${purpose}</div>` : ""}
    ${nextHtml}
    ${combo.memo ? `<p class="memo">${escapeHtml(combo.memo)}</p>` : ""}
    <div class="card-foot">
      ${masteryHtml(combo)}
      <span class="foot-actions">
        ${combo.archived || hitState?.kind !== "state" ? "" : `<button type="button" class="ghost-button" data-setplay-from-combo="${combo.id}">起き攻めを追加</button>`}
        ${drillButtonHtml(combo)}
      </span>
    </div>
  </article>`;
}

function conditionsActive() {
  const { situationId, drive, sa, burnout, punishWindow } = state.conditions;
  return situationId !== null || drive !== null || sa !== null || burnout || punishWindow !== null;
}

function conditionSummaryText() {
  const { drive, sa, ca, burnout } = state.conditions;
  return [drive !== null ? `Dゲージ${drive}` : "", sa !== null ? `SA${sa}本` : "", ca ? "CA可" : "", burnout ? "バーンアウト中" : ""].filter(Boolean);
}

function situationOptionsHtml(groups, selected) {
  return groups.filter(([, list]) => list.length).map(([label, list]) => `<optgroup label="${escapeHtml(label)}">${list.map((situation) =>
    `<option value="${situation.id}"${situation.id === selected ? " selected" : ""}>${escapeHtml(situationText(situation))}</option>`).join("")}</optgroup>`).join("");
}

function byAdvantage(a, b) {
  return (b.advantage ?? -Infinity) - (a.advantage ?? -Infinity) || a.id - b.id;
}

function renderSequenceSituations(sequences) {
  const character = state.sequenceCharacter;
  const used = new Set(sequences.flatMap((sequence) => sequence.starts));
  // 選んでいる状況はアーカイブ済みでも残す（「確反コンボを探す」でアーカイブ済みの初期の状況が選ばれるため）
  const triggers = state.data.situations.filter((situation) => situation.kind === "trigger"
    && (!situation.archived || situation.id === state.conditions.situationId)
    && (!character || situation.character === null || situation.character === character));
  const states = state.data.situations.filter((situation) => situation.kind === "state" && used.has(situation.id)
    && (!character || situation.character === character)).sort(byAdvantage);
  const orphaned = sequences.some((sequence) => sequence.starts.length === 0);
  const { situationId } = state.conditions;
  const known = [...triggers, ...states].some((situation) => situation.id === situationId) || (situationId === "none" && orphaned);
  if (!known) state.conditions.situationId = null;
  els.sequenceSituation.innerHTML = `<option value="">状況：すべて</option>${situationOptionsHtml([["きっかけ", triggers], ["局面", states]], state.conditions.situationId)}${orphaned
    ? `<option value="none"${state.conditions.situationId === "none" ? " selected" : ""}>状況なし</option>` : ""}`;
}

function sequenceCard(sequence) {
  return sequence.kind === "setplay" ? setplayCard(sequence) : comboCard(sequence);
}

function emptySequencesText(total, noStartup) {
  if (noStartup) return `発生Fが未入力のコンボは${noStartup}件あります`;
  const label = state.sequenceKind ? SEQUENCE_KINDS[state.sequenceKind] : "手順";
  return total ? `この状況・条件で使える${label}はありません` : `まだ${label}がありません。右上の「＋」から追加できます`;
}

function renderSequences() {
  const all = state.data.sequences;
  const ofKind = all.filter((sequence) => !state.sequenceKind || sequence.kind === state.sequenceKind);
  state.sequenceCharacter = fillSelect(els.sequenceCharacter, charactersIn(all, "character"), state.sequenceCharacter, "全キャラ");
  renderSequenceSituations(ofKind.filter((sequence) => !state.sequenceCharacter || sequence.character === state.sequenceCharacter));
  els.sequenceKind.querySelectorAll("button").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.value === state.sequenceKind));
  });
  els.sequencePosition.querySelectorAll("button").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.value === state.sequencePosition));
  });
  const { drive, sa, ca, burnout, punishWindow } = state.conditions;
  els.conditionDrive.value = drive === null ? "" : String(drive);
  els.conditionSa.value = sa === null ? "" : String(sa);
  els.conditionPunish.value = punishWindow === null ? "" : String(punishWindow);
  els.conditionCa.checked = ca;
  els.conditionBurnout.checked = burnout;
  renderPunishPicker();
  const summary = [...conditionSummaryText(), punishWindow !== null ? `相手の不利F${punishWindow}` : ""].filter(Boolean);
  els.conditionSummary.textContent = summary.length ? summary.join("・") : "指定なし";
  const mine = ofKind.filter((sequence) => !state.sequenceCharacter || sequence.character === state.sequenceCharacter);
  const visible = mine.filter((sequence) => usableNow(sequence, { ...state.conditions, position: state.sequencePosition }));
  const sorted = sortSequences(visible.filter((sequence) => !sequence.archived), state.conditions, situationsById());
  // コンボ → 起き攻めの順。条件で並べていないときの起き攻めは、起点の有利Fが大きい順
  const active = [
    ...sorted.filter((sequence) => sequence.kind === "combo"),
    ...(conditionsActive() ? sorted.filter((sequence) => sequence.kind === "setplay")
      : sorted.filter((sequence) => sequence.kind === "setplay").sort((a, b) => maxAdvantage(b) - maxAdvantage(a))),
  ];
  const archived = visible.filter((sequence) => sequence.archived);
  const groups = new Map();
  active.forEach((sequence) => groups.set(sequence.character, [...(groups.get(sequence.character) || []), sequence]));
  // 不利F以外の状況・条件では使えるのに、発生Fがないので出ていないコンボ
  const noStartup = punishWindow !== null
    ? mine.filter((sequence) => sequence.kind === "combo" && !sequence.archived && sequence.startup === null
      && usableNow(sequence, { ...state.conditions, position: state.sequencePosition, punishWindow: null })).length
    : 0;
  els.sequenceList.innerHTML = active.length
    ? [...groups].map(([character, list]) => `<h2 class="list-title">${escapeHtml(character)}<small>${list.length}</small></h2>${list.map(sequenceCard).join("")}`).join("")
    : empty(emptySequencesText(ofKind.length, noStartup));
  els.sequenceArchiveFold.hidden = archived.length === 0;
  els.sequenceArchiveCount.textContent = archived.length;
  els.sequenceArchive.innerHTML = archived.map(sequenceCard).join("");
  if (conditionsActive() && punishWindow !== null) els.sequenceConditions.open = true;
}

function outcomesHtml(setplay, showBackRoll) {
  const outcomes = Object.fromEntries(setplay.results.filter((result) => result.kind === "opponent").map((result) => [result.opponentAction, result.outcome]));
  if (!Object.values(outcomes).some((value) => value !== "unknown")) return '<p class="meta outcomes-empty">相手の行動ごとの結果：未確認</p>';
  return `<div class="outcomes" aria-label="相手の行動ごとの結果">${OPPONENT_OPTIONS.filter((key) => showBackRoll || key !== "back_roll").map((key) => {
    const value = outcomes[key] || "unknown";
    return `<span class="outcome ${value}" title="${escapeHtml(OPPONENT_LABELS[key])}：${value === "win" ? "こちらが勝つ" : value === "lose" ? "こちらが負ける" : "未確認"}"><b>${OUTCOME_MARKS[value]}</b>${escapeHtml(OPPONENT_LABELS[key])}</span>`;
  }).join("")}</div>`;
}

function startStatesOf(sequence) {
  const byId = situationsById();
  return sequence.starts.map((id) => byId.get(id)).filter(Boolean);
}

function setplayCard(setplay) {
  const starts = startStatesOf(setplay);
  const showBackRoll = starts.some((situation) => situation.recovery === "back_roll");
  const before = [...new Set(starts.filter((situation) => situation.kind === "state")
    .flatMap((situation) => leadsInto(situation, state.data.sequences, state.data.situations)))].slice(0, 2);
  // 起点 強エアニー締め後 +29F · 画面端 · 後ろ受け身 可（名前が数値そのものなら名前は出さない）
  const startText = starts.map((situation) => (situation.kind === "state" ? [
    situation.name === stateLabel(situation) ? "" : situation.name,
    `${situation.advantage > 0 ? "+" : ""}${situation.advantage}F`,
    situation.position !== "anywhere" ? POSITIONS[situation.position] : "",
    situation.recovery ? RECOVERIES[situation.recovery] : "",
  ].filter(Boolean).join(" · ") : situation.name)).join(" ／ ");
  const tags = [AIMS[setplay.aim], setplay.layering ? LAYERINGS[setplay.layering] : ""].filter(Boolean);
  const results = resultLinesHtml(setplay, ["hit", "guard", "opponent"]);
  return `<article class="card setplay-card" id="sequence-${setplay.id}">
    <div class="card-head">
      <h3>${kindBadgeHtml(setplay)}${escapeHtml(setplay.title)}</h3>
      <button type="button" class="ghost-button" data-edit="sequences" data-id="${setplay.id}">編集</button>
    </div>
    <p class="start-line"><b>起点</b>${starts.length ? escapeHtml(startText) : "状況なし"}${before.length ? `<span>${before.map((combo) => escapeHtml(combo.title)).join("、")}の後</span>` : ""}</p>
    ${notationHtml(setplay.notation)}
    ${chips(tags)}
    ${outcomesHtml(setplay, showBackRoll)}
    ${results ? `<div class="result-lines">${results}</div>` : ""}
    ${setplay.memo ? `<p class="memo">${escapeHtml(setplay.memo)}</p>` : ""}
    <div class="card-foot">
      ${masteryHtml(setplay)}
      ${drillButtonHtml(setplay)}
    </div>
  </article>`;
}

function maxAdvantage(sequence) {
  return Math.max(-Infinity, ...startStatesOf(sequence).map((situation) => situation.advantage ?? -Infinity));
}

// ---------- フレーム ----------

/** PC幅ではカウンター・パニカンも列で出す。table-layout: fixed なので、詳細行の colspan は見えている列の数にする。 */
const WIDE_FRAMES = window.matchMedia("(min-width: 681px)");

const FRAME_DETAILS = [
  ["activeText", "持続"], ["recoveryText", "硬直"], ["cancelText", "キャンセル"], ["damageText", "ダメージ"],
  ["scalingText", "補正"], ["attributeText", "属性"], ["driveGainText", "Dゲージ増加"], ["driveLossText", "Dゲージ減少"], ["saGainText", "SAゲージ増加"],
];

function frameCharacters() {
  return state.data.moveSets.map((set) => set.character);
}

function renderPunishPicker() {
  const { character, moveId, loading, error } = state.opponent;
  const characters = frameCharacters();
  els.opponentCharacter.innerHTML = `<option value="">相手キャラを選ぶ</option>${characters.map((name) =>
    `<option value="${escapeHtml(name)}"${name === character ? " selected" : ""}>${escapeHtml(name)}</option>`).join("")}`;
  els.opponentCharacter.disabled = !characters.length;
  const moves = movesOf(character);
  els.opponentMove.innerHTML = `<option value="">${loading ? "読み込み中…" : "相手の技を選ぶ"}</option>${moves.map((move) => {
    const window = punishWindowForMove(move);
    return `<option value="${move.id}"${move.id === moveId ? " selected" : ""}${window === null ? " disabled" : ""}>${escapeHtml(`${move.name} / ${move.command || ""} / ガード ${formatAdvantage(move.blockText) || "不明"}F`)}</option>`;
  }).join("")}`;
  els.opponentMove.disabled = loading || !moves.length;
  const selected = moves.find((move) => move.id === moveId);
  const parsedWindow = punishWindowForMove(selected);
  els.opponentMoveStatus.textContent = error || (!characters.length ? "相手キャラの技データはまだ登録されていません。不利Fを直接入力できます。"
    : character && !loading && !moves.length ? "このキャラの技データはありません。不利Fを直接入力できます。"
    : selected && parsedWindow !== null ? `${character}：${selected.name} · 発生${parsedWindow}F以内のコンボ` : "");
  els.opponentMoveRetry.hidden = !error;
}

async function loadOpponentMoves() {
  const character = state.opponent.character;
  state.opponent.loading = Boolean(character);
  state.opponent.error = "";
  renderPunishPicker();
  try {
    await ensureMoves(character);
  } catch (error) {
    if (state.opponent.character === character) state.opponent.error = error instanceof Error ? error.message : "技データを読み込めませんでした。";
  } finally {
    if (state.opponent.character === character) {
      state.opponent.loading = false;
      renderPunishPicker();
    }
  }
}

function applyOpponentMove(move) {
  const window = punishWindowForMove(move);
  if (window === null) return;
  state.opponent.moveId = move.id;
  state.conditions = { ...state.conditions, situationId: null, punishWindow: window };
  state.sequenceKind = "combo";
  renderTabs();
  renderSequences();
  els.sequenceConditions.open = true;
}

async function loadFrames() {
  const characters = frameCharacters();
  if (!characters.includes(state.frames.character)) {
    const last = stored("sf6-character", "");
    state.frames.character = characters.includes(last) ? last : characters[0] || "";
  }
  renderFrames();
  if (!state.frames.character || state.moves.has(state.frames.character)) return;
  try {
    await ensureMoves(state.frames.character);
    renderFrames();
  } catch (error) {
    els.frameTable.innerHTML = empty(error instanceof Error ? error.message : "技データを読み込めませんでした。");
  }
}

function bonusHtml(result, notes) {
  if (!result.text) return "";
  return result.overridden
    ? `<span class="override" title="${escapeHtml(notes || "備考の性能")}">${escapeHtml(result.text)}※</span>`
    : escapeHtml(result.text);
}

function frameRowHtml(move) {
  const open = state.frames.open === move.id;
  const level = punishLevel(move);
  const counter = counterText(move);
  const punish = punishCounterText(move);
  const overrides = [["カウンター", counter], ["パニカン", punish]]
    .filter(([, result]) => result.overridden)
    .map(([label, result]) => `<div><span>${label}</span> ${bonusHtml(result, move.notes)}</div>`).join("");
  const details = [
    ...FRAME_DETAILS.map(([key, label]) => [label, move[key] ? escapeHtml(move[key]) : ""]),
  ];
  details.splice(2, 0, ["カウンター", bonusHtml(counter, move.notes)], ["パニカン", bonusHtml(punish, move.notes)]);
  const detail = open ? `<tr class="frame-detail"><td colspan="${WIDE_FRAMES.matches ? 6 : 4}">
      <dl>${details.filter(([, value]) => value).map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join("")}</dl>
      ${move.notes ? `<p class="memo">${escapeHtml(move.notes)}</p>` : ""}
      ${level && punishWindowForMove(move) >= 4 ? `<button type="button" class="ghost-button find-punish" data-find-punish="${move.id}">確反コンボを探す</button>` : ""}
    </td></tr>` : "";
  return `<tr class="frame-row${open ? " open" : ""}">
    <td><button type="button" class="frame-name" data-frame-row="${move.id}" aria-expanded="${open}"><span>${escapeHtml(move.name)}</span>${move.command ? notationHtml(move.command, true) : ""}</button>${overrides ? `<div class="frame-overrides">${overrides}</div>` : ""}</td>
    <td class="num">${escapeHtml(move.startupText || "")}</td>
    <td class="num${level ? ` punish ${level}` : ""}">${escapeHtml(formatAdvantage(move.blockText))}</td>
    <td class="num">${escapeHtml(formatAdvantage(move.hitText))}</td>
    <td class="num wide">${bonusHtml(counter, move.notes)}</td>
    <td class="num wide">${bonusHtml(punish, move.notes)}</td>
  </tr>${detail}`;
}

function renderFrames() {
  const characters = frameCharacters();
  els.frameCharacter.innerHTML = characters.map((character) =>
    `<option value="${escapeHtml(character)}"${character === state.frames.character ? " selected" : ""}>${escapeHtml(character)}</option>`).join("");
  els.frameCategory.querySelectorAll("[data-category]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.category === state.frames.category));
  });
  els.frameSort.value = state.frames.sort;
  els.framePunishable.setAttribute("aria-pressed", String(state.frames.punishableOnly));
  els.frameHeavyPunishable.setAttribute("aria-pressed", String(state.frames.heavyPunishableOnly));
  els.frameCancelable.setAttribute("aria-pressed", String(state.frames.cancelableOnly));
  if (!characters.length) {
    els.frameVersion.textContent = "";
    els.frameTable.innerHTML = empty("フレームはまだ登録されていません（登録方法はヘルプ）");
    return;
  }
  const data = state.moves.get(state.frames.character);
  if (!data) {
    els.frameVersion.textContent = "";
    els.frameTable.innerHTML = '<div class="state-card"><span class="spinner"></span></div>';
    return;
  }
  els.frameVersion.innerHTML = data.set
    ? `${escapeHtml(data.set.dataVersion)} · ${escapeHtml(formatDay(data.set.checkedOn))}確認 · <a href="${escapeHtml(data.set.sourceUrl)}" target="_blank" rel="noopener noreferrer">公式</a>`
    : "";
  const list = searchMoves(data.moves, state.frames);
  els.frameTable.innerHTML = list.length
    ? `<table class="frame-table">
        <thead><tr><th>技名 / コマンド</th><th class="num">発生</th><th class="num">ガード</th><th class="num">ヒット</th><th class="num wide">カウンター</th><th class="num wide">パニカン</th></tr></thead>
        <tbody>${list.map(frameRowHtml).join("")}</tbody>
      </table>`
    : empty("条件に合う技はありません");
}

/** ガードした相手の技から、確定反撃のコンボを引く（不利F＝ガード時の不利）。 */
function findPunish(moveId) {
  const move = movesOf(state.frames.character).find((entry) => entry.id === moveId);
  if (punishWindowForMove(move) === null) return;
  state.opponent = { character: state.frames.character, moveId, loading: false, error: "" };
  state.sequenceCharacter = stored("sf6-character", state.sequenceCharacter);
  state.sequencePosition = "";
  selectTab("sequences");
  applyOpponentMove(move);
  window.scrollTo({ top: 0 });
}

// ---------- 練習・振り返り ----------

/** 練習の手順どうしの間に出す結果の種類（前の手順のどの結果が、次の手順の始動につながるか）。 */
function linkLabel(previous, next) {
  const byId = situationsById();
  const result = previous.results.find((entry) => {
    const from = byId.get(entry.nextSituationId);
    return from && next.starts.some((id) => byId.get(id) && stateFit(from, byId.get(id)));
  });
  return result ? resultLabel(result) : "";
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

function drillChainHtml(drill) {
  const sequences = drill.sequenceIds.map(findSequence).filter(Boolean);
  return sequences.map((sequence, index) => {
    const link = index > 0 ? `<p class="chain-link">› ${escapeHtml(linkLabel(sequences[index - 1], sequence))}</p>` : "";
    const label = sequences.length > 1 ? sequence.title : sequence.kind === "setplay" ? "起き攻め" : "";
    return `${link}${label ? `<span class="kind-label">${escapeHtml(label)}</span>` : ""}${notationHtml(sequence.notation)}`;
  }).join("");
}

function drillCard(drill) {
  const stats = drillStats(drill);
  const meta = [
    stats.last ? `最終 ${daysAgo(stats.last)}` : "まだ記録なし",
    stats.sessions ? `${stats.sessions}回練習` : "",
    stats.hasRate ? `直近成功率 ${stats.rate}` : "",
    stats.streak ? `最高${stats.streak}連続` : "",
  ].filter(Boolean);
  const raise = drill.status === "active" && raiseTargets(drill.sequenceIds, state.data.sequences, stats.logs).length
    ? `<button type="button" class="raise-button" data-raise="${drill.id}">${STREAK_GOAL}連続達成 → 習得度を「${MASTERY[2]}」にする</button>`
    : "";
  const settings = trainerChips(drill);
  return `<article class="card drill-card${drill.status === "done" ? " done" : ""}">
    <div class="card-head">
      <h3>${escapeHtml(drill.title)}</h3>
      <button type="button" class="ghost-button" data-edit="drills" data-id="${drill.id}">編集</button>
    </div>
    ${drillChainHtml(drill)}
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
    : empty("練習メニューはありません。コンボや起き攻めの「練習に追加」、ルート、右上の「＋」から作れます");
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

/** 状況タブ：キャラごとの局面（有利F・位置・ダウン）を有利Fの大きい順に並べ、そこから始まる手順を添える。 */
function situationCardHtml(situation) {
  const from = situation.archived ? [] : sequencesFrom(situation, state.data.sequences.filter((entry) => entry.character === situation.character), state.data.situations, { includeNear: state.situationNear });
  const tags = [POSITIONS[situation.position], situation.recovery ? RECOVERIES[situation.recovery] : ""].filter(Boolean);
  const counts = situationUsage(situation.id, state.data.sequences);
  return `<article class="card situation-card">
    <div class="card-head">
      <h3><span class="adv${situation.advantage < 0 ? " minus" : ""}">${situation.advantage > 0 ? "+" : ""}${situation.advantage}F</span> ${escapeHtml(situation.name)}</h3>
      <button type="button" class="ghost-button" data-edit-situation="${situation.id}">編集</button>
    </div>
    ${chips(tags)}
    ${situation.memo ? `<p class="memo">${escapeHtml(situation.memo)}</p>` : ""}
    ${from.length ? `<div class="next-row">${from.map(({ sequence, fit }) =>
      `<button type="button" class="next-chip ${fit === "near" ? "near" : ""}" data-goto-sequence="${sequence.id}">${escapeHtml(sequence.title)}</button>`).join("")}</div>` : ""}
    <div class="card-foot">
      <small class="meta">${counts.starts ? `始動の手順 ${counts.starts}件` : "始動の手順なし"}${counts.results ? ` · ここに至る結果 ${counts.results}件` : ""}</small>
      ${situation.archived ? "" : `<button type="button" class="ghost-button" data-route-situation="${situation.id}" data-character="${escapeHtml(situation.character)}">ルートを見る ›</button>`}
    </div>
  </article>`;
}

function renderSituations() {
  const states = state.data.situations.filter((entry) => entry.kind === "state");
  const characters = charactersIn(states, "character");
  state.situationCharacter = fillSelect(els.situationCharacter, characters, state.situationCharacter, "キャラを選ぶ");
  const mine = state.situationCharacter
    ? states.filter((entry) => entry.character === state.situationCharacter
      && (!state.situationPosition || entry.position === state.situationPosition || entry.position === "anywhere"))
    : [];
  const active = mine.filter((entry) => !entry.archived).sort(byAdvantage);
  const archived = mine.filter((entry) => entry.archived).sort(byAdvantage);
  els.situationPosition.querySelectorAll("button").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.value === state.situationPosition));
  });
  els.situationNear.setAttribute("aria-pressed", String(state.situationNear));
  els.situationList.innerHTML = active.map(situationCardHtml).join("")
    || empty(state.situationCharacter ? "このキャラの状況はまだありません。右上の「＋」で、投げ後・端の締め後などを追加できます" : characters.length ? "キャラを選ぶと状況が出ます" : "状況はまだありません。右上の「＋」で追加できます");
  els.situationArchiveFold.hidden = !archived.length;
  els.situationArchiveCount.textContent = archived.length || "";
  els.situationArchive.innerHTML = archived.map(situationCardHtml).join("");
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
          <button type="button" class="ghost-button" data-drill-from-match="${match.id}">練習にする</button>
        </div>` : ""}
      </article>`).join("")
    : empty("まだ振り返りがありません。試合のあとに良かった点と反省点を残しましょう");
}

// ---------- シート（ルート・状況の管理） ----------

function openSheet(sheet) {
  state.sheet = sheet;
  renderSheet();
  els.sheet.hidden = false;
  document.querySelectorAll("details.menu[open]").forEach((menu) => menu.removeAttribute("open"));
}

// ---------- フローチャート ----------

const FLOW_TITLE_MAX = 11;

function clip(text, max) {
  const chars = [...text];
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : text;
}

/** 矢印・出口に付ける結果の名前（相手の行動なら勝敗の印つき）。 */
function flowLabel(exit) {
  return `${resultLabel(exit)}${exit.outcome && exit.outcome !== "unknown" ? OUTCOME_MARKS[exit.outcome] : ""}`;
}

function openFlow() {
  const characters = charactersIn(state.data.sequences, "character");
  const wanted = state.sequenceCharacter || stored("sf6-character", "");
  const { situationId } = state.conditions;
  openSheet({
    type: "flow",
    character: characters.includes(wanted) ? wanted : characters[0] || "",
    startSituationId: typeof situationId === "number" ? situationId : null,
    selected: null,
    picking: null,
  });
}

function flowEdgePath(edge) {
  const reach = edge.back ? 70 : Math.max(30, (edge.x2 - edge.x1) / 2);
  return `M${edge.x1} ${edge.y1} C${edge.x1 + reach} ${edge.y1} ${edge.x2 - reach} ${edge.y2} ${edge.x2} ${edge.y2}`;
}

function flowSvg(flow, selected) {
  const edges = flow.edges.map((edge) => `<g class="flow-edge${edge.fit === "near" ? " near" : ""}">
      <path d="${flowEdgePath(edge)}" marker-end="url(#flowArrow)" />
      <text x="${(edge.x1 + edge.x2) / 2}" y="${(edge.y1 + edge.y2) / 2 - 4}" text-anchor="middle">${escapeHtml(edge.label)}</text>
    </g>`).join("");
  const stubs = flow.stubs.map((stub) => {
    const next = stub.type === "dead" ? situationText(situationsById().get(stub.situationId)) : "";
    const text = stub.type === "unset" ? `${stub.label}：未設定` : `${stub.label} → ${next}`;
    return `<g class="flow-stub ${stub.type}" data-flow-stub="${stub.sequenceId}|${stub.resultKind}|${stub.opponentAction || ""}" tabindex="0" role="button" aria-label="${escapeHtml(`${text}。次の状況を選ぶ`)}">
      <path class="flow-link" d="M${stub.x1} ${stub.y1} L${stub.x2} ${stub.y2}" />
      <rect x="${stub.x}" y="${stub.y}" width="${stub.w}" height="${stub.h}" rx="6" />
      <text x="${stub.x + 8}" y="${stub.y + stub.h / 2 + 4}">${escapeHtml(clip(text, 14))}</text>
      <title>${escapeHtml(text)}</title>
    </g>`;
  }).join("");
  const nodes = flow.nodes.map((node) => `<g class="flow-node ${node.kind}${node.id === selected ? " selected" : ""}" data-flow-node="${node.id}" tabindex="0" role="button">
      <rect x="${node.x}" y="${node.y}" width="${node.w}" height="${node.h}" rx="8" />
      <text class="kind" x="${node.x + 10}" y="${node.y + 18}">${SEQUENCE_KINDS[node.kind]}${node.loop ? " ↻" : ""}</text>
      <text class="title" x="${node.x + 10}" y="${node.y + 38}">${escapeHtml(clip(node.title, FLOW_TITLE_MAX))}</text>
      <title>${escapeHtml(node.title)}</title>
    </g>`).join("");
  return `<div class="flow-scroll"><svg class="flow-svg" width="${flow.width}" height="${flow.height}" viewBox="0 0 ${flow.width} ${flow.height}" role="group" aria-label="手順のフローチャート">
    <defs><marker id="flowArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" /></marker></defs>
    ${edges}${stubs}${nodes}</svg></div>`;
}

function flowDetailHtml(sequence) {
  const byId = situationsById();
  const exits = exitsOf(sequence).map((exit) => {
    const next = byId.get(exit.nextSituationId);
    return `<li><b>${escapeHtml(flowLabel(exit))}</b> → ${next ? escapeHtml(situationText(next)) : '<span class="unset">未設定</span>'}</li>`;
  }).join("");
  return `<article class="card flow-detail">
    <div class="card-head"><h3><span class="kind-badge">${SEQUENCE_KINDS[sequence.kind]}</span>${escapeHtml(sequence.title)}</h3>
      <button type="button" class="ghost-button" data-edit="sequences" data-id="${sequence.id}">編集</button></div>
    ${notationHtml(sequence.notation)}
    <ul class="flow-exits">${exits}</ul>
  </article>`;
}

function renderFlow() {
  const sheet = state.sheet;
  els.sheetTitle.textContent = "フローチャート";
  const characters = charactersIn(state.data.sequences, "character");
  if (!characters.includes(sheet.character)) sheet.character = characters[0] || "";
  if (sheet.picking) {
    renderFlowPicker();
    return;
  }
  const byId = situationsById();
  if (sheet.startSituationId !== null && !byId.has(sheet.startSituationId)) sheet.startSituationId = null;
  const starts = state.data.situations.filter((situation) => !situation.archived
    && (situation.kind === "trigger" ? situation.character === null || situation.character === sheet.character : situation.character === sheet.character));
  const flow = buildFlow({
    sequences: state.data.sequences, situations: state.data.situations, character: sheet.character,
    startSituationId: sheet.startSituationId, resultLabel: flowLabel,
  });
  const selected = findSequence(sheet.selected);
  els.sheetBody.innerHTML = `
    <div class="flow-controls">
      <select data-flow-character aria-label="キャラ">${options(Object.fromEntries(characters.map((name) => [name, name])), sheet.character)}</select>
      <select data-flow-start aria-label="始点の状況"><option value="">始点：すべて</option>${situationOptionsHtml([
        ["きっかけ", starts.filter((situation) => situation.kind === "trigger")],
        ["局面", starts.filter((situation) => situation.kind === "state").sort(byAdvantage)],
      ], sheet.startSituationId)}</select>
    </div>
    ${flow.nodes.length
      ? `<p class="flow-note">${flow.unsetCount ? `次が未設定の出口が${flow.unsetCount}件あります。点線の枠を押すと、次の状況を選べます。` : "未設定の出口はありません。"}</p>${flowSvg(flow, selected?.id)}`
      : empty(sheet.character ? "このキャラ・始点から辿れる手順はありません" : "手順がまだありません")}
    ${selected && flow.nodes.some((node) => node.id === selected.id) ? flowDetailHtml(selected) : ""}`;
}

/** 出口の「次の状況」を選ぶ画面。状況ごとに、そこから始まる手順の数を出す。 */
function renderFlowPicker() {
  const { character, picking } = state.sheet;
  const sequence = findSequence(picking.sequenceId);
  const exit = { kind: picking.resultKind, opponentAction: picking.opponentAction, outcome: null };
  const mine = state.data.sequences.filter((entry) => entry.character === character && !entry.archived);
  const usable = state.data.situations.filter((situation) => !situation.archived
    && (situation.kind === "trigger" ? situation.character === null || situation.character === character : situation.character === character));
  const row = (situation) => {
    const count = sequencesFrom(situation, mine, state.data.situations).filter((entry) => entry.fit !== "near").length;
    return `<button type="button" class="sheet-row" data-flow-pick="${situation.id}"><span>${escapeHtml(situationText(situation))}</span><small>${count ? `${count}手順が始まる` : "続く手順なし"}</small></button>`;
  };
  els.sheetBody.innerHTML = `
    <p class="flow-note"><b>${escapeHtml(sequence?.title || "")}</b> の「${escapeHtml(flowLabel(exit))}」のあと、どの状況になりますか。</p>
    <button type="button" class="ghost-button" data-flow-cancel>← 戻る</button>
    <h3 class="sheet-title">きっかけ</h3>${usable.filter((situation) => situation.kind === "trigger").map(row).join("") || empty("きっかけはありません")}
    <h3 class="sheet-title">局面（${escapeHtml(character)}）</h3>${usable.filter((situation) => situation.kind === "state").sort(byAdvantage).map(row).join("") || empty("局面はまだありません。「⋯」→「状況を管理」で追加できます")}`;
}

/** 結果の次の状況を保存する（結果が無ければ足す）。 */
async function setFlowNext(ref, situationId) {
  const sequence = findSequence(ref.sequenceId);
  if (!sequence) return;
  const same = (result) => result.kind === ref.resultKind && (result.opponentAction || "") === (ref.opponentAction || "");
  const toInput = (result, next) => (result.kind === "opponent"
    ? { kind: "opponent", opponentAction: result.opponentAction, outcome: result.outcome, next }
    : { kind: result.kind, next });
  const results = sequence.results.filter((result) => !same(result)).map((result) => toInput(result, result.nextSituationId));
  const current = sequence.results.find(same) || { kind: ref.resultKind, opponentAction: ref.opponentAction, outcome: null };
  results.push(toInput(current, situationId));
  if (await patch("sequences", sequence, { results }, "次の状況を設定しました") && state.sheet?.type === "flow") {
    state.sheet.picking = null;
    renderSheet();
  }
}

/** 絞り込み中のキャラ・状況を引き継いだ、新しい手順の初期値。起き攻めの起点は局面だけ。 */
function newSequencePreset(kind) {
  const { situationId } = state.conditions;
  const situation = typeof situationId === "number" ? situationsById().get(situationId) : null;
  return {
    kind,
    ...(state.sequenceCharacter ? { character: state.sequenceCharacter } : {}),
    starts: situation && (kind === "combo" || situation.kind === "state") ? [situation.id] : [],
  };
}

/** 種類を絞り込んでいないときの「手順を追加」：コンボか起き攻めかを選ぶ。 */
function renderAddKind() {
  els.sheetTitle.textContent = "手順を追加";
  els.sheetBody.innerHTML = `
    <button type="button" class="sheet-row" data-add-kind="combo"><span>コンボ<small>確定反撃やヒット確認から始める手順</small></span><small>›</small></button>
    <button type="button" class="sheet-row" data-add-kind="setplay"><span>起き攻め<small>ダウンを奪った後や有利フレームで行う手順</small></span><small>›</small></button>`;
}

function closeSheet() {
  els.sheet.hidden = true;
  state.sheet = null;
}

function renderSheet() {
  const { type } = state.sheet;
  if (type === "route") renderRoute();
  else if (type === "routeStart") renderRouteStart();
  else if (type === "addKind") renderAddKind();
  else if (type === "flow") renderFlow();
  else renderSituationManager();
}

/** ルートの始点を選ぶ画面（状況を選んでいないときの「ルートで見る」）。 */
function renderRouteStart() {
  const { character } = state.sheet;
  const usable = state.data.situations.filter((situation) => !situation.archived
    && (situation.kind === "trigger" ? situation.character === null || !character || situation.character === character : !character || situation.character === character));
  const row = (situation) => `<button type="button" class="sheet-row" data-route-start="${situation.id}"><span>${escapeHtml(situationText(situation))}</span><small>›</small></button>`;
  els.sheetTitle.textContent = "ルート：始点を選ぶ";
  els.sheetBody.innerHTML = `
    <h3 class="sheet-title">きっかけ</h3>${usable.filter((situation) => situation.kind === "trigger").map(row).join("")}
    <h3 class="sheet-title">局面${character ? `（${escapeHtml(character)}）` : ""}</h3>${usable.filter((situation) => situation.kind === "state").sort(byAdvantage).map(row).join("") || empty("局面はまだありません")}`;
}

function routeCardHtml({ sequence, via, fit }, ended = false) {
  const usable = usableNow(sequence, { drive: state.conditions.drive, sa: state.conditions.sa, ca: state.conditions.ca, burnout: state.conditions.burnout });
  const byId = situationsById();
  const steps = sequence.results.filter((result) => byId.get(result.nextSituationId)).map((result) =>
    `<button type="button" class="result-line" data-route-step="${sequence.id}|${result.kind}|${result.opponentAction || ""}">${escapeHtml(resultLabel(result))}${result.outcome ? ` ${OUTCOME_MARKS[result.outcome]}` : ""} → ${escapeHtml(situationText(byId.get(result.nextSituationId)))} ›</button>`).join("");
  const starts = startStatesOf(sequence);
  return `<article class="card route-card${usable ? "" : " dim"}" data-route-sequence="${sequence.id}" tabindex="-1">
    <div class="card-head">
      <h3>${escapeHtml(sequence.title)}${sequence.startup !== null ? ` <small>発生${sequence.startup}F</small>` : ""}</h3>
      ${usable ? "" : '<span class="meta">条件外</span>'}
    </div>
    ${fit === "same" ? "" : `<p class="meta">起点 ${escapeHtml(situationText(via))}${fit === "near" ? " · ±2F 注意" : ""}</p>`}
    ${notationHtml(sequence.notation)}
    ${sequence.kind === "setplay" ? outcomesHtml(sequence, starts.some((situation) => situation.recovery === "back_roll")) : ""}
    ${!ended && steps ? `<div class="result-lines">${steps}</div>` : ""}
    ${ended ? "" : `<div class="card-foot end"><button type="button" class="ghost-button" data-route-end="${sequence.id}">この手順で終える</button></div>`}
  </article>`;
}

function renderRoute() {
  const { path, character } = state.sheet;
  const byId = situationsById();
  const sequences = sequencesById();
  const last = path[path.length - 1];
  els.sheetTitle.textContent = "ルート";
  const crumbs = path.map((step, index) => ("situationId" in step
    ? `<button type="button" class="crumb" data-route-back="${index}"${index === path.length - 1 ? ' aria-current="step"' : ""}>${escapeHtml(situationText(byId.get(step.situationId)) || "削除された状況")}</button>`
    : `<button type="button" class="crumb crumb-sequence" data-route-back="${index}"${index === path.length - 1 ? ' aria-current="step"' : ""}>${escapeHtml(sequences.get(step.sequenceId)?.title || "削除された手順")}</button>`)).join('<span class="crumb-sep">›</span>');
  const summary = conditionSummaryText();
  const sequenceCount = path.filter((step) => "sequenceId" in step).length;
  const drillButton = sequenceCount
    ? `<button type="button" class="primary-button route-drill" data-route-drill>この流れを練習に追加（${sequenceCount}手順）</button>`
    : "";
  const head = `<nav class="crumbs" aria-label="たどった道のり">${crumbs}</nav>
    <p class="meta">条件：${escapeHtml(summary.length ? summary.join(" · ") : "指定なし")}</p>`;
  // 手順で終えた道のり：その手順だけを出す（1つ前の状況のパンくずで戻れる）
  if ("sequenceId" in last) {
    const sequence = sequences.get(last.sequenceId);
    const via = byId.get(path[path.length - 2]?.situationId);
    els.sheetBody.innerHTML = `${head}
      <div class="card-list">${sequence ? routeCardHtml({ sequence, via, fit: "same" }, true) : ""}</div>
      ${drillButton}`;
    return;
  }
  const current = byId.get(last.situationId);
  const candidates = state.data.sequences.filter((sequence) => !character || sequence.character === character);
  const found = current ? sequencesFrom(current, candidates, state.data.situations) : [];
  const same = found.filter((entry) => entry.fit === "same");
  const near = found.filter((entry) => entry.fit !== "same");
  els.sheetBody.innerHTML = `${head}
    <h3 class="sheet-title">この状況から</h3>
    <div class="card-list">${same.map((entry) => routeCardHtml(entry)).join("") || empty("この状況から始まる手順はありません")}</div>
    ${near.length ? `<h3 class="sheet-title">合う局面から</h3><div class="card-list">${near.map((entry) => routeCardHtml(entry)).join("")}</div>` : ""}
    ${drillButton}`;
}

function openRoute(path, character) {
  openSheet({ type: "route", path, character: character || "" });
}

function renderSituationManager() {
  const { character } = state.sheet;
  const usage = (situation) => {
    const counts = situationUsage(situation.id, state.data.sequences);
    return counts.starts + counts.results;
  };
  const row = (situation) => `<button type="button" class="sheet-row" data-edit-situation="${situation.id}">
      <span>${escapeHtml(situation.name)}${situation.presetKey ? ' <small class="preset-label">初期</small>' : ""}${situation.kind === "state" && stateLabel(situation) !== situation.name ? ` <small>${escapeHtml(stateLabel(situation))}</small>` : ""}${situation.kind === "trigger" && situation.character ? ` <small>${escapeHtml(situation.character)}</small>` : ""}</span>
      <small>${usage(situation)} ›</small>
    </button>`;
  const mine = (situation) => situation.kind === "trigger" ? situation.character === null || situation.character === character : situation.character === character;
  const list = state.data.situations.filter(mine);
  const triggers = list.filter((situation) => situation.kind === "trigger" && !situation.archived);
  const states = list.filter((situation) => situation.kind === "state" && !situation.archived).sort(byAdvantage);
  const archived = list.filter((situation) => situation.archived);
  const characters = [...new Set([character, ...charactersIn(state.data.sequences, "character")].filter(Boolean))];
  els.sheetTitle.textContent = "状況";
  els.sheetBody.innerHTML = `
    <div class="add-situation"><input id="newTrigger" maxlength="60" placeholder="＋ きっかけを追加（例：昇龍ガード後）" /><button type="button" class="secondary-button small" data-add-trigger>追加</button></div>
    <h3 class="sheet-title">きっかけ</h3>
    ${triggers.map(row).join("")}
    <div class="sheet-title-row">
      <h3 class="sheet-title">局面</h3>
      <select id="sheetCharacter" aria-label="局面のキャラ">${characters.map((name) => `<option value="${escapeHtml(name)}"${name === character ? " selected" : ""}>${escapeHtml(name)}</option>`).join("")}</select>
      <button type="button" class="ghost-button" data-add-state>＋ 局面</button>
    </div>
    ${states.map(row).join("") || empty(character ? "局面はまだありません" : "キャラを選ぶと局面が出ます")}
    ${archived.length ? `<details class="fold"><summary>アーカイブ ${archived.length}</summary>${archived.map(row).join("")}</details>` : ""}`;
}

async function addTrigger(input) {
  const name = input.value.trim().slice(0, 60);
  if (!name) return null;
  const existing = state.data.situations.find((situation) => situation.kind === "trigger" && situation.character === null && situation.name === name);
  if (existing) {
    input.value = "";
    return existing;
  }
  try {
    const saved = await send("POST", "situations", {
      character: null, kind: "trigger", name, advantage: null, position: "anywhere", recovery: null, memo: null, archived: false,
    });
    replaceItem("situations", saved);
    input.value = "";
    return saved;
  } catch (error) {
    showToast(error instanceof Error ? error.message : "追加できませんでした。");
    return null;
  }
}

// ---------- 編集モーダル ----------

const MASTERY_OPTIONS = Object.fromEntries(MASTERY.map((label, level) => [level, label]));
const FRAME_HINT = "トレモのフレームメーターで、相手が起き上がって動けるまでに自分が先に動けるF";

/**
 * kinds: 手順の種類（combo / setplay）で出し分ける。more: 「詳細」の折りたたみに入れる。
 * editOnly / addOnly: 編集のときだけ / 追加のときだけ出す。
 */
const FORMS = {
  sequences: {
    title: (values) => (values.kind === "setplay" ? "起き攻め" : "コンボ"),
    fields: [
      { key: "character", label: "キャラ", type: "character", required: true },
      { key: "starts", label: "始動の状況", type: "startChips", required: true, kinds: ["combo"] },
      { key: "starts", label: "起点の局面", type: "startStates", required: true, kinds: ["setplay"] },
      { key: "notation", label: "レシピ", type: "notation", max: 1000, required: true, kinds: ["combo"] },
      { key: "notation", label: "手順", type: "notation", max: 1000, required: true, moves: true, kinds: ["setplay"] },
      { key: "startup", label: "発生F", type: "number", min: 1, max: 99, nullable: true, half: true, kinds: ["combo"], suggest: true },
      { key: "damage", label: "ダメージ", type: "number", min: 0, max: 20000, nullable: true, half: true, kinds: ["combo"] },
      { key: "driveCost", label: "Dゲージ", type: "select", options: DRIVE_STEPS, numeric: true, half: true, kinds: ["combo"] },
      { key: "saCost", label: "SA", type: "select", options: SA_LEVELS, numeric: true, half: true, kinds: ["combo"] },
      { key: "position", label: "位置", type: "select", options: POSITIONS, kinds: ["combo"] },
      { key: "aim", label: "狙い", type: "radio", options: AIMS, kinds: ["setplay"] },
      { key: "outcomes", label: "相手の行動ごとの結果", type: "outcomes", kinds: ["setplay"], hint: "押すたびに ○（こちらが勝つ）→ ×（負ける）→ –（未確認）。→ で次の状況を選べます" },
      { key: "resultHit", label: "ヒットしたら", type: "next", resultKind: "hit" },
      { key: "title", label: "名前", type: "text", max: 120, placeholder: "空欄ならレシピから付けます" },
      { key: "resultGuard", label: "ガードされたら", type: "next", resultKind: "guard", more: true },
      { key: "endPurpose", label: "締めの目的", type: "select", options: { "": "未設定", ...END_PURPOSES }, more: true, kinds: ["combo"] },
      { key: "layering", label: "重ね方", type: "select", options: { "": "未設定", ...LAYERINGS }, more: true, kinds: ["setplay"] },
      { key: "driveCost", label: "Dゲージ", type: "select", options: DRIVE_STEPS, numeric: true, half: true, more: true, kinds: ["setplay"] },
      { key: "saCost", label: "SA", type: "select", options: SA_LEVELS, numeric: true, half: true, more: true, kinds: ["setplay"] },
      { key: "position", label: "位置", type: "select", options: POSITIONS, more: true, kinds: ["setplay"] },
      { key: "mastery", label: "習得度", type: "select", options: MASTERY_OPTIONS, numeric: true, more: true },
      { key: "memo", label: "メモ", type: "textarea", max: 2000, rows: 2, placeholder: "コツ・ヒット確認やタイミングの目安など", more: true },
      { key: "archived", label: "アーカイブ（一覧から隠す）", type: "checkbox", editOnly: true, more: true },
    ],
    defaults: (preset = {}) => ({
      kind: preset.kind || "combo", character: stored("sf6-character", ""), title: "", notation: "", startup: null, damage: null,
      driveCost: 0, saCost: 0, position: "anywhere", layering: null, aim: preset.kind === "setplay" ? "strike" : null, endPurpose: null,
      mastery: 0, memo: null, archived: false, starts: [], results: [],
    }),
  },
  situations: {
    title: () => "状況",
    fields: [
      { key: "kind", label: "種類", type: "radio", options: SITUATION_KINDS, addOnly: true },
      { key: "name", label: "名前", type: "text", max: 60, required: true, placeholder: "例：強エアニー締め後" },
      { key: "character", label: "キャラ", type: "situationCharacter", showIf: (values) => values.kind === "state" || Boolean(state.editing?.item?.character) },
      { key: "advantage", label: "有利F", type: "number", min: -99, max: 300, nullable: true, required: true, hint: FRAME_HINT, showIf: (values) => values.kind === "state" },
      { key: "position", label: "位置", type: "select", options: POSITIONS, half: true, showIf: (values) => values.kind === "state" },
      { key: "recovery", label: "ダウン", type: "select", options: { "": "未設定", ...RECOVERIES }, half: true, showIf: (values) => values.kind === "state" },
      { key: "memo", label: "メモ", type: "textarea", max: 2000, rows: 2 },
      { key: "archived", label: "アーカイブ（一覧から隠す）", type: "checkbox", editOnly: true },
    ],
    defaults: () => ({ character: null, kind: "trigger", name: "", advantage: null, position: "anywhere", recovery: null, memo: null, archived: false }),
  },
  drills: {
    title: () => "練習メニュー",
    fields: [
      { key: "title", label: "練習すること", type: "text", max: 200, required: true, placeholder: "例：中足ラッシュをヒット確認" },
      { key: "detail", label: "やり方・目標", type: "textarea", max: 2000, rows: 2, placeholder: "例：ランダムガードで10回連続" },
      { key: "sequenceIds", label: "練習する対象", type: "target" },
      { key: "guardSetting", label: "ガード", type: "select", options: { "": "指定なし", ...GUARD_SETTINGS }, half: true },
      { key: "counterSetting", label: "カウンター", type: "select", options: { "": "指定なし", ...COUNTER_SETTINGS }, half: true },
      { key: "recoverySetting", label: "受け身", type: "select", options: { "": "指定なし", ...RECOVERY_SETTINGS }, half: true },
      { key: "reversalRecorded", label: "無敵技を録画して再生する", type: "checkbox" },
      { key: "status", label: "状態", type: "select", options: { active: "進行中", done: "完了" }, editOnly: true },
    ],
    defaults: () => ({
      title: "", detail: null, sequenceIds: [], status: "active",
      guardSetting: null, counterSetting: null, recoverySetting: null, reversalRecorded: false,
    }),
  },
  logs: {
    title: () => "練習記録",
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
    title: () => "振り返り",
    fields: [
      { key: "playedOn", label: "日付", type: "date", required: true, half: true },
      { key: "mode", label: "モード", type: "select", options: MODES, half: true },
      { key: "myCharacter", label: "使用キャラ", type: "character", required: true, half: true },
      { key: "opponent", label: "相手キャラ", type: "character", required: true, half: true },
      { key: "result", label: "結果", type: "radio", options: RESULTS },
      { key: "good", label: "良かった点", type: "textarea", max: 2000, rows: 2 },
      { key: "bad", label: "反省点", type: "textarea", max: 2000, rows: 3, placeholder: "あとで「練習にする」で送れます" },
    ],
    defaults: () => {
      const last = state.data.matches[0];
      return { playedOn: state.data.today, mode: last?.mode || "ranked", myCharacter: last?.myCharacter || stored("sf6-character", ""), opponent: "", result: "win", good: null, bad: null };
    },
  },
};

/** 今のモーダルで出す項目（種類・追加/編集で絞る）。 */
function visibleFields(resource, values, isEdit) {
  return FORMS[resource].fields.filter((field) => (!field.kinds || field.kinds.includes(values.kind))
    && !(field.editOnly && !isEdit) && !(field.addOnly && isEdit));
}

function formCharacter() {
  return document.getElementById("field-character")?.value.trim() || state.editing?.values.character || "";
}

function formPosition() {
  return document.getElementById("field-position")?.value || "anywhere";
}

// --- 始動の状況（コンボ：きっかけ＋局面のトグルチップ） ---

function startChipsHtml(selected, character = formCharacter()) {
  const groups = startSituationGroups(state.data.situations, state.data.sequences, character, selected, 2);
  const chip = (situation, pressed = false) => `<button type="button" class="toggle-chip${situation.kind === "state" ? " state" : ""}" data-start-id="${situation.id}" aria-pressed="${pressed}">${escapeHtml(situationText(situation))}${pressed ? ' <span aria-hidden="true">×</span>' : ""}</button>`;
  const group = (key, label, entries) => entries.visible.length || entries.more.length ? `<section class="start-group" data-start-group="${key}" aria-label="${label}">
    <span class="start-label">${label}</span><div class="toggle-chips">${entries.visible.map((entry) => chip(entry)).join("")}</div>
    ${entries.more.length ? `<details class="start-more"><summary>すべて表示（${entries.more.length}）</summary><div class="toggle-chips">${entries.more.map((entry) => chip(entry)).join("")}</div></details>` : ""}</section>` : "";
  return `${groups.selected.length ? `<section class="start-group" aria-label="選択中"><span class="start-label">選択中（${groups.selected.length}）</span><div class="toggle-chips selected-starts">${groups.selected.map((entry) => chip(entry, true)).join("")}</div></section>` : ""}
    ${group("trigger", "きっかけ", groups.triggers)}${group("state", "局面", groups.states)}`;
}

function renderStartChips(selected, focusId = null) {
  const chips = document.getElementById("startChips");
  const openGroups = [...chips.querySelectorAll("[data-start-group]")].filter((group) => group.querySelector("details")?.open).map((group) => group.dataset.startGroup);
  chips.innerHTML = startChipsHtml(selected);
  openGroups.forEach((key) => {
    const details = chips.querySelector(`[data-start-group="${key}"] details`);
    if (details) details.open = true;
  });
  if (focusId !== null) chips.querySelector(`[data-start-id="${focusId}"]`)?.focus({ preventScroll: true });
}

function selectedStartChips() {
  return [...els.formFields.querySelectorAll("[data-start-id][aria-pressed=true]")].map((chip) => Number(chip.dataset.startId));
}

// --- 局面ピッカー（ヒット・ガード・相手の行動の次の状況、起き攻めの起点） ---

function refName(ref) {
  if (typeof ref === "number") return situationText(findSituation(ref)) || "削除された状況";
  return ref.state.name || stateLabel({ kind: "state", ...ref.state });
}

/**
 * config.allowPosition: 位置を選べる（起き攻めの起点）。ほかは手順の「位置」を使う。
 * config.withTriggers: 一覧にきっかけも出す。config.add: 「追加」ボタンを置く（起点を複数選ぶとき）。
 */
function pickerHtml(key, ref, config = {}) {
  const situation = typeof ref === "number" ? findSituation(ref) : null;
  const numbers = situation?.kind === "state" ? situation : ref && typeof ref === "object" ? ref.state : null;
  const character = formCharacter();
  const states = state.data.situations.filter((entry) => entry.kind === "state" && entry.character === character
    && (!entry.archived || entry.id === situation?.id)).sort(byAdvantage);
  const triggers = config.withTriggers ? state.data.situations.filter((entry) => entry.kind === "trigger"
    && (entry.character === null || entry.character === character) && (!entry.archived || entry.id === situation?.id)) : [];
  return `<div class="picker" data-picker="${escapeHtml(key)}"${config.allowPosition ? " data-allow-position" : ""}>
    <div class="picker-row">
      <label class="picker-num"><span>有利F</span><input type="number" inputmode="numeric" data-pick="advantage" min="-99" max="300" step="1" value="${numbers ? escapeHtml(numbers.advantage) : ""}" placeholder="例：29" /></label>
      <label><span>ダウン</span><select data-pick="recovery">${options({ "": "未設定", ...RECOVERIES }, numbers?.recovery || "")}</select></label>
      ${config.allowPosition ? `<label><span>位置</span><select data-pick="position">${options(POSITIONS, numbers?.position || "anywhere")}</select></label>` : ""}
    </div>
    <p class="picker-match" data-pick-match></p>
    <input data-pick="name" maxlength="60" placeholder="局面の名前" value="${escapeHtml(ref && typeof ref === "object" ? ref.state.name || "" : "")}" hidden />
    <div class="picker-row">
      <select data-pick="list" aria-label="一覧から選ぶ"><option value="">一覧から選ぶ</option>${situationOptionsHtml([["局面", states], ["きっかけ", triggers]], situation?.id ?? null)}</select>
      ${config.add ? '<button type="button" class="secondary-button small" data-add-start>追加</button>' : ""}
    </div>
  </div>`;
}

function pickerParts(picker) {
  const part = (name) => picker.querySelector(`[data-pick="${name}"]`);
  return {
    advantage: part("advantage"), recovery: part("recovery"), position: part("position"), name: part("name"), list: part("list"),
    match: picker.querySelector("[data-pick-match]"),
  };
}

function pickerKey(picker) {
  const parts = pickerParts(picker);
  if (parts.advantage.value === "" || !Number.isInteger(Number(parts.advantage.value))) return null;
  return {
    character: formCharacter(),
    advantage: Number(parts.advantage.value),
    position: picker.hasAttribute("data-allow-position") ? parts.position.value : formPosition(),
    recovery: parts.recovery.value || null,
  };
}

function newStateName(picker, key) {
  const notation = document.getElementById("field-notation")?.value || "";
  const title = document.getElementById("field-title")?.value || "";
  const name = picker.dataset.picker === "hit" ? defaultStateName(notation, movesOf(key.character), title) : null;
  return name || stateLabel({ kind: "state", ...key });
}

/** ピッカーの値：一覧で選んだ状況の id、数値に合う既存の局面の id、または新しい局面 {state}。空なら null。 */
function readPicker(picker) {
  const parts = pickerParts(picker);
  if (parts.list.value) return Number(parts.list.value);
  const key = pickerKey(picker);
  if (!key) return null;
  const found = findState(state.data.situations, key);
  if (found) return found.id;
  const name = parts.name.value.trim() || newStateName(picker, key);
  return { state: { advantage: key.advantage, position: key.position, recovery: key.recovery, name } };
}

function refreshPicker(picker) {
  const parts = pickerParts(picker);
  if (parts.list.value) {
    parts.match.innerHTML = `→ 「${escapeHtml(situationText(findSituation(Number(parts.list.value))))}」を使います`;
    parts.name.hidden = true;
    return;
  }
  const key = pickerKey(picker);
  if (!key) {
    parts.match.textContent = "";
    parts.name.hidden = true;
    return;
  }
  const found = findState(state.data.situations, key);
  if (found) {
    parts.match.innerHTML = `→ 既存の「${escapeHtml(found.name)}」を使います`;
    parts.name.hidden = true;
  } else {
    const name = parts.name.value.trim() || newStateName(picker, key);
    parts.match.innerHTML = `→ 新しい局面「${escapeHtml(name)}」を作ります <button type="button" class="link-button" data-pick-rename>名前を変える</button>`;
  }
}

function refreshPickers() {
  els.formFields.querySelectorAll("[data-picker]").forEach(refreshPicker);
}

/** 一覧で選んだら数値を入れ、数値を変えたら一覧の選択を外す（一覧の選択が優先されるため）。 */
function onPickerChange(target) {
  const picker = target.closest("[data-picker]");
  if (!picker) return;
  const parts = pickerParts(picker);
  if (target === parts.list) {
    const situation = findSituation(Number(parts.list.value));
    if (situation?.kind === "state") {
      parts.advantage.value = String(situation.advantage);
      parts.recovery.value = situation.recovery || "";
      if (parts.position) parts.position.value = situation.position;
    } else if (situation) {
      parts.advantage.value = "";
      parts.recovery.value = "";
    }
  } else if (target.dataset.pick !== "name") {
    parts.list.value = "";
  }
  refreshPicker(picker);
}

// --- 起き攻めの起点（局面を複数） ---

function startStateChipsHtml(refs) {
  return refs.length
    ? refs.map((ref, index) => `<span class="toggle-chip state" aria-pressed="true">${escapeHtml(refName(ref))}<button type="button" class="chip-remove" data-remove-start="${index}" aria-label="起点から外す">×</button></span>`).join("")
    : '<span class="field-hint">下で有利F・ダウン・位置を入れるか、一覧から選んで「追加」</span>';
}

function sameRef(a, b) {
  if (typeof a === "number" || typeof b === "number") return a === b;
  return a.state.advantage === b.state.advantage && a.state.position === b.state.position && a.state.recovery === b.state.recovery;
}

function addStartFromPicker() {
  const picker = els.formFields.querySelector('[data-picker="start"]');
  const ref = picker ? readPicker(picker) : null;
  if (!ref) return false;
  if (!state.editing.startRefs.some((entry) => sameRef(entry, ref))) state.editing.startRefs.push(ref);
  picker.outerHTML = pickerHtml("start", null, { allowPosition: true, withTriggers: false, add: true });
  renderStartStates();
  return true;
}

function renderStartStates() {
  const chipsEl = document.getElementById("startStateChips");
  if (chipsEl) chipsEl.innerHTML = startStateChipsHtml(state.editing.startRefs);
  syncBackRoll();
}

function startsHaveBackRoll() {
  return state.editing.startRefs.some((ref) => (typeof ref === "number" ? findSituation(ref)?.recovery : ref.state.recovery) === "back_roll");
}

/** 「後ろ受け身」の○×は、起点に後ろ受け身できるダウンがあるときだけ出す。 */
function syncBackRoll() {
  const item = els.formFields.querySelector('[data-outcome-item="back_roll"]');
  if (item) item.hidden = !startsHaveBackRoll();
  const next = els.formFields.querySelector('[data-outcome-next="back_roll"]');
  if (next && !startsHaveBackRoll()) next.hidden = true;
}

// --- 相手の行動ごとの結果（起き攻め） ---

function outcomesFieldHtml(field, results) {
  const byAction = Object.fromEntries(results.filter((result) => result.kind === "opponent").map((result) => [result.opponentAction, result]));
  const buttons = OPPONENT_OPTIONS.map((action) => {
    const value = byAction[action]?.outcome || "unknown";
    return `<span class="outcome-item" data-outcome-item="${action}">
      <button type="button" class="outcome ${value}" data-outcome="${action}" data-value="${value}"><b>${OUTCOME_MARKS[value]}</b>${escapeHtml(OPPONENT_LABELS[action])}</button>
      <button type="button" class="next-toggle" data-next-toggle="${action}" aria-label="${escapeHtml(OPPONENT_LABELS[action])}の次の状況"${value === "unknown" ? " hidden" : ""}>→</button>
    </span>`;
  }).join("");
  const nexts = OPPONENT_OPTIONS.map((action) => {
    const next = byAction[action]?.nextSituationId ?? byAction[action]?.next ?? null;
    return `<div class="outcome-next" data-outcome-next="${action}"${next === null ? " hidden" : ""}>
      <span class="field-label">${escapeHtml(OPPONENT_LABELS[action])}のあと</span>
      ${pickerHtml(`opponent:${action}`, next, { withTriggers: true })}
    </div>`;
  }).join("");
  return `<div class="chip-field" data-field="${field.key}">
    <span class="field-label">${escapeHtml(field.label)}</span><small class="field-hint">${escapeHtml(field.hint)}</small>
    <div class="outcome-buttons">${buttons}</div>
    ${nexts}
  </div>`;
}

function resultNext(results, kind) {
  const result = results.find((entry) => entry.kind === kind);
  return result ? result.nextSituationId ?? result.next ?? null : null;
}

function fieldHtml(field, value, values) {
  const id = `field-${field.key}`;
  const label = `<span>${escapeHtml(field.label)}${field.required ? " <b>必須</b>" : ""}</span>`;
  const hint = field.hint ? `<small class="field-hint">${escapeHtml(field.hint)}</small>` : "";
  const text = value === null || value === undefined ? "" : String(value);
  const half = field.half ? " half" : "";
  const showIf = field.showIf ? ` data-show-if="${field.key}"` : "";
  switch (field.type) {
    case "hidden":
      return `<input type="hidden" id="${id}" value="${escapeHtml(text)}" />`;
    case "checkbox":
      return `<label class="check-field" data-field="${field.key}"><input type="checkbox" id="${id}"${value ? " checked" : ""} /><span>${escapeHtml(field.label)}</span></label>`;
    case "notation":
      return `<div class="notation-field" data-field="${field.key}">
        <span class="field-label">${escapeHtml(field.label)} <b>必須</b></span>
        <div class="notation-preview" id="notationPreview" tabindex="0" role="group" aria-label="レシピのキーボード入力" aria-describedby="notationKeyboardHelp" aria-live="polite"></div>
        <small class="notation-keyboard-hint" id="notationKeyboardHelp">矢印 / 1〜9：方向 · U I O：弱中強P · J K L：弱中強K · Space：つなぎ · X：キャンセル <a href="/help/#sf6-keyboard" target="_blank" rel="noopener">キー一覧</a></small>
        <div class="fragments" id="notationFragments" hidden></div>
        ${paletteHtml(field.moves)}
        <details class="notation-raw"><summary>文字で直接編集</summary>
          <textarea id="${id}" rows="2" maxlength="${field.max}" placeholder="例：2中K > DR 5中P > 2強P xx 236強P">${escapeHtml(text)}</textarea>
        </details>
      </div>`;
    case "startChips":
      return `<div class="chip-field" data-field="${field.key}">
        <span class="field-label">${escapeHtml(field.label)} <b>必須</b></span>
        <div class="start-groups" id="startChips">${startChipsHtml(value || [], values.character || "")}</div>
        <div class="add-situation"><input id="newSituation" maxlength="60" placeholder="＋ 状況を追加（例：昇龍ガード後）" /><button type="button" class="secondary-button small" data-add-situation>追加</button></div>
      </div>`;
    case "startStates":
      return `<div class="chip-field" data-field="${field.key}">
        <span class="field-label">${escapeHtml(field.label)} <b>必須</b></span>
        <div class="toggle-chips" id="startStateChips">${startStateChipsHtml(state.editing.startRefs)}</div>
        ${pickerHtml("start", null, { allowPosition: true, add: true })}
      </div>`;
    case "next":
      return `<div class="chip-field" data-field="${field.key}">
        <span class="field-label">${escapeHtml(field.label)}</span>
        ${pickerHtml(field.resultKind, resultNext(values.results, field.resultKind), { withTriggers: true })}
      </div>`;
    case "outcomes":
      return outcomesFieldHtml(field, values.results);
    case "target": {
      if (value.length > 1) {
        return `<div class="chip-field" data-field="${field.key}">
          <span class="field-label">練習する手順</span>
          <ol class="chain-list">${value.map((sequenceId) => `<li>${escapeHtml(findSequence(sequenceId)?.title || "削除された手順")}</li>`).join("")}</ol>
          <small class="field-hint">変えるときはルートから作り直します</small>
        </div>`;
      }
      const selected = value[0] ?? null;
      const option = (sequence) => `<option value="${sequence.id}"${sequence.id === selected ? " selected" : ""}>${escapeHtml(`${sequence.character}：${sequence.title}`)}</option>`;
      const list = (kind) => state.data.sequences.filter((sequence) => sequence.kind === kind && (!sequence.archived || sequence.id === selected));
      return `<label data-field="${field.key}">${label}<select id="${id}"><option value="">なし</option>
        ${list("combo").length ? `<optgroup label="コンボ">${list("combo").map(option).join("")}</optgroup>` : ""}
        ${list("setplay").length ? `<optgroup label="起き攻め">${list("setplay").map(option).join("")}</optgroup>` : ""}
      </select></label>`;
    }
    case "textarea":
      return `<label data-field="${field.key}"${showIf}>${label}<textarea id="${id}" rows="${field.rows || 3}" maxlength="${field.max}" placeholder="${escapeHtml(field.placeholder || "")}">${escapeHtml(text)}</textarea></label>`;
    case "select":
      return `<label class="${half}" data-field="${field.key}"${showIf}>${label}<select id="${id}">${options(field.options, text)}</select>${hint}</label>`;
    case "radio":
      return `<fieldset class="radio-field" data-field="${field.key}"><legend>${escapeHtml(field.label)}</legend>${Object.entries(field.options).map(([option, name]) =>
        `<label><input type="radio" name="${field.key}" value="${option}"${option === text ? " checked" : ""} /><span>${escapeHtml(name)}</span></label>`).join("")}</fieldset>`;
    case "situationCharacter": {
      // 使用中の状況はキャラを変えられない（DBのトリガーでも拒む）。きっかけを全キャラ共通にすることだけはできる
      const inUse = situationInUse(state.editing.item);
      const note = '<small class="field-hint">使っている手順があるため変えられません</small>';
      if (inUse && values.kind === "trigger") {
        return `<label data-field="${field.key}"${showIf}>${label}<select id="${id}">${options([[text, text], ["", "全キャラ共通"]], text)}</select><small class="field-hint">使っている手順があるため、全キャラ共通にだけ変えられます</small></label>`;
      }
      return `<label data-field="${field.key}"${showIf}>${label}<input id="${id}" list="characterOptions" maxlength="40" autocomplete="off" value="${escapeHtml(text)}" placeholder="キャラ名"${inUse ? " readonly" : ""} />${inUse ? note : ""}</label>`;
    }
    case "character":
      return `<label class="${half}" data-field="${field.key}"${showIf}>${label}<input id="${id}" list="characterOptions" maxlength="40" autocomplete="off" value="${escapeHtml(text)}" placeholder="キャラ名" /></label>`;
    case "number":
      return `<label class="${half}" data-field="${field.key}"${showIf}>${label}<input id="${id}" type="number" inputmode="numeric" min="${field.min}" max="${field.max}" step="1" value="${escapeHtml(text)}" placeholder="${escapeHtml(field.placeholder || "")}" />${hint}${field.suggest ? '<span class="suggest" id="startupSuggest"></span>' : ""}</label>`;
    case "date":
      return `<label class="${half}" data-field="${field.key}"${showIf}>${label}<input id="${id}" type="date" max="${state.data.today}" value="${escapeHtml(text)}" /></label>`;
    default:
      return `<label class="${half}" data-field="${field.key}"${showIf}>${label}<input id="${id}" maxlength="${field.max}" placeholder="${escapeHtml(field.placeholder || "")}" value="${escapeHtml(text)}" /></label>`;
  }
}

/** 手順の結果を入力欄から組み立てる。起き攻めでない手順の相手の行動は、今の値をそのまま残す。 */
function readResults(base) {
  const results = [];
  for (const kind of ["hit", "guard"]) {
    const picker = els.formFields.querySelector(`[data-picker="${kind}"]`);
    const next = picker ? readPicker(picker) : resultNext(base.results, kind);
    if (next !== null) results.push({ kind, next });
  }
  const buttons = [...els.formFields.querySelectorAll("[data-outcome]")];
  if (!buttons.length) {
    base.results.filter((result) => result.kind === "opponent").forEach((result) => results.push({
      kind: "opponent", opponentAction: result.opponentAction, outcome: result.outcome, next: result.nextSituationId ?? result.next ?? null,
    }));
    return results;
  }
  for (const button of buttons) {
    const action = button.dataset.outcome;
    if (button.closest("[data-outcome-item]")?.hidden) continue;
    const box = els.formFields.querySelector(`[data-outcome-next="${action}"]`);
    const next = box && !box.hidden ? readPicker(box.querySelector("[data-picker]")) : null;
    if (button.dataset.value !== "unknown" || next !== null) results.push({ kind: "opponent", opponentAction: action, outcome: button.dataset.value, next });
  }
  return results;
}

/** モーダルの入力値を読む。空欄の任意項目は null。 */
function readForm(resource, base) {
  const values = { ...base };
  const fields = visibleFields(resource, base, Boolean(state.editing.item));
  for (const field of fields) {
    if (field.type === "radio") {
      values[field.key] = els.formFields.querySelector(`input[name="${field.key}"]:checked`)?.value || base[field.key];
      continue;
    }
    if (field.type === "startChips") {
      values.starts = selectedStartChips();
      continue;
    }
    if (field.type === "startStates") {
      values.starts = [...state.editing.startRefs];
      continue;
    }
    if (field.type === "next" || field.type === "outcomes") continue;
    const input = document.getElementById(`field-${field.key}`);
    if (field.type === "target") {
      if (input) values.sequenceIds = input.value ? [Number(input.value)] : [];
      continue;
    }
    if (!input) continue;
    if (field.type === "checkbox") values[field.key] = input.checked;
    else if (field.type === "number" || field.numeric) values[field.key] = input.value === "" ? null : Number(input.value);
    else values[field.key] = input.value.trim() || null;
  }
  if (resource === "sequences") values.results = readResults(base);
  return values;
}

function syncConditional(resource) {
  const values = readForm(resource, state.editing.values);
  FORMS[resource].fields.filter((field) => field.showIf).forEach((field) => {
    const wrapper = els.formFields.querySelector(`[data-show-if="${field.key}"]`);
    if (wrapper) wrapper.hidden = !field.showIf(values);
  });
}

function fragmentsHtml(character) {
  const list = state.data.sequences.filter((sequence) => !sequence.archived && sequence.kind === state.editing.values.kind);
  const own = list.filter((sequence) => sequence.character === character);
  const fragments = frequentFragments((own.length ? own : list).map((sequence) => sequence.notation));
  if (!fragments.length) return "";
  return `<span class="frag-label">よく使う</span>${fragments.map((fragment) =>
    `<button type="button" class="frag" data-fragment="${escapeHtml(fragment)}">${escapeHtml(fragment)}</button>`).join("")}`;
}

/** レシピのプレビュー・よく使う出だし・発生Fの提案・局面の名前の候補を更新する。 */
function refreshNotationAssist() {
  const input = document.getElementById("field-notation");
  if (!input || !state.editing) return;
  const preview = document.getElementById("notationPreview");
  preview.innerHTML = input.value.trim() ? notationHtml(input.value) : '<p class="notation-empty">ここを選んでキー入力 / 下のボタンで入力</p>';
  const fragments = document.getElementById("notationFragments");
  fragments.innerHTML = fragmentsHtml(formCharacter());
  fragments.hidden = !fragments.innerHTML;
  const suggest = document.getElementById("startupSuggest");
  if (suggest) {
    const move = document.getElementById("field-startup").value === "" ? starterMove(input.value, movesOf(formCharacter())) : null;
    suggest.innerHTML = move?.startup ? `<button type="button" class="suggest-chip" data-suggest-startup="${move.startup}">${escapeHtml(move.command)} 発生${move.startup}F を入れる</button>` : "";
  }
  refreshPickers();
}

function editNotation(change) {
  const input = document.getElementById("field-notation");
  if (!input) return;
  input.value = change(input.value).slice(0, 1000);
  refreshNotationAssist();
}

/** 技データのあるキャラなら読み込んで、発生Fの提案と局面の名前に使う。 */
function prepareMoves() {
  const character = formCharacter();
  if (state.moves.has(character)) return;
  ensureMoves(character).then((data) => { if (data && state.editing) refreshNotationAssist(); }).catch(() => {});
}

function openModal(resource, item = null, preset = {}) {
  const form = FORMS[resource];
  const values = item ? { ...item } : { ...form.defaults(preset), ...preset };
  state.editing = { resource, item, values, startRefs: [...(values.starts || [])] };
  els.modalTitle.textContent = `${form.title(values)}を${item ? "編集" : "追加"}`;
  const fields = visibleFields(resource, values, Boolean(item));
  const isCombo = resource === "sequences" && values.kind === "combo";
  const isMore = (field) => field.more || (isCombo && !field.required);
  const main = fields.filter((field) => !isMore(field)).map((field) => fieldHtml(field, values[field.key], values)).join("");
  const more = fields.filter(isMore).map((field) => fieldHtml(field, values[field.key], values)).join("");
  els.formFields.innerHTML = `${main}${more ? `<details class="form-more"><summary>${isCombo ? "任意項目" : "詳細"}</summary><div class="form-grid">${more}</div></details>` : ""}`;
  els.formError.hidden = true;
  els.deleteConfirm.hidden = true;
  // 初期の状況は削除できない（アーカイブだけ）
  els.deleteButton.hidden = !item || (resource === "situations" && Boolean(item.presetKey));
  els.saveButton.textContent = item ? "保存する" : "追加する";
  syncConditional(resource);
  syncBackRoll();
  refreshNotationAssist();
  refreshPickers();
  if (resource === "sequences") prepareMoves();
  els.editModal.hidden = false;
  const first = els.formFields.querySelector("input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=date]), textarea");
  // スマホで勝手にキーボードが開かないよう、フォーカスはPC幅のときだけ
  if (first && window.matchMedia("(min-width: 681px)").matches) first.focus();
}

function closeModal() {
  notationKeyboard.reset();
  els.editModal.hidden = true;
  state.editing = null;
}

function validate(resource, values) {
  for (const field of visibleFields(resource, state.editing.values, Boolean(state.editing.item))) {
    const wrapper = els.formFields.querySelector(`[data-show-if="${field.key}"]`);
    if (wrapper?.hidden) continue;
    const value = values[field.key];
    if (field.required && (value === null || value === "" || (Array.isArray(value) && value.length === 0))) {
      if (field.type === "startChips") return "始動の状況を1つ以上選んでください。";
      if (field.type === "startStates") return "起点の局面を1つ以上追加してください。";
      return `「${field.label}」を入力してください。`;
    }
    if (field.type === "number" && value !== null && (!Number.isInteger(value) || value < field.min || value > field.max)) {
      return `「${field.label}」は${field.min}〜${field.max}の整数で入力してください。`;
    }
  }
  if (resource === "situations" && values.kind === "state" && !values.character) return "局面にはキャラを入力してください。";
  if (resource === "logs" && (values.attempts === null) !== (values.successes === null)) return "回数と成功は両方入力するか、両方空欄にしてください。";
  if (resource === "logs" && values.attempts !== null && values.successes > values.attempts) return "成功は回数以下にしてください。";
  if (resource === "logs" && values.bestStreak !== null && (values.successes === null || values.bestStreak > values.successes)) {
    return "連続成功は成功以下にしてください（回数・成功も入力してください）。";
  }
  return null;
}

/** 見えていない項目を既定値に戻す（種類に合わない項目はDBの制約で拒否されるため）。 */
function normalizeValues(resource, values) {
  if (resource === "sequences") {
    if (!values.title) values.title = defaultTitle(values.notation);
    if (values.kind === "combo") Object.assign(values, { aim: null, layering: null });
    else values.endPurpose = null;
  }
  if (resource === "situations" && values.kind === "trigger") Object.assign(values, { advantage: null, recovery: null, position: "anywhere" });
}

function showFormError(message) {
  els.formError.textContent = message;
  els.formError.hidden = false;
}

async function submitModal(event) {
  event.preventDefault();
  if (!state.editing || state.saving) return;
  const { resource, item } = state.editing;
  if (resource === "sequences" && state.editing.values.kind === "setplay") addStartFromPicker();
  const values = readForm(resource, state.editing.values);
  normalizeValues(resource, values);
  const problem = validate(resource, values);
  if (problem) {
    showFormError(problem);
    return;
  }
  const fields = Object.fromEntries(Object.keys(FORMS[resource].defaults(values)).map((key) => [key, values[key]]));
  state.saving = true;
  els.saveButton.disabled = true;
  try {
    const saved = item
      ? await send("PATCH", resource, { id: item.id, updatedAt: item.updatedAt, ...fields })
      : await send("POST", resource, fields);
    if (resource === "logs") {
      state.data.logs.unshift(saved);
      state.data.logs.sort((a, b) => b.practicedOn.localeCompare(a.practicedOn) || b.id - a.id);
    } else applySaved(resource, saved);
    if (resource === "sequences" && fields.character) store("sf6-character", fields.character);
    if (resource === "matches") store("sf6-character", fields.myCharacter);
    closeModal();
    render();
    showToast(item ? "保存しました" : "追加しました");
  } catch (error) {
    showFormError(error instanceof Error ? error.message : "保存できませんでした。");
  } finally {
    state.saving = false;
    els.saveButton.disabled = false;
  }
}

async function deleteItem(resource, id, label, confirmed = false) {
  if (!confirmed && !window.confirm(`${label}を削除しますか？元に戻せません。`)) return false;
  try {
    await send("DELETE", resource, { id });
    // 手順は練習の連なりからも外れる（練習の updatedAt も変わるので読み直す）
    if (resource === "sequences" && state.data.drills.some((drill) => drill.sequenceIds.includes(id))) await load();
    else {
      removeItem(resource, id);
      render();
    }
    showToast("削除しました");
    return true;
  } catch (error) {
    showToast(error instanceof Error ? error.message : "削除できませんでした。");
    return false;
  }
}

/** 使われている状況の削除：件数と手順名を出して、外して削除／アーカイブ／やめるを選ぶ。 */
function confirmSituationDelete(situation) {
  const usage = situationUsage(situation.id, state.data.sequences);
  if (!usage.sequenceIds.length) return deleteItem("situations", situation.id, "この状況").then((done) => { if (done) closeModal(); });
  const first = findSequence(usage.sequenceIds[0]);
  els.deleteConfirm.innerHTML = `<p>この状況は ${usage.sequenceIds.length}件の手順で使われています：${escapeHtml(first?.title || "")}${usage.sequenceIds.length > 1 ? " ほか" : ""}</p>
    ${usage.orphaned ? `<p>${usage.orphaned}件は始動の状況がなくなります（一覧の「状況なし」に出ます）</p>` : ""}
    <div class="form-actions">
      <button type="button" class="danger-button" data-situation-delete>外して削除</button>
      <button type="button" class="secondary-button" data-situation-archive>アーカイブにする</button>
      <button type="button" class="secondary-button" data-situation-cancel>やめる</button>
    </div>`;
  els.deleteConfirm.hidden = false;
  return Promise.resolve();
}

/** 状況が手順の始動・結果に使われているか（使用中ならキャラと種類を変えられない）。 */
function situationInUse(situation) {
  if (!situation) return false;
  const usage = situationUsage(situation.id, state.data.sequences);
  return usage.starts + usage.results > 0;
}

// ---------- イベント ----------

function find(resource, id) {
  return state.data[resource].find((item) => item.id === Number(id));
}

function selectTab(tab) {
  if (!TABS.includes(tab)) return;
  state.tab = tab;
  store("sf6-tab", tab);
  if (!state.data) return;
  renderTabs();
  if (tab === "frames") loadFrames();
}

document.querySelectorAll("[data-tab]").forEach((button) => {
  button.addEventListener("click", () => selectTab(button.dataset.tab));
});

els.sequenceCharacter.addEventListener("change", () => {
  state.sequenceCharacter = els.sequenceCharacter.value;
  store("sf6-sequence-character", state.sequenceCharacter);
  renderSequences();
});
els.sequenceKind.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-value]");
  if (!button) return;
  state.sequenceKind = button.dataset.value;
  store("sf6-sequence-kind", state.sequenceKind);
  renderTabs();
  renderSequences();
});
els.sequencePosition.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-value]");
  if (!button) return;
  state.sequencePosition = button.dataset.value;
  renderSequences();
});
els.situationCharacter.addEventListener("change", () => {
  state.situationCharacter = els.situationCharacter.value;
  store("sf6-situation-character", state.situationCharacter);
  renderSituations();
});
els.situationPosition.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-value]");
  if (!button) return;
  state.situationPosition = button.dataset.value;
  renderSituations();
});
els.situationNear.addEventListener("click", () => {
  state.situationNear = !state.situationNear;
  store("sf6-situation-near", state.situationNear ? "1" : "0");
  renderSituations();
});
els.sequenceSituation.addEventListener("change", () => {
  const value = els.sequenceSituation.value;
  state.conditions.situationId = value === "" ? null : value === "none" ? "none" : Number(value);
  renderSequences();
});
els.opponentCharacter.addEventListener("change", () => {
  if (state.opponent.moveId !== null) state.conditions.punishWindow = null;
  state.opponent = { character: els.opponentCharacter.value, moveId: null, loading: false, error: "" };
  renderSequences();
  loadOpponentMoves();
});
els.opponentMove.addEventListener("change", () => {
  const move = movesOf(state.opponent.character).find((entry) => entry.id === Number(els.opponentMove.value));
  if (move) applyOpponentMove(move);
  else {
    state.opponent.moveId = null;
    state.conditions.punishWindow = null;
    renderSequences();
  }
});
els.opponentMoveRetry.addEventListener("click", loadOpponentMoves);
function readSequenceConditions(event) {
  if (event.target === els.opponentCharacter || event.target === els.opponentMove) return;
  if (event.target === els.conditionPunish) state.opponent.moveId = null;
  const punish = Number(els.conditionPunish.value);
  state.conditions.drive = els.conditionDrive.value === "" ? null : Number(els.conditionDrive.value);
  state.conditions.sa = els.conditionSa.value === "" ? null : Number(els.conditionSa.value);
  state.conditions.punishWindow = els.conditionPunish.value === "" || !Number.isInteger(punish) || punish < 1 ? null : Math.min(punish, 99);
  state.conditions.ca = els.conditionCa.checked;
  state.conditions.burnout = els.conditionBurnout.checked;
  renderSequences();
}
els.sequenceConditions.addEventListener("change", readSequenceConditions);
els.conditionPunish.addEventListener("input", readSequenceConditions);
WIDE_FRAMES.addEventListener("change", () => { if (state.data) renderFrames(); });
els.frameCharacter.addEventListener("change", () => {
  state.frames.character = els.frameCharacter.value;
  state.frames.open = null;
  loadFrames();
});
els.frameQuery.addEventListener("input", () => {
  state.frames.query = els.frameQuery.value;
  renderFrames();
});
els.frameSort.addEventListener("change", () => {
  state.frames.sort = els.frameSort.value;
  renderFrames();
});
els.frameCategory.addEventListener("click", (event) => {
  const button = event.target.closest("[data-category]");
  if (!button) return;
  state.frames.category = button.dataset.category;
  renderFrames();
});
els.framePunishable.addEventListener("click", () => {
  state.frames.punishableOnly = !state.frames.punishableOnly;
  state.frames.heavyPunishableOnly = false;
  renderFrames();
});
els.frameHeavyPunishable.addEventListener("click", () => {
  state.frames.heavyPunishableOnly = !state.frames.heavyPunishableOnly;
  state.frames.punishableOnly = false;
  renderFrames();
});
els.frameCancelable.addEventListener("click", () => {
  state.frames.cancelableOnly = !state.frames.cancelableOnly;
  renderFrames();
});

/** カードの「結果 → 次の状況」からルートを開く：始動の状況 › 手順 › 次の状況。 */
function routeFromCard(value) {
  const [sequenceId, resultKind, opponentAction] = value.split("|");
  const sequence = findSequence(Number(sequenceId));
  const result = sequence?.results.find((entry) => entry.kind === resultKind && (entry.opponentAction || "") === opponentAction);
  if (!result?.nextSituationId) return;
  const step = { sequenceId: sequence.id, resultKind, opponentAction: opponentAction || null };
  // 始点は、絞り込みで選んでいる状況がこの手順の始動にあればそれ、なければ最初の始動
  const selected = state.conditions.situationId;
  const start = sequence.starts.includes(selected) ? selected : sequence.starts[0];
  openRoute([...(start !== undefined ? [{ situationId: start }, step] : []), { situationId: result.nextSituationId }], sequence.character);
}

function routeStep(value) {
  const [sequenceId, resultKind, opponentAction] = value.split("|");
  const sequence = findSequence(Number(sequenceId));
  const result = sequence?.results.find((entry) => entry.kind === resultKind && (entry.opponentAction || "") === opponentAction);
  if (!result?.nextSituationId) return;
  state.sheet.path.push({ sequenceId: sequence.id, resultKind, opponentAction: opponentAction || null }, { situationId: result.nextSituationId });
  if (!state.sheet.character) state.sheet.character = sequence.character;
  renderSheet();
  els.sheet.querySelector(".sheet").scrollTop = 0;
}

async function raiseMastery(drill) {
  const logs = state.data.logs.filter((log) => log.drillId === drill.id);
  const targets = raiseTargets(drill.sequenceIds, state.data.sequences, logs);
  for (const target of targets) {
    if (!(await patch("sequences", target, { mastery: 2 }))) return;
  }
  showToast(`習得度：${MASTERY[2]}（${targets.length}件）`);
}

async function onAction(event) {
  const target = event.target.closest("button");
  if (!target || !state.data) return;
  const { dataset } = target;
  if (target.closest("details.menu")) target.closest("details.menu").removeAttribute("open");
  if (dataset.edit) openModal(dataset.edit, find(dataset.edit, dataset.id));
  else if (dataset.mastery !== undefined) {
    const item = find("sequences", dataset.id);
    const level = Number(dataset.mastery);
    // 今の段階をもう一度押すと1段下げる
    const next = level === item.mastery ? Math.max(0, level - 1) : level;
    if (next !== item.mastery) await patch("sequences", item, { mastery: next }, `習得度：${MASTERY[next]}`);
  } else if (dataset.drillFromSequence) {
    openModal("drills", null, drillPreset(find("sequences", dataset.drillFromSequence), situationsById()));
  } else if (dataset.setplayFromCombo) {
    const combo = find("sequences", dataset.setplayFromCombo);
    openModal("sequences", null, { kind: "setplay", character: combo.character, starts: [resultOf(combo, "hit").nextSituationId], position: combo.position });
  } else if (dataset.gotoSequence) {
    // 行き先の起き攻めを隠さないよう、絞り込みと条件を外してから開く
    selectTab("sequences");
    state.sequenceCharacter = "";
    state.sequenceKind = "";
    state.sequencePosition = "";
    state.conditions = { situationId: null, drive: null, sa: null, ca: false, burnout: false, punishWindow: null };
    state.opponent.moveId = null;
    renderTabs();
    renderSequences();
    const card = document.getElementById(`sequence-${dataset.gotoSequence}`);
    card?.scrollIntoView({ block: "center" });
    card?.classList.add("flash");
    setTimeout(() => card?.classList.remove("flash"), 1200);
  } else if (dataset.routeSituation) {
    openRoute([{ situationId: Number(dataset.routeSituation) }], dataset.character);
  } else if (dataset.routeFromCard) {
    routeFromCard(dataset.routeFromCard);
  } else if (dataset.routeStep) {
    routeStep(dataset.routeStep);
  } else if (dataset.routeEnd) {
    const sequence = findSequence(Number(dataset.routeEnd));
    state.sheet.path.push({ sequenceId: sequence.id, resultKind: null });
    if (!state.sheet.character) state.sheet.character = sequence.character;
    renderSheet();
    els.sheet.querySelector(".sheet").scrollTop = 0;
  } else if (dataset.routeBack !== undefined) {
    const back = routeBack(state.sheet.path, Number(dataset.routeBack));
    if (!back?.path.length) return;
    state.sheet.path = back.path;
    renderSheet();
    if (back.sequenceId !== null) {
      const card = els.sheetBody.querySelector(`[data-route-sequence="${back.sequenceId}"]`);
      card?.scrollIntoView({ block: "center" });
      card?.focus({ preventScroll: true });
      card?.classList.add("flash");
      setTimeout(() => card?.classList.remove("flash"), 1200);
    }
  } else if (dataset.routeStart) {
    openRoute([{ situationId: Number(dataset.routeStart) }], state.sheet.character);
  } else if (dataset.routeDrill !== undefined) {
    openModal("drills", null, routeDrillPreset(state.sheet.path, sequencesById(), situationsById()));
  } else if (dataset.openRoute !== undefined) {
    const character = state.sequenceCharacter;
    const selected = state.conditions.situationId;
    if (typeof selected === "number") openRoute([{ situationId: selected }], character);
    else openSheet({ type: "routeStart", character });
  } else if (dataset.openFlow !== undefined) {
    openFlow();
  } else if (dataset.addKind) {
    closeSheet();
    openModal("sequences", null, newSequencePreset(dataset.addKind));
  } else if (dataset.manageSituations !== undefined) {
    openSheet({ type: "situations", character: currentCharacter() });
  } else if (dataset.editSituation) {
    openModal("situations", find("situations", dataset.editSituation));
  } else if (dataset.addTrigger !== undefined) {
    if (await addTrigger(document.getElementById("newTrigger"))) {
      render();
      showToast("追加しました");
    }
  } else if (dataset.addState !== undefined) {
    openModal("situations", null, { kind: "state", character: state.sheet.character || null });
  } else if (dataset.raise) {
    await raiseMastery(find("drills", dataset.raise));
  } else if (dataset.log) {
    openModal("logs", null, { drillId: Number(dataset.log) });
    els.modalTitle.textContent = `記録：${find("drills", dataset.log).title}`;
  } else if (dataset.reopen) {
    await patch("drills", find("drills", dataset.reopen), { status: "active" }, "進行中に戻しました");
  } else if (dataset.deleteLog) {
    await deleteItem("logs", Number(dataset.deleteLog), "この練習記録");
  } else if (dataset.drillFromMatch) {
    const match = find("matches", dataset.drillFromMatch);
    openModal("drills", null, { title: match.bad.split("\n")[0].slice(0, 200), detail: `vs ${match.opponent}（${match.playedOn}の振り返りから）` });
  } else if (dataset.frameRow) {
    const id = Number(dataset.frameRow);
    state.frames.open = state.frames.open === id ? null : id;
    renderFrames();
  } else if (dataset.findPunish) {
    findPunish(Number(dataset.findPunish));
  }
}

document.querySelector("main").addEventListener("click", onAction);
els.sheetBody.addEventListener("click", onAction);
els.sheetBody.addEventListener("change", (event) => {
  if (event.target.id !== "sheetCharacter") return;
  state.sheet.character = event.target.value;
  renderSheet();
});
els.sheetBody.addEventListener("keydown", (event) => {
  if (event.target.id === "newTrigger" && event.key === "Enter") {
    event.preventDefault();
    els.sheetBody.querySelector("[data-add-trigger]").click();
  }
});
els.sheetBody.addEventListener("click", (event) => {
  if (state.sheet?.type !== "flow") return;
  const stub = event.target.closest("[data-flow-stub]");
  const node = event.target.closest("[data-flow-node]");
  const pick = event.target.closest("button[data-flow-pick]");
  if (stub) {
    const [sequenceId, resultKind, opponentAction] = stub.dataset.flowStub.split("|");
    state.sheet.picking = { sequenceId: Number(sequenceId), resultKind, opponentAction: opponentAction || null };
    renderSheet();
  } else if (node) {
    state.sheet.selected = Number(node.dataset.flowNode);
    renderSheet();
  } else if (pick) setFlowNext(state.sheet.picking, Number(pick.dataset.flowPick));
  else if (event.target.closest("[data-flow-cancel]")) {
    state.sheet.picking = null;
    renderSheet();
  }
});
els.sheetBody.addEventListener("keydown", (event) => {
  if (state.sheet?.type !== "flow" || (event.key !== "Enter" && event.key !== " ")) return;
  const target = event.target.closest("[data-flow-node], [data-flow-stub]");
  if (!target) return;
  event.preventDefault();
  target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
});
els.sheetBody.addEventListener("change", (event) => {
  if (state.sheet?.type !== "flow") return;
  if (event.target.matches("[data-flow-character]")) {
    state.sheet.character = event.target.value;
    state.sheet.startSituationId = null;
    state.sheet.selected = null;
  } else if (event.target.matches("[data-flow-start]")) state.sheet.startSituationId = event.target.value === "" ? null : Number(event.target.value);
  else return;
  renderSheet();
});
els.sheetClose.addEventListener("click", closeSheet);
els.sheet.addEventListener("click", (event) => { if (event.target === els.sheet) closeSheet(); });

els.addButton.addEventListener("click", () => {
  if (!state.data) return;
  if (state.tab === "sequences") {
    if (state.sequenceKind) openModal("sequences", null, newSequencePreset(state.sequenceKind));
    else openSheet({ type: "addKind" });
  } else if (state.tab === "situations") {
    openModal("situations", null, { kind: "state", character: state.situationCharacter || currentCharacter() || null });
  } else openModal(state.tab);
});

els.formFields.addEventListener("change", (event) => {
  if (!state.editing) return;
  const { target } = event;
  if (target.closest("[data-picker]")) onPickerChange(target);
  if (target.id === "field-character") {
    const chipsEl = document.getElementById("startChips");
    if (chipsEl) renderStartChips(selectedStartChips());
    if (state.editing.resource === "sequences") prepareMoves();
  }
  syncConditional(state.editing.resource);
  refreshNotationAssist();
});
els.formFields.addEventListener("input", (event) => {
  if (event.target.id === "field-notation" || event.target.id === "field-startup") refreshNotationAssist();
  else if (event.target.id === "field-title") refreshPickers();
  else if (event.target.id === "field-character") {
    if (document.getElementById("startChips")) renderStartChips(selectedStartChips());
  }
  else if (event.target.closest("[data-picker]")) onPickerChange(event.target);
});
const notationKeyboard = createNotationKeyboard({
  read: () => document.getElementById("field-notation")?.value || "",
  write: (text) => editNotation(() => text),
});
els.formFields.addEventListener("keyup", (event) => notationKeyboard.keyup(event));
els.formFields.addEventListener("focusout", (event) => {
  if (event.target.id === "notationPreview") notationKeyboard.reset();
});
window.addEventListener("blur", () => notationKeyboard.reset());
document.addEventListener("visibilitychange", () => {
  if (document.hidden) notationKeyboard.reset();
});
els.formFields.addEventListener("keydown", (event) => {
  if (event.target.id === "notationPreview" && !els.editModal.hidden && state.editing?.resource === "sequences") {
    if (notationKeyboard.keydown(event)) event.preventDefault();
    return;
  }
  if (event.key !== "Enter") return;
  if (event.target.id === "newSituation") {
    event.preventDefault();
    els.formFields.querySelector("[data-add-situation]").click();
  } else if (event.target.closest('[data-picker="start"]')) {
    event.preventDefault();
    addStartFromPicker();
  }
});
els.formFields.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button || !state.editing) return;
  const { dataset } = button;
  if (dataset.token) editNotation((text) => appendToken(text, dataset.token));
  else if (dataset.palette === "keyboard") document.getElementById("notationPreview").focus();
  else if (dataset.fragment) editNotation((text) => appendFragment(text, dataset.fragment));
  else if (dataset.palette === "backspace") editNotation(removeLastToken);
  else if (dataset.palette === "clear") editNotation(() => "");
  else if (dataset.startId) {
    const id = Number(dataset.startId);
    const selected = selectedStartChips();
    renderStartChips(selected.includes(id) ? selected.filter((entry) => entry !== id) : [...selected, id], id);
  }
  else if (dataset.addSituation !== undefined) {
    const selected = selectedStartChips();
    const added = await addTrigger(document.getElementById("newSituation"));
    if (!added) return;
    renderStartChips([...new Set([...selected, added.id])], added.id);
  } else if (dataset.addStart !== undefined) {
    if (!addStartFromPicker()) showFormError("有利Fを入れるか、一覧から選んでください。");
  } else if (dataset.removeStart !== undefined) {
    state.editing.startRefs.splice(Number(dataset.removeStart), 1);
    renderStartStates();
  } else if (dataset.pickRename !== undefined) {
    const picker = button.closest("[data-picker]");
    const parts = pickerParts(picker);
    if (!parts.name.value) parts.name.value = newStateName(picker, pickerKey(picker));
    parts.name.hidden = false;
    parts.name.focus();
  } else if (dataset.suggestStartup) {
    document.getElementById("field-startup").value = dataset.suggestStartup;
    refreshNotationAssist();
  } else if (dataset.outcome) {
    const order = ["unknown", "win", "lose"];
    const next = order[(order.indexOf(dataset.value) + 1) % order.length];
    dataset.value = next;
    button.className = `outcome ${next}`;
    button.firstElementChild.textContent = OUTCOME_MARKS[next];
    const toggle = els.formFields.querySelector(`[data-next-toggle="${dataset.outcome}"]`);
    if (toggle) toggle.hidden = next === "unknown";
  } else if (dataset.nextToggle) {
    const box = els.formFields.querySelector(`[data-outcome-next="${dataset.nextToggle}"]`);
    box.hidden = !box.hidden;
    refreshPicker(box.querySelector("[data-picker]"));
  }
});
els.deleteConfirm.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button || !state.editing) return;
  const { item } = state.editing;
  if (button.dataset.situationCancel !== undefined) els.deleteConfirm.hidden = true;
  else if (button.dataset.situationDelete !== undefined) {
    if (await deleteItem("situations", item.id, "この状況", true)) closeModal();
  } else if (button.dataset.situationArchive !== undefined) {
    if (await patch("situations", item, { archived: true }, "アーカイブにしました")) closeModal();
  }
});
els.editForm.addEventListener("submit", submitModal);
els.modalClose.addEventListener("click", closeModal);
els.cancelButton.addEventListener("click", closeModal);
els.editModal.addEventListener("click", (event) => { if (event.target === els.editModal) closeModal(); });
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (!els.editModal.hidden) closeModal();
  else if (!els.sheet.hidden) closeSheet();
});
els.deleteButton.addEventListener("click", async () => {
  if (!state.editing?.item) return;
  const { resource, item } = state.editing;
  if (resource === "situations") {
    await confirmSituationDelete(item);
    return;
  }
  const title = resource === "sequences" ? FORMS.sequences.title(item) : FORMS[resource].title();
  if (await deleteItem(resource, item.id, `この${title}`)) closeModal();
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
const savedTab = stored("sf6-tab", "");
const initialTab = requestedTab || savedTab;
state.tab = TABS.includes(initialTab) ? initialTab : "sequences";
// 以前の「コンボ」「起き攻め」タブは、手順タブの種類の絞り込みとして引き継ぐ
const savedKind = LEGACY_TABS[initialTab] || stored("sf6-sequence-kind", "");
state.sequenceKind = savedKind in SEQUENCE_KINDS ? savedKind : "";
if (initialTab in LEGACY_TABS) state.tab = "sequences";
state.situationCharacter = stored("sf6-situation-character", "");
state.situationNear = stored("sf6-situation-near", "1") !== "0";
state.sequenceCharacter = stored("sf6-sequence-character", stored("sf6-combo-character", ""));
renderTabs();
load();
