import { createSf6State, sf6Elements } from "./sf6/state.js";
import { sf6Request } from "./sf6/api.js";
import { stored, errorMessage, store, options } from "./sf6/format.js";
import { OPPONENT_LABELS, RESULT_LABELS, CHARACTERS, TABS, OUTCOME_MARKS, DRIVE_STEPS, LEGACY_TABS, SEQUENCE_KINDS } from "./sf6/constants.js";
import { escapeHtml } from "./shared/html.js";
import { createSf6Records } from "./sf6/records.js";
import { createSf6Frames } from "./sf6/frames.js";
import { createSf6Routes } from "./sf6/routes.js";
import { createSf6Editor } from "./sf6/editor.js";
import { appendFragment, appendToken, removeLastToken } from "./sf6-notation.js";
import { createNotationKeyboard } from "./sf6-keyboard.js";
import { drillPreset, MASTERY, raiseTargets, resultOf, routeBack, routeDrillPreset, stateLabel } from "./sf6-plan.js";

const state = createSf6State();
const els = sf6Elements(document);


let toastTimer;
function showToast(message) {
  clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.hidden = false;
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, 3000);
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
    const payload = await sf6Request("/api/sf6", { headers: { Accept: "application/json" }, cache: "no-store" }, (payload) => new Error(errorMessage(payload, "読み込みに失敗しました。")));
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
  const payload = await sf6Request(`/api/sf6/${resource}`, {
    method,
    headers: { "Content-Type": "application/json", Accept: "application/json", "X-Dashboard-Action": "sf6" },
    body: JSON.stringify(body),
  }, (payload) => new Error(errorMessage(payload, "保存できませんでした。")));
  return payload;
}

/** 1キャラの技データを読む（キャラごとに1回）。登録のないキャラは null。 */
async function ensureMoves(character) {
  if (!character || !state.data?.moveSets.some((set) => set.character === character)) return null;
  if (state.moves.has(character)) return state.moves.get(character);
  const payload = await sf6Request(`/api/sf6/moves?character=${encodeURIComponent(character)}`, { headers: { Accept: "application/json" }, cache: "no-store" }, (payload) => new Error(errorMessage(payload, "技データを読み込めませんでした。")));
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

const { charactersIn, renderTabs, conditionSummaryText, situationOptionsHtml, byAdvantage, renderSequences, outcomesHtml, startStatesOf, renderDrills, renderSituations, renderMatches } = createSf6Records({
  state,
  els,
  situationsById: (...args) => situationsById(...args),
  resultLabel: (...args) => resultLabel(...args),
  situationText: (...args) => situationText(...args),
  activeDrillFor: (...args) => activeDrillFor(...args),
  renderPunishPicker: (...args) => renderPunishPicker(...args),
  findSequence: (...args) => findSequence(...args)
});

const { WIDE_FRAMES, renderPunishPicker, loadOpponentMoves, applyOpponentMove, loadFrames, renderFrames, findPunish } = createSf6Frames({
  state,
  els,
  movesOf: (...args) => movesOf(...args),
  ensureMoves: (...args) => ensureMoves(...args),
  renderTabs: (...args) => renderTabs(...args),
  renderSequences: (...args) => renderSequences(...args),
  selectTab: (...args) => selectTab(...args)
});

const { openSheet, openFlow, setFlowNext, newSequencePreset, closeSheet, renderSheet, openRoute, addTrigger } = createSf6Routes({
  state,
  els,
  resultLabel: (...args) => resultLabel(...args),
  charactersIn: (...args) => charactersIn(...args),
  situationText: (...args) => situationText(...args),
  situationsById: (...args) => situationsById(...args),
  findSequence: (...args) => findSequence(...args),
  situationOptionsHtml: (...args) => situationOptionsHtml(...args),
  byAdvantage: (...args) => byAdvantage(...args),
  patch: (...args) => patch(...args),
  startStatesOf: (...args) => startStatesOf(...args),
  outcomesHtml: (...args) => outcomesHtml(...args),
  sequencesById: (...args) => sequencesById(...args),
  conditionSummaryText: (...args) => conditionSummaryText(...args),
  send: (...args) => send(...args),
  replaceItem: (...args) => replaceItem(...args),
  showToast: (...args) => showToast(...args)
});

const { FORMS, renderStartChips, selectedStartChips, pickerParts, pickerKey, newStateName, refreshPicker, refreshPickers, onPickerChange, addStartFromPicker, renderStartStates, syncConditional, refreshNotationAssist, editNotation, prepareMoves, openModal, closeModal, showFormError, submitModal, deleteItem, confirmSituationDelete } = createSf6Editor({
  state,
  situationText: (...args) => situationText(...args),
  els,
  findSituation: (...args) => findSituation(...args),
  byAdvantage: (...args) => byAdvantage(...args),
  situationOptionsHtml: (...args) => situationOptionsHtml(...args),
  movesOf: (...args) => movesOf(...args),
  findSequence: (...args) => findSequence(...args),
  ensureMoves: (...args) => ensureMoves(...args),
  getNotationKeyboard: () => notationKeyboard,
  send: (...args) => send(...args),
  applySaved: (...args) => applySaved(...args),
  render: (...args) => render(...args),
  showToast: (...args) => showToast(...args),
  load: (...args) => load(...args),
  removeItem: (...args) => removeItem(...args)
});

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
