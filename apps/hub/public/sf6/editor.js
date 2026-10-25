import { escapeHtml } from "../shared/html.js";
import { stored, chips, options, paletteHtml, notationHtml, store } from "./format.js";
import { DRIVE_STEPS, SA_LEVELS, POSITIONS, LAYERINGS, SITUATION_KINDS, RECOVERIES, GUARD_SETTINGS, COUNTER_SETTINGS, RECOVERY_SETTINGS, MODES, RESULTS, OUTCOME_MARKS, OPPONENT_LABELS, HIT_TYPE_LABELS } from "./constants.js";
// 共通モーダルでの手順・状況・練習の入力と保存。
import { MASTERY, STREAK_GOAL, stateLabel, findState, OPPONENT_OPTIONS, defaultTitle, situationUsage } from "../sf6-plan.js";
import { defaultStateName, starterMove } from "../sf6-frames.js";
import { frequentFragments } from "../sf6-notation.js";
import { readSf6TextValue } from "./text.js";

export function createSf6Editor({ state, situationText, els, findSituation, byAdvantage, situationOptionsHtml, movesOf, findSequence, ensureMoves, getNotationKeyboard, send, applySaved, render, showToast, load, removeItem, inboxFlow }) {
  // ---------- 編集モーダル ----------

  const MASTERY_OPTIONS = Object.fromEntries(MASTERY.map((label, level) => [level, label]));

  const FRAME_HINT = "トレモのフレームメーターで、相手が起き上がって動けるまでに自分が先に動けるF";

  /**
   * more: 「任意項目」の折りたたみに入れる。
   * editOnly / addOnly: 編集のときだけ / 追加のときだけ出す。
   */
  const FORMS = {
    sequences: {
      title: () => "コンボパーツ",
      fields: [
        { key: "character", label: "キャラ", type: "character", required: true },
        { key: "title", label: "名前", type: "text", max: 120, placeholder: "空欄ならレシピから付けます" },
        { key: "starts", label: "始動の状況", type: "startStates", required: true },
        { key: "notation", label: "レシピ", type: "notation", max: 1000, required: true, moves: true },
        { key: "resultHitNormal", label: "通常ヒットしたら", type: "next", resultKind: "hit" },
        { key: "resultCounter", label: "カウンターヒットしたら", type: "next", resultKind: "counter_hit", hint: "有利Fは通常ヒット+2Fを自動で入れます（直せます）" },
        { key: "resultPunish", label: "パニッシュカウンターしたら", type: "next", resultKind: "punish_counter", hint: "有利Fは通常ヒット+4Fを自動で入れます（直せます）" },
        { key: "resultGuardSetplay", label: "ガードされたら", type: "next", resultKind: "guard", hint: "レシピの最後の技がガードされたときの次の状況" },
        { key: "outcomes", label: "相手の行動ごとの結果", type: "outcomes", hint: "押すたびに ○（こちらが勝つ）→ ×（負ける）→ –（未確認）。→ で、どのヒットになるか・次の状況を選べます" },
        { key: "resultOther", label: "その他のヒットしたら", type: "next", resultKind: "hit_other", more: true, hint: "ジャンプを対空で落とすなど特殊な条件のヒット。有利F・ダウン・位置・名前を自由に決めます" },
        { key: "startup", label: "発生F", type: "number", min: 1, max: 99, nullable: true, half: true, more: true, suggest: true },
        { key: "driveCost", label: "Dゲージ", type: "select", options: DRIVE_STEPS, numeric: true, half: true, more: true },
        { key: "saCost", label: "SA", type: "select", options: SA_LEVELS, numeric: true, half: true, more: true },
        { key: "position", label: "位置", type: "select", options: POSITIONS, more: true },
        { key: "layering", label: "重ね方", type: "select", options: { "": "未設定", ...LAYERINGS }, more: true },
        { key: "mastery", label: "習得度", type: "select", options: MASTERY_OPTIONS, numeric: true, more: true },
        { key: "memo", label: "メモ", type: "textarea", max: 2000, rows: 2, preserveWhitespace: true, placeholder: "コツ・ヒット確認やタイミングの目安など", more: true },
        { key: "archived", label: "アーカイブ（一覧から隠す）", type: "checkbox", editOnly: true, more: true },
      ],
      defaults: () => ({
        character: stored("sf6-character", ""), title: "", notation: "", startup: null,
        driveCost: 0, saCost: 0, position: "anywhere", layering: null,
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
        { key: "throwRange", label: "通常投げ間合い", type: "checkbox", showIf: (values) => values.kind === "state" },
        { key: "memo", label: "メモ", type: "textarea", max: 2000, rows: 2, preserveWhitespace: true },
        { key: "archived", label: "アーカイブ（一覧から隠す）", type: "checkbox", editOnly: true },
      ],
      defaults: () => ({ character: null, kind: "trigger", name: "", advantage: null, position: "anywhere", recovery: null, throwRange: false, memo: null, archived: false }),
    },
    drills: {
      title: () => "練習メニュー",
      fields: [
        { key: "title", label: "練習すること", type: "text", max: 200, required: true, placeholder: "例：中足ラッシュをヒット確認" },
        { key: "detail", label: "やり方・目標", type: "textarea", max: 2000, rows: 2, preserveWhitespace: true, placeholder: "例：ランダムガードで10回連続" },
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
      && !(field.editOnly && !isEdit) && !(field.addOnly && isEdit)
      && !(state.editing?.inboxSource && resource === "situations" && field.key === "kind"));
  }

  function formCharacter() {
    return document.getElementById("field-character")?.value.trim() || state.editing?.values.character || "";
  }

  function formPosition() {
    return document.getElementById("field-position")?.value || "anywhere";
  }

  // --- 局面ピッカー（ヒット・ガード・相手の行動の次の状況、起き攻めの起点） ---

  function refName(ref) {
    if (typeof ref === "number") return situationText(findSituation(ref)) || "削除された状況";
    return ref.state.name || stateLabel({ kind: "state", ...ref.state });
  }

  /**
   * config.allowPosition: 位置を選べる（起き攻めの起点）。ほかは手順の「位置」を使う。
   * config.withTriggers: 一覧にきっかけも出す。config.add: 「追加」ボタンを置く（起点を複数選ぶとき）。
   * config.kind: 結果の種類（結果ごとに次の状況を複数持てるので、同じ種類のピッカーをまとめて読む）。
   * config.defaultPosition: 新しい局面の位置の初期値（結果の次の状況は、手順の位置から始める）。
   */
  function pickerHtml(key, ref, config = {}) {
    const situation = typeof ref === "number" ? findSituation(ref) : null;
    const numbers = situation?.kind === "state" ? situation : ref && typeof ref === "object" ? ref.state : null;
    const character = formCharacter();
    const states = state.data.situations.filter((entry) => entry.kind === "state" && entry.character === character
      && (!entry.archived || entry.id === situation?.id)).sort(byAdvantage);
    const triggers = config.withTriggers ? state.data.situations.filter((entry) => entry.kind === "trigger"
      && (entry.character === null || entry.character === character) && (!entry.archived || entry.id === situation?.id)) : [];
    return `<div class="picker" data-picker="${escapeHtml(key)}"${config.kind ? ` data-picker-kind="${escapeHtml(config.kind)}"` : ""}${config.allowPosition ? " data-allow-position" : ""}${key === "hit" && numbers ? ` data-last-adv="${escapeHtml(numbers.advantage)}"` : ""}>
      <div class="picker-row">
        <label class="picker-num"><span>有利F</span><input type="number" inputmode="numeric" data-pick="advantage" min="-99" max="300" step="1" value="${numbers ? escapeHtml(numbers.advantage) : ""}" placeholder="例：29" /></label>
        <label><span>ダウン</span><select data-pick="recovery">${options({ "": "未設定", ...RECOVERIES }, numbers?.recovery || "")}</select></label>
        ${config.allowPosition ? `<label><span>位置</span><select data-pick="position">${options(POSITIONS, numbers?.position || config.defaultPosition || "anywhere")}</select></label>` : ""}
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
    if (picker.dataset.picker !== "hit" && target === parts.advantage) delete picker.dataset.auto;
    refreshPicker(picker);
    if (picker.dataset.picker === "hit" && (target === parts.list || target === parts.advantage)) linkHitAdvantages(picker);
  }

  /** カウンターヒット・パニッシュカウンターの有利Fは、通常ヒットの有利Fに連動する（手で直したものは動かさない）。 */
  const LINKED_HITS = { counter_hit: 2, punish_counter: 4 };

  function linkHitAdvantages(normal) {
    const value = pickerParts(normal).advantage.value;
    const now = value !== "" && Number.isInteger(Number(value)) ? Number(value) : null;
    const before = normal.dataset.lastAdv === undefined || normal.dataset.lastAdv === "" ? null : Number(normal.dataset.lastAdv);
    normal.dataset.lastAdv = now === null ? "" : String(now);
    for (const [kind, delta] of Object.entries(LINKED_HITS)) {
      const picker = els.formFields.querySelector(`[data-picker="${kind}"]`);
      if (!picker) continue;
      const parts = pickerParts(picker);
      if (parts.list.value) continue;
      const current = parts.advantage.value;
      const follows = current === "" || picker.dataset.auto === "1" || (before !== null && Number(current) === before + delta);
      if (!follows) continue;
      parts.advantage.value = now === null ? "" : String(now + delta);
      if (now === null) delete picker.dataset.auto; else picker.dataset.auto = "1";
      refreshPicker(picker);
    }
  }

  // --- 始動の状況（きっかけ・局面を複数） ---

  /** 同じキャラのきっかけ（確定反撃・ヒット確認など）を、押すだけで始動に足す・外すボタン。 */
  function startTriggerChipsHtml() {
    const character = formCharacter();
    const chosen = new Set(state.editing.startRefs.filter((ref) => typeof ref === "number"));
    return state.data.situations.filter((situation) => situation.kind === "trigger" && !situation.archived
      && (situation.character === null || situation.character === character))
      .map((situation) => `<button type="button" class="toggle-chip" data-start-trigger="${situation.id}" aria-pressed="${chosen.has(situation.id)}">${escapeHtml(situation.name)}</button>`).join("");
  }

  function toggleStartTrigger(id) {
    const refs = state.editing.startRefs;
    const index = refs.indexOf(id);
    if (index >= 0) refs.splice(index, 1); else refs.push(id);
    renderStartStates();
  }

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
    picker.outerHTML = pickerHtml("start", null, { allowPosition: true, withTriggers: true, add: true });
    renderStartStates();
    return true;
  }

  function renderStartStates() {
    const chipsEl = document.getElementById("startStateChips");
    if (chipsEl) chipsEl.innerHTML = startStateChipsHtml(state.editing.startRefs);
    const triggerEl = document.getElementById("startTriggerChips");
    if (triggerEl) triggerEl.innerHTML = startTriggerChipsHtml();
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
    const byAction = {};
    for (const result of results.filter((entry) => entry.kind === "opponent")) byAction[result.opponentAction] ??= result;
    const buttons = OPPONENT_OPTIONS.map((action) => {
      const value = byAction[action]?.outcome || "unknown";
      return `<span class="outcome-item" data-outcome-item="${action}">
        <button type="button" class="outcome ${value}" data-outcome="${action}" data-value="${value}"><b>${OUTCOME_MARKS[value]}</b>${escapeHtml(OPPONENT_LABELS[action])}</button>
        <button type="button" class="next-toggle" data-next-toggle="${action}" aria-label="${escapeHtml(OPPONENT_LABELS[action])}の次の状況"${value === "unknown" ? " hidden" : ""}>→</button>
      </span>`;
    }).join("");
    const nexts = OPPONENT_OPTIONS.map((action) => {
      const next = byAction[action]?.nextSituationId ?? byAction[action]?.next ?? null;
      // 昔の入力（ヒットの種類なし）は、次の状況があれば「その他」として扱う
      const hitType = byAction[action]?.hitType || (next === null ? "" : "other");
      const types = Object.entries(HIT_TYPE_LABELS).map(([type, label]) =>
        `<button type="button" class="toggle-chip" data-hit-type="${action}|${type}" aria-pressed="${type === hitType}">${escapeHtml(label)}</button>`).join("");
      return `<div class="outcome-next" data-outcome-next="${action}" data-hit-selected="${hitType}"${next === null && !hitType ? " hidden" : ""}>
        <span class="field-label">${escapeHtml(OPPONENT_LABELS[action])}のあと</span>
        <div class="chip-scroll" role="group" aria-label="${escapeHtml(OPPONENT_LABELS[action])}のヒットの種類">${types}</div>
        <p class="picker-match" data-hit-note>${hitTypeNote(hitType)}</p>
        <div data-outcome-picker${hitType === "other" ? "" : " hidden"}>${pickerHtml(`opponent:${action}`, next, { withTriggers: true })}</div>
      </div>`;
    }).join("");
    return `<div class="chip-field" data-field="${field.key}">
      <span class="field-label">${escapeHtml(field.label)}</span><small class="field-hint">${escapeHtml(field.hint)}</small>
      <div class="outcome-buttons">${buttons}</div>
      ${nexts}
    </div>`;
  }

  /** 通常・カウンター・パニカンは、上の同名の結果の状況を使う。その他だけ個別に決める。 */
  function hitTypeNote(type) {
    return type && type !== "other" ? `→ 上の「${escapeHtml(HIT_TYPE_LABELS[type])}」の状況を使います` : "";
  }

  function selectHitType(value) {
    const [action, type] = value.split("|");
    const box = els.formFields.querySelector(`[data-outcome-next="${action}"]`);
    box.dataset.hitSelected = box.dataset.hitSelected === type ? "" : type;
    const selected = box.dataset.hitSelected;
    box.querySelectorAll("[data-hit-type]").forEach((chip) => chip.setAttribute("aria-pressed", String(chip.dataset.hitType.endsWith(`|${selected}`) && selected !== "")));
    box.querySelector("[data-hit-note]").innerHTML = hitTypeNote(selected);
    box.querySelector("[data-outcome-picker]").hidden = selected !== "other";
    if (selected === "other") refreshPicker(box.querySelector("[data-picker]"));
  }

  /** 同じ種類の結果の次の状況をすべて（画面中央版・画面端版など、複数持てる）。 */
  function resultNexts(results, kind) {
    return results.filter((entry) => entry.kind === kind).map((entry) => entry.nextSituationId ?? entry.next ?? null).filter((next) => next !== null);
  }

  let nextOptionSeq = 0;

  /** 結果の次の状況の選択肢1つ。2つ目からは「×」で外せる。位置は選択肢ごとに選べる。 */
  function nextOptionHtml(kind, ref, index) {
    const key = index === 0 ? kind : `${kind}#${++nextOptionSeq}`;
    return `<div class="next-option">${pickerHtml(key, ref, { withTriggers: true, allowPosition: true, defaultPosition: formPosition(), kind })}${index === 0 ? "" : '<button type="button" class="chip-remove" data-next-remove aria-label="この選択肢を外す">×</button>'}</div>`;
  }

  function addNextOption(kind) {
    const box = els.formFields.querySelector(`[data-next-kind="${kind}"]`);
    if (!box) return;
    box.insertAdjacentHTML("beforeend", nextOptionHtml(kind, null, box.children.length || 1));
    box.lastElementChild.querySelector("[data-pick=\"advantage\"]")?.focus();
  }

  function removeNextOption(button) {
    button.closest(".next-option")?.remove();
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
        return `<label class="check-field" data-field="${field.key}"${showIf}><input type="checkbox" id="${id}"${value ? " checked" : ""} /><span>${escapeHtml(field.label)}</span></label>`;
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
      case "startStates":
        return `<div class="chip-field" data-field="${field.key}">
          <span class="field-label">${escapeHtml(field.label)} <b>必須</b></span>
          <div class="toggle-chips" id="startStateChips">${startStateChipsHtml(state.editing.startRefs)}</div>
          <div class="toggle-chips" id="startTriggerChips">${startTriggerChipsHtml()}</div>
          ${pickerHtml("start", null, { allowPosition: true, withTriggers: true, add: true })}
        </div>`;
      case "next": {
        const refs = resultNexts(values.results, field.resultKind);
        return `<div class="chip-field" data-field="${field.key}">
          <span class="field-label">${escapeHtml(field.label)}</span>${field.hint ? `<small class="field-hint">${escapeHtml(field.hint)}</small>` : ""}
          <div class="next-multi" data-next-kind="${field.resultKind}">${(refs.length ? refs : [null]).map((ref, index) => nextOptionHtml(field.resultKind, ref, index)).join("")}</div>
          <button type="button" class="ghost-button small" data-next-add="${field.resultKind}">＋選択肢を足す（画面端版など）</button>
        </div>`;
      }
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
        const list = state.data.sequences.filter((sequence) => !sequence.archived || sequence.id === selected);
        return `<label data-field="${field.key}">${label}<select id="${id}"><option value="">なし</option>${list.map(option).join("")}</select></label>`;
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
  /** 種類ごとの次の状況の選択肢を読む（同じ状況の重複は1つにまとめる）。欄が出ていなければ、元の値のまま。 */
  function nextsOf(kind, base) {
    const pickers = [...els.formFields.querySelectorAll(`[data-picker-kind="${kind}"]`)];
    const refs = pickers.length ? pickers.map(readPicker).filter((ref) => ref !== null) : resultNexts(base.results, kind);
    return refs.filter((ref, index) => refs.findIndex((other) => sameRef(other, ref)) === index);
  }

  function readResults(base) {
    const results = [];
    for (const kind of ["hit", "counter_hit", "punish_counter", "hit_other", "guard"]) {
      for (const next of nextsOf(kind, base)) results.push({ kind, next });
    }
    const buttons = [...els.formFields.querySelectorAll("[data-outcome]")];
    if (!buttons.length) {
      base.results.filter((result) => result.kind === "opponent").forEach((result) => results.push({
        kind: "opponent", opponentAction: result.opponentAction, outcome: result.outcome, hitType: result.hitType ?? null, next: result.nextSituationId ?? result.next ?? null,
      }));
      return results;
    }
    for (const button of buttons) {
      const action = button.dataset.outcome;
      if (button.closest("[data-outcome-item]")?.hidden) continue;
      const box = els.formFields.querySelector(`[data-outcome-next="${action}"]`);
      const hitType = box && !box.hidden ? box.dataset.hitSelected || null : null;
      // 通常・カウンター・パニカンは、上の同名の結果の次の状況（複数）をそのまま使う。その他だけ個別の1つ
      const nexts = hitType === "other" ? [readPicker(box.querySelector("[data-picker]"))].filter((next) => next !== null)
        : hitType ? nextsOf(hitType, base) : [];
      for (const next of nexts.length ? nexts : [null]) {
        if (button.dataset.value !== "unknown" || next !== null) results.push({ kind: "opponent", opponentAction: action, outcome: button.dataset.value, hitType, next });
      }
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
      else values[field.key] = readSf6TextValue(input.value, base[field.key], field.preserveWhitespace);
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

  function openModal(resource, item = null, preset = {}, inboxSource = null) {
    const form = FORMS[resource];
    const values = item ? { ...item } : { ...form.defaults(preset), ...preset };
    state.editing = { resource, item, values, startRefs: [...(values.starts || [])], inboxSource };
    els.modalTitle.textContent = `${form.title(values)}を${item ? "編集" : "追加"}`;
    const fields = visibleFields(resource, values, Boolean(item));
    const isMore = (field) => field.more;
    const main = fields.filter((field) => !isMore(field)).map((field) => fieldHtml(field, values[field.key], values)).join("");
    const more = fields.filter(isMore).map((field) => fieldHtml(field, values[field.key], values)).join("");
    els.formFields.innerHTML = `${main}${more ? `<details class="form-more"><summary>任意項目</summary><div class="form-grid">${more}</div></details>` : ""}`;
    fields.filter((field) => field.preserveWhitespace).forEach((field) => {
      const input = document.getElementById(`field-${field.key}`);
      if (input) input.value = values[field.key] || "";
    });
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
    inboxFlow?.onOpened(state.editing);
    const first = els.formFields.querySelector("input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=date]), textarea");
    // スマホで勝手にキーボードが開かないよう、フォーカスはPC幅のときだけ
    if (first && window.matchMedia("(min-width: 681px)").matches) first.focus();
  }

  function closeModal(force = false) {
    if (state.saving && force !== true) return;
    getNotationKeyboard().reset();
    els.editModal.hidden = true;
    state.editing = null;
  }

  function readDraft() {
    return readForm(state.editing.resource, state.editing.values);
  }

  function validate(resource, values) {
    for (const field of visibleFields(resource, state.editing.values, Boolean(state.editing.item))) {
      const wrapper = els.formFields.querySelector(`[data-show-if="${field.key}"]`);
      if (wrapper?.hidden) continue;
      const value = values[field.key];
      if (typeof value === "string" && field.max && [...value].length > field.max) {
        return `「${field.label}」は${field.max}文字以内にしてください。元Inboxの全文は元記録に残ります。`;
      }
      if (field.required && (value === null || value === "" || (Array.isArray(value) && value.length === 0))) {
        if (field.type === "startStates") return "始動の状況を1つ以上選んでください（きっかけを押すか、下で有利Fを入れて「追加」）。";
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
    }
    if (resource === "situations" && values.kind === "trigger") Object.assign(values, { advantage: null, recovery: null, position: "anywhere", throwRange: false });
  }

  function showFormError(message) {
    els.formError.textContent = message;
    els.formError.hidden = false;
  }

  async function submitModal(event) {
    event.preventDefault();
    if (!state.editing || state.saving) return;
    const { resource, item, inboxSource } = state.editing;
    if (resource === "sequences") addStartFromPicker();
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
    els.cancelButton.disabled = true;
    els.modalClose.disabled = true;
    els.inboxContext?.querySelectorAll("select").forEach((select) => { select.disabled = true; });
    try {
      if (inboxSource && !item) {
        await inboxFlow.save(resource, fields, inboxSource);
        return;
      }
      const saved = item
        ? await send("PATCH", resource, { id: item.id, updatedAt: item.updatedAt, ...fields })
        : await send("POST", resource, fields);
      if (resource === "logs") {
        state.data.logs.unshift(saved);
        state.data.logs.sort((a, b) => b.practicedOn.localeCompare(a.practicedOn) || b.id - a.id);
      } else applySaved(resource, saved);
      if (resource === "sequences" && fields.character) store("sf6-character", fields.character);
      if (resource === "matches") store("sf6-character", fields.myCharacter);
      closeModal(true);
      render();
      showToast(item ? "保存しました" : "追加しました");
    } catch (error) {
      showFormError(error instanceof Error ? error.message : "保存できませんでした。");
    } finally {
      state.saving = false;
      els.saveButton.disabled = false;
      els.cancelButton.disabled = false;
      els.modalClose.disabled = false;
      els.inboxContext?.querySelectorAll("select").forEach((select) => { select.disabled = false; });
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

  return { addNextOption, removeNextOption, selectHitType, toggleStartTrigger, startTriggerChipsHtml, FORMS, renderStartStates, pickerParts, pickerKey, newStateName, refreshPicker, refreshPickers, onPickerChange, addStartFromPicker, renderStartStates, syncConditional, refreshNotationAssist, editNotation, prepareMoves, openModal, closeModal, readDraft, showFormError, submitModal, deleteItem, confirmSituationDelete };
}
