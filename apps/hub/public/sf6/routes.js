import { escapeHtml } from "../shared/html.js";
import { stored, notationHtml, options, empty } from "./format.js";
import { OUTCOME_MARKS } from "./constants.js";
// 手順のルート・フローチャート・状況管理に使うシート。
import { exitsOf, buildFlow } from "../sf6-graph.js";
import { sequencesFrom, usableNow, situationUsage, stateLabel } from "../sf6-plan.js";

export function createSf6Routes({ state, els, resultLabel, charactersIn, situationText, situationsById, findSequence, situationOptionsHtml, byAdvantage, patch, startStatesOf, outcomesHtml, sequencesById, conditionSummaryText, send, replaceItem, showToast }) {
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

  /** 始点の状況を渡すと、その状況（とキャラ）からのフローチャートを開く。 */
  function openFlow(from = null) {
    const characters = charactersIn(state.data.sequences, "character");
    const wanted = from?.character || state.sequenceCharacter || stored("sf6-character", "");
    const { situationId } = state.conditions;
    openSheet({
      type: "flow",
      character: characters.includes(wanted) ? wanted : characters[0] || "",
      startSituationId: from ? from.situationId : typeof situationId === "number" ? situationId : null,
      near: false,
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
    const nodes = flow.nodes.map((node) => `<g class="flow-node${node.id === selected ? " selected" : ""}" data-flow-node="${node.id}" tabindex="0" role="button">
        <rect x="${node.x}" y="${node.y}" width="${node.w}" height="${node.h}" rx="8" />
        <text class="kind" x="${node.x + 10}" y="${node.y + 18}">${escapeHtml(clip(node.startLabel, 16))}${node.loop ? " ↻" : ""}</text>
        <text class="title" x="${node.x + 10}" y="${node.y + 38}">${escapeHtml(clip(node.title, FLOW_TITLE_MAX))}</text>
        <title>${escapeHtml(node.title)}</title>
      </g>`).join("");
    return `<div class="flow-scroll"><svg class="flow-svg" width="${flow.width}" height="${flow.height}" viewBox="0 0 ${flow.width} ${flow.height}" role="group" aria-label="手順のフローチャート">
      <defs><marker id="flowArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" /></marker></defs>
      ${edges}${stubs}${nodes}</svg></div>`;
  }

  /** 選んだ手順の前後のステップ。前後の手順へ移ったり、末端（続きの手順がない出口）から手順を足したりできる。 */
  function flowDetailHtml(sequence, flow) {
    const byId = situationsById();
    const titles = new Map(state.data.sequences.map((entry) => [entry.id, entry.title]));
    const gotoChip = (id, text, near) => `<button type="button" class="next-chip${near ? " near" : ""}" data-flow-goto="${id}">${escapeHtml(text)}</button>`;
    const before = [...new Map(flow.edges.filter((edge) => edge.to === sequence.id && edge.from !== sequence.id)
      .map((edge) => [edge.from, edge])).values()];
    const exits = exitsOf(sequence).map((exit) => {
      const next = byId.get(exit.nextSituationId);
      const ref = `${sequence.id}|${exit.kind}|${exit.opponentAction || ""}`;
      const followers = flow.edges.filter((edge) => edge.from === sequence.id && edge.resultKind === exit.kind
        && (edge.opponentAction || "") === (exit.opponentAction || ""));
      let tail = "";
      if (!next) tail = `<button type="button" class="ghost-button" data-flow-stub="${ref}">次の状況を選ぶ</button>`;
      else tail = `<span class="next-row">${followers.map((edge) => gotoChip(edge.to, titles.get(edge.to) || "", edge.fit === "near")).join("")}<button type="button" class="ghost-button" data-add-from-situation="${next.id}">＋パーツ</button><button type="button" class="ghost-button" data-flow-stub="${ref}">状況を変える</button></span>`;
      return `<li><b>${escapeHtml(flowLabel(exit))}</b> → ${next ? escapeHtml(situationText(next)) : '<span class="unset">未設定</span>'} ${tail}</li>`;
    }).join("");
    return `<article class="card flow-detail">
      <div class="card-head"><h3>${escapeHtml(sequence.title)}</h3>
        <button type="button" class="ghost-button" data-edit="sequences" data-id="${sequence.id}">編集</button></div>
      ${notationHtml(sequence.notation)}
      <p class="flow-step"><small class="meta">前</small> ${before.length ? before.map((edge) => gotoChip(edge.from, titles.get(edge.from) || "", edge.fit === "near")).join("") : '<small class="meta">始点</small>'}</p>
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
      startSituationId: sheet.startSituationId, includeNear: sheet.near, resultLabel: flowLabel,
    });
    const selected = findSequence(sheet.selected);
    els.sheetBody.innerHTML = `
      <div class="flow-controls">
        <select data-flow-character aria-label="キャラ">${options(Object.fromEntries(characters.map((name) => [name, name])), sheet.character)}</select>
        <select data-flow-start aria-label="始点の状況"><option value="">始点：すべて</option>${situationOptionsHtml([
          ["きっかけ", starts.filter((situation) => situation.kind === "trigger")],
          ["局面", starts.filter((situation) => situation.kind === "state").sort(byAdvantage)],
        ], sheet.startSituationId)}</select>
        <button type="button" class="toggle-chip" data-flow-near aria-pressed="${sheet.near}" title="有利Fが1〜2Fずれる手順（点線の矢印）の表示を切り替えます">近い手順</button>
        <button type="button" class="secondary-button small" data-flow-add>＋パーツを追加</button>
      </div>
      ${flow.nodes.length
        ? `<p class="flow-note">${flow.unsetCount ? `次が未設定の出口が${flow.unsetCount}件あります。点線の枠を押すと、次の状況を選べます。` : "未設定の出口はありません。"}</p>${flowSvg(flow, selected?.id)}${selected ? "" : '<p class="flow-note">箱を押すと、前後のパーツへ移ったり、出口から次のパーツを追加したりできます。</p>'}`
        : empty(sheet.character ? "このキャラ・始点から辿れるパーツはありません。上の「＋パーツを追加」で作れます" : "パーツがまだありません。上の「＋パーツを追加」で作れます")}
      ${selected && flow.nodes.some((node) => node.id === selected.id) ? flowDetailHtml(selected, flow) : ""}`;
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

  /** 絞り込み中のキャラ・状況を引き継いだ、新しいコンボパーツの初期値。 */
  function newSequencePreset() {
    const { situationId } = state.conditions;
    return {
      ...(state.sequenceCharacter ? { character: state.sequenceCharacter } : {}),
      starts: typeof situationId === "number" && situationsById().has(situationId) ? [situationId] : [],
    };
  }

  /** 状況タブやフローの出口から、その状況を起点にしたコンボパーツを追加するときの初期値。 */
  function situationSequencePreset(situation) {
    return {
      character: situation.character,
      starts: [situation.id],
      ...(situation.position !== "anywhere" ? { position: situation.position } : {}),
    };
  }

  function closeSheet() {
    els.sheet.hidden = true;
    state.sheet = null;
  }

  function renderSheet() {
    const { type } = state.sheet;
    if (type === "route") renderRoute();
    else if (type === "routeStart") renderRouteStart();
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
      ${outcomesHtml(sequence, starts.some((situation) => situation.recovery === "back_roll"))}
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

  return { openSheet, openFlow, setFlowNext, newSequencePreset, situationSequencePreset, closeSheet, renderSheet, openRoute, addTrigger };
}
