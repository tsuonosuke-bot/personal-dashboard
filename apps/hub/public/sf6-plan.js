// SF6の「状況 → 手順 → 状況」の判定。今の条件で使える手順、局面どうしのつながり、ルートの練習、習得度の上げ方。
// 状況（sf6_situations）と手順（sf6_sequences）はAPIの形（camelCase）のまま受け取る。DOMに触れないのでテストから直接読める。

/** 習得度の4段階。3段階目は「ランダム設定で10回連続」で判定する。 */
export const MASTERY = ["未練習", "練習中", "ランダムで10連続", "実戦で出せる"];
export const STREAK_GOAL = 10;
/** 判定に使う初期の状況。名前は変えられるので preset_key で見る。 */
export const PRESET = { punish: "punish", hitConfirm: "hit_confirm", counter: "counter", punishCounter: "punish_counter" };
/** 起き攻めに対して相手が取れる行動（表示名は sf6.js）。 */
export const OPPONENT_OPTIONS = ["reversal", "backdash", "jump", "tech", "delay_tech", "mash", "drive_impact", "parry", "drive_reversal", "back_roll"];

const POSITION_LABELS = { midscreen: "画面中央", corner: "画面端" };
const RECOVERY_LABELS = { back_roll: "後ろ受け身可", no_back_roll: "後ろ受け身不可", none: "ダウンなし" };
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

/**
 * 一覧の並び順。相手の不利Fか確定反撃を選んだときは発生の速い順、それ以外は渡された順（登録順）。
 */
export function sortSequences(list, conditions, situationsById) {
  const { situationId = null, drive = null, sa = null, burnout = false, punishWindow = null } = conditions;
  const sorted = [...list];
  if (punishWindow !== null || (situationId !== null && situationsById.get(situationId)?.presetKey === PRESET.punish)) {
    return sorted.sort((a, b) => (a.startup ?? Infinity) - (b.startup ?? Infinity));
  }
  return sorted;
}

/** 始動の候補。選択中を先頭に集め、同じキャラで最近保存した手順の始動を優先して各種類を折りたたむ。 */
export function startSituationGroups(situations, sequences, character, selected = [], limit = 3) {
  const selectedIds = new Set(selected);
  const available = situations.filter((situation) => (situation.character === character || (situation.kind === "trigger" && situation.character === null))
    && (!situation.archived || selectedIds.has(situation.id)));
  const recent = [...sequences].filter((sequence) => sequence.character === character && !sequence.archived)
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))
    .flatMap((sequence) => sequence.starts);
  const ranks = new Map([...new Set(recent)].map((id, index) => [id, index]));
  const group = (kind) => {
    const list = available.filter((situation) => situation.kind === kind && !selectedIds.has(situation.id))
      .sort((a, b) => (ranks.get(a.id) ?? Infinity) - (ranks.get(b.id) ?? Infinity) || a.id - b.id);
    return { visible: list.slice(0, limit), more: list.slice(limit) };
  };
  return { selected: available.filter((situation) => selectedIds.has(situation.id)), triggers: group("trigger"), states: group("state") };
}

/** 道のりの状況・手順へ戻る。手順の場合は、選んだ直前の状況まで戻してそのカードを表示する。 */
export function routeBack(path, index) {
  const step = path[index];
  if (!step || !Number.isInteger(index) || index < 0) return null;
  if ("situationId" in step) return { path: path.slice(0, index + 1), sequenceId: null };
  return { path: path.slice(0, index), sequenceId: step.sequenceId };
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
 * その状況から始まる手順。始動に選ばれている手順だけを、名前順で返す（有利Fなどからの自動的なつなぎはしない）。
 * アーカイブは除く。1段だけ返すので、ループする局面でも止まる。
 */
export function sequencesFrom(situation, sequences) {
  return sequences
    .filter((sequence) => !sequence.archived && sequence.starts.includes(situation.id))
    .map((sequence) => ({ sequence, via: situation }))
    .sort((a, b) => compareTitle(a.sequence, b.sequence));
}

export function resultOf(sequence, kind) {
  return sequence.results.find((result) => result.kind === kind) || null;
}

/** 同じ種類の結果すべて（次の状況を複数持てる）。 */
export function resultsOf(sequence, kind) {
  return sequence.results.filter((result) => result.kind === kind);
}

/** パーツのカード用：ヒットの結果の状況を始動に選んでいるパーツ。 */
export function partsAfter(part, sequences, situations) {
  const others = sequences.filter((sequence) => sequence.id !== part.id && sequence.character === part.character);
  const found = new Map();
  for (const result of resultsOf(part, "hit")) {
    const state = situations.find((situation) => situation.id === result.nextSituationId);
    if (state) for (const entry of sequencesFrom(state, others)) if (!found.has(entry.sequence.id)) found.set(entry.sequence.id, entry);
  }
  return [...found.values()];
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

/** 相手の行動ごとの結果（○×）を持つパーツ。練習は無敵技の録画再生など、起き攻め向けの設定にする。 */
export function hasOutcomes(sequence) {
  return sequence.results.some((result) => result.kind === "opponent");
}

/** 1つの手順を練習メニューにするときの初期値（タイトル・トレモ設定）。 */
export function drillPreset(sequence, situationsById) {
  const base = { title: `${sequence.title}（${sequence.character}）`.slice(0, 200), sequenceIds: [sequence.id] };
  if (hasOutcomes(sequence)) {
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
 * 道のりは手順で終えてもよい（最後が { sequenceId, resultKind: null }。次の状況がない起き攻めなど）。
 * 同じ手順を2回通るループは、練習の対象としては1回にまとめる。
 */
export function routeDrillPreset(path, sequencesById, situationsById) {
  const start = situationsById.get(path.find((step) => "situationId" in step)?.situationId);
  const sequences = path.filter((step) => "sequenceId" in step).map((step) => sequencesById.get(step.sequenceId)).filter(Boolean);
  const sequenceIds = [...new Set(sequences.map((sequence) => sequence.id))];
  const hasCombo = sequences.some((sequence) => !hasOutcomes(sequence));
  const setplays = sequences.filter(hasOutcomes);
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
