import { escapeHtml } from "../shared/html.js";
import { notationHtml, chips, empty, percent, daysAgo, formatDay } from "./format.js";
import { TABS, KIND_ADD_LABELS, ADD_LABELS, SEQUENCE_KINDS, POSITIONS, SA_LEVELS, END_PURPOSES, OPPONENT_LABELS, OUTCOME_MARKS, RECOVERIES, AIMS, LAYERINGS, GUARD_SETTINGS, COUNTER_SETTINGS, RECOVERY_SETTINGS, RESULTS, MODES } from "./constants.js";
// 手順・状況・練習・振り返りの表示と絞り込み。
import { MASTERY, resultOf, setplaysAfter, stateFit, stateLabel, usableNow, sortSequences, OPPONENT_OPTIONS, leadsInto, bestStreakOf, raiseTargets, STREAK_GOAL, sequencesFrom, situationUsage } from "../sf6-plan.js";

export function createSf6Records({ state, els, situationsById, resultLabel, situationText, activeDrillFor, renderPunishPicker, findSequence }) {
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
      stats.last ? `最終 ${daysAgo(stats.last, state.data?.today)}` : "まだ記録なし",
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

  return { charactersIn, renderTabs, conditionSummaryText, situationOptionsHtml, byAdvantage, renderSequences, outcomesHtml, startStatesOf, renderDrills, renderSituations, renderMatches };
}
