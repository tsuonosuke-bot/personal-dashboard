// SF6の「状況 → 手順 → 状況」の判定。今の条件で使える手順、局面どうしのつながり、ルートの練習、習得度の上げ方。
// 状況（sf6_situations）と手順（sf6_sequences）はAPIの形（camelCase）のまま受け取る。DOMに触れないのでテストから直接読める。

/** 習得度の4段階。3段階目は「ランダム設定で10回連続」で判定する。 */
export const MASTERY = ["未練習", "練習中", "ランダムで10連続", "実戦で出せる"];
export const STREAK_GOAL = 10;
/** 有利Fがこれ以内のずれなら「近い局面」としてつなげて見せる。 */
export const NEAR_FRAMES = 2;
/** 判定に使う初期の状況。名前は変えられるので preset_key で見る。 */
export const PRESET = { punish: "punish", hitConfirm: "hit_confirm", counter: "counter", punishCounter: "punish_counter" };
/** 起き攻めに対して相手が取れる行動（表示名は sf6.js）。 */
export const OPPONENT_OPTIONS = ["reversal", "backdash", "jump", "tech", "delay_tech", "parry", "drive_reversal", "back_roll"];

const POSITION_LABELS = { midscreen: "画面中央", corner: "画面端" };
const RECOVERY_LABELS = { back_roll: "後ろ受け身可", no_back_roll: "後ろ受け身不可", none: "ダウンなし" };
const FIT_ORDER = { same: 0, fits: 1, near: 2 };
const KIND_ORDER = { setplay: 0, combo: 1 };
const DRIVE_TOKENS = new Set(["DR", "DI", "パリィ"]);
/** OD必殺技：方向の数字2つ以上＋PP/KK の1語（236PP・623KK・63214PP・J236KK）。2PP のようなコマンド特殊技は含めない。 */
const OD_SPECIAL = /^J?[1-9]{2,}(?:PP|KK)$/;

function compareTitle(a, b) {
  return a.title.localeCompare(b.title, "ja");
}

/**
 * レシピにバーンアウト中は使えない部品（DR・DI・パリィ・OD必殺技）があるか。ドライブリバーサル（6 DI）やパリィDRも含む。
 * 2PP（スタンス）・63214PP PP の後ろの PP・SA・投げは含めない。判定の主は Dゲージ消費なので、ここは入力ミスを拾う補助として
 * 誤って外さない側に寄せる（方向1つ以下で書いたOD技は Dゲージ消費の値で外れる）。
 */
export function usesDrive(notation) {
  return String(notation || "").split(/\s+/).some((token) => DRIVE_TOKENS.has(token) || OD_SPECIAL.test(token));
}

/**
 * 今の状況・条件で使える手順か。
 * conditions: { situationId, position, drive（残りDゲージ。nullは指定なし）, sa（残りSA本数。null）, ca（CA可）,
 *   burnout（自分がバーンアウト中）, punishWindow（相手の不利F。null） }
 * situationId に "none" を渡すと、始動の状況がない手順だけになる。
 */
export function usableNow(sequence, conditions) {
  const { situationId = null, position = "", drive = null, sa = null, ca = false, burnout = false, punishWindow = null } = conditions;
  if (situationId === "none" ? sequence.starts.length > 0 : situationId !== null && !sequence.starts.includes(situationId)) return false;
  if (position && sequence.position !== "anywhere" && sequence.position !== position) return false;
  // バーンアウト中はDゲージを使えない。消費の入れ忘れ（OD技なのに0）もレシピから拾う
  if (burnout && (sequence.driveCost > 0 || usesDrive(sequence.notation))) return false;
  if (drive !== null && sequence.driveCost > drive) return false;
  if (sa !== null) {
    // SA1〜3はゲージ本数をそのまま使う。CAは3本＋体力25%以下
    if (sequence.saCost === 4 ? !(ca && sa >= 3) : sequence.saCost > sa) return false;
  }
  if (punishWindow !== null && (sequence.startup === null || sequence.startup > punishWindow)) return false;
  return true;
}

function byDamage(a, b) {
  return (b.damage ?? -1) - (a.damage ?? -1);
}

/**
 * 一覧の並び順。相手の不利Fを入れたときはダメージ順（不利F以内で一番減るもの）、確定反撃だけを選んだときは発生の速い順、
 * ほかの条件があればダメージ順、なければ渡された順（登録順）。
 */
export function sortSequences(list, conditions, situationsById) {
  const { situationId = null, drive = null, sa = null, burnout = false, punishWindow = null } = conditions;
  const sorted = [...list];
  if (punishWindow !== null) return sorted.sort(byDamage);
  if (situationId !== null && situationsById.get(situationId)?.presetKey === PRESET.punish) {
    return sorted.sort((a, b) => (a.startup ?? Infinity) - (b.startup ?? Infinity));
  }
  if (situationId !== null || drive !== null || sa !== null || burnout) return sorted.sort(byDamage);
  return sorted;
}

function frames(value) {
  return `${value > 0 ? "+" : ""}${value}F`;
}

/** 局面の数値の表示（例 "+29F 画面端 後ろ受け身可"）。位置が「どこでも」なら省く。DBが局面に付ける名前と同じ書き方。 */
export function stateLabel(situation) {
  if (situation.kind !== "state" || situation.advantage === null || situation.advantage === undefined) return "";
  return [frames(situation.advantage), POSITION_LABELS[situation.position], RECOVERY_LABELS[situation.recovery]].filter(Boolean).join(" ");
}

/** 同じキャラ・有利F・位置・ダウンの局面（保存時に再利用するもの）。アーカイブ済みは返さない（保存すると戻る）。 */
export function findState(situations, key) {
  return situations.find((situation) => situation.kind === "state" && !situation.archived
    && situation.character === key.character && situation.advantage === key.advantage
    && situation.position === key.position && (situation.recovery ?? null) === (key.recovery ?? null)) || null;
}

/**
 * from（手順の結果）から to（次の手順の始動）へつながるか。
 * "same"（同じ状況）/ "fits"（位置の片方が「どこでも」で有利Fが同じ）/ "near"（有利Fが±2F以内）/ null。
 * ダウンが片方だけ未設定のときは near まで。
 */
export function stateFit(from, to) {
  if (from.id === to.id) return "same";
  if (from.kind !== "state" || to.kind !== "state" || from.character !== to.character) return null;
  const fromRecovery = from.recovery ?? null;
  const toRecovery = to.recovery ?? null;
  if (fromRecovery !== null && toRecovery !== null && fromRecovery !== toRecovery) return null;
  if (from.position !== "anywhere" && to.position !== "anywhere" && from.position !== to.position) return null;
  const diff = Math.abs(from.advantage - to.advantage);
  if (diff > NEAR_FRAMES) return null;
  return diff === 0 && fromRecovery === toRecovery ? "fits" : "near";
}

/**
 * その状況から始まる手順。同じ状況→合う局面→近い局面、起き攻め→コンボ、名前の順。アーカイブは除く。
 * 1段だけ返すので、ループする局面（端の締め→同じ局面）でも止まる。
 */
export function sequencesFrom(situation, sequences, situations, options = {}) {
  const includeNear = options.includeNear ?? true;
  const byId = new Map(situations.map((entry) => [entry.id, entry]));
  const found = [];
  for (const sequence of sequences) {
    if (sequence.archived) continue;
    let best = null;
    for (const startId of sequence.starts) {
      const start = byId.get(startId);
      if (!start) continue;
      const fit = stateFit(situation, start);
      if (!fit || (fit === "near" && !includeNear)) continue;
      if (!best || FIT_ORDER[fit] < FIT_ORDER[best.fit]) best = { sequence, via: start, fit };
    }
    if (best) found.push(best);
  }
  return found.sort((a, b) => FIT_ORDER[a.fit] - FIT_ORDER[b.fit]
    || KIND_ORDER[a.sequence.kind] - KIND_ORDER[b.sequence.kind] || compareTitle(a.sequence, b.sequence));
}

export function resultOf(sequence, kind) {
  return sequence.results.find((result) => result.kind === kind) || null;
}

/** コンボのカード用：ヒットの結果の局面から行ける起き攻め。 */
export function setplaysAfter(combo, sequences, situations) {
  const next = resultOf(combo, "hit")?.nextSituationId;
  const state = situations.find((situation) => situation.id === next);
  if (!state) return [];
  return sequencesFrom(state, sequences.filter((sequence) => sequence.kind === "setplay" && sequence.character === combo.character), situations)
    .map(({ sequence, fit }) => ({ sequence, fit }));
}

/** 起き攻めのカード用：ヒットでこの局面（または合う局面）につながるコンボ。 */
export function leadsInto(state, sequences, situations) {
  const byId = new Map(situations.map((entry) => [entry.id, entry]));
  return sequences.filter((sequence) => {
    if (sequence.kind !== "combo" || sequence.archived) return false;
    const next = byId.get(resultOf(sequence, "hit")?.nextSituationId);
    const fit = next ? stateFit(next, state) : null;
    return fit === "same" || fit === "fits";
  });
}

/**
 * 状況を使っている手順の数。orphaned は、削除すると始動の状況がなくなる手順の数。
 */
export function situationUsage(situationId, sequences) {
  let starts = 0;
  let results = 0;
  let orphaned = 0;
  const sequenceIds = [];
  for (const sequence of sequences) {
    const inStarts = sequence.starts.includes(situationId);
    const inResults = sequence.results.filter((result) => result.nextSituationId === situationId).length;
    if (inStarts) starts += 1;
    if (inStarts && sequence.starts.length === 1) orphaned += 1;
    results += inResults;
    if (inStarts || inResults) sequenceIds.push(sequence.id);
  }
  return { starts, results, sequenceIds, orphaned };
}

function hasPreset(sequence, situationsById, key) {
  return sequence.starts.some((id) => situationsById.get(id)?.presetKey === key);
}

function startsFromBackRoll(sequence, situationsById) {
  return sequence.starts.some((id) => situationsById.get(id)?.recovery === "back_roll");
}

/** 1つの手順を練習メニューにするときの初期値（タイトル・トレモ設定）。 */
export function drillPreset(sequence, situationsById) {
  const base = { title: `${sequence.title}（${sequence.character}）`.slice(0, 200), sequenceIds: [sequence.id] };
  if (sequence.kind === "setplay") {
    return {
      ...base,
      recoverySetting: startsFromBackRoll(sequence, situationsById) ? "random" : null,
      reversalRecorded: true,
      detail: "無敵技を録画再生してガードが間に合うか、重ねが成立するかを確認",
    };
  }
  return {
    ...base,
    guardSetting: "random",
    counterSetting: hasPreset(sequence, situationsById, PRESET.punishCounter) ? "punish_counter"
      : hasPreset(sequence, situationsById, PRESET.counter) ? "counter" : null,
    detail: hasPreset(sequence, situationsById, PRESET.hitConfirm) ? "ランダムガードでヒット確認して10回連続" : "ランダムガードで10回連続",
  };
}

/**
 * ルート（[{ situationId }, { sequenceId, resultKind, opponentAction }, { situationId }, …]）を1つの練習にする。
 * 同じ手順を2回通るループは、練習の対象としては1回にまとめる。
 */
export function routeDrillPreset(path, sequencesById, situationsById) {
  const start = situationsById.get(path.find((step) => "situationId" in step)?.situationId);
  const sequences = path.filter((step) => "sequenceId" in step).map((step) => sequencesById.get(step.sequenceId)).filter(Boolean);
  const sequenceIds = [...new Set(sequences.map((sequence) => sequence.id))];
  const hasCombo = sequences.some((sequence) => sequence.kind === "combo");
  const setplays = sequences.filter((sequence) => sequence.kind === "setplay");
  return {
    title: [start?.name, ...sequences.map((sequence) => sequence.title)].filter(Boolean).join(" › ").slice(0, 200),
    detail: `最後まで通して${STREAK_GOAL}回連続`,
    sequenceIds,
    guardSetting: hasCombo ? "random" : null,
    counterSetting: start?.presetKey === PRESET.punishCounter ? "punish_counter" : start?.presetKey === PRESET.counter ? "counter" : null,
    recoverySetting: setplays.some((sequence) => startsFromBackRoll(sequence, situationsById)) ? "random" : null,
    reversalRecorded: setplays.length > 0,
  };
}

/** 練習メニューの記録のうち、最高の連続成功数。 */
export function bestStreakOf(logs) {
  return logs.reduce((best, log) => Math.max(best, log.bestStreak ?? 0), 0);
}

/**
 * 練習の結果から、紐づけた手順の習得度を3段階目に上げてよいか。
 * 10回連続を達成していて、今の習得度が2段階目以下のときだけ。
 */
export function shouldRaiseMastery(target, logs) {
  return Boolean(target) && target.mastery < 2 && bestStreakOf(logs) >= STREAK_GOAL;
}

/** 練習メニューの手順のうち、10連続の記録で習得度を上げるもの（習得度が2未満の全部）。 */
export function raiseTargets(sequenceIds, sequences, logs) {
  return sequenceIds
    .map((id) => sequences.find((sequence) => sequence.id === id))
    .filter((sequence, index, list) => sequence && list.indexOf(sequence) === index && shouldRaiseMastery(sequence, logs));
}

/** 名前が空欄のときに付ける名前：レシピの空白をまとめて先頭40字。 */
export function defaultTitle(notation) {
  return [...String(notation || "").trim().replace(/\s+/g, " ")].slice(0, 40).join("");
}
