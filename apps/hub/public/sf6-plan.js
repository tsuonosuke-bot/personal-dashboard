// SF6の「状況・条件からコンボを引く」「締めから起き攻めを引く」「練習結果から習得度を上げる」判定。
// DOMに触れないのでテストから直接読める。

/** 始動のきっかけ。自分で足した状況（例「昇龍ガード後」）と並べて選ぶ。 */
export const SITUATION_PRESETS = [
  "確定反撃", "ヒット確認", "差し返し", "カウンター", "パニッシュカウンター", "対空",
  "ジャンプ攻撃始動", "パリィ後", "DI壁やられ", "投げ後", "相手バーンアウト",
];

/** 習得度の4段階。3段階目は「ランダム設定で10回連続」で判定する。 */
export const MASTERY = ["未練習", "練習中", "ランダムで10連続", "実戦で出せる"];
export const STREAK_GOAL = 10;
export const NEAR_FRAMES = 2;

/** 選べる状況：プリセット＋登録済みのコンボで使われている自作の状況。 */
export function situationOptions(combos) {
  const custom = new Set();
  for (const combo of combos) for (const situation of combo.situations || []) {
    if (!SITUATION_PRESETS.includes(situation)) custom.add(situation);
  }
  return [...SITUATION_PRESETS, ...[...custom].sort((a, b) => a.localeCompare(b, "ja"))];
}

/**
 * 今の状況・条件で使えるコンボか。
 * conditions: { situation, position, drive（残りDゲージ、nullは指定なし）, sa（残りSA本数、null）, ca（CA可）, burnout }
 */
export function usableNow(combo, conditions) {
  const { situation = "", position = "", drive = null, sa = null, ca = false, burnout = false } = conditions;
  if (situation && !(combo.situations || []).includes(situation)) return false;
  if (position && combo.position !== "anywhere" && combo.position !== position) return false;
  if (burnout && !combo.burnoutOk) return false;
  if (drive !== null && combo.driveCost > drive) return false;
  if (sa !== null) {
    // SA1〜3はゲージ本数をそのまま使う。CAは3本＋体力25%以下
    if (combo.saCost === 4 ? !(ca && sa >= 3) : combo.saCost > sa) return false;
  }
  return true;
}

/** 位置が噛み合うか。どちらかが「どこでも」なら成立とみなす。 */
function positionFits(comboPosition, setplayPosition) {
  return comboPosition === "anywhere" || setplayPosition === "anywhere" || comboPosition === setplayPosition;
}

/**
 * コンボの締めから行ける起き攻めか。
 * 返り値: "linked"（起点として紐づけ済み）/ "exact"（有利F・位置・受け身が一致）/ "near"（有利Fが±2F以内）/ null
 */
export function setplayFit(combo, setplay) {
  if (setplay.archived || combo.character !== setplay.character) return null;
  if ((setplay.comboIds || []).includes(combo.id)) return "linked";
  if (combo.endAdvantage === null || combo.endAdvantage === undefined) return null;
  if (combo.recovery !== setplay.recovery || !positionFits(combo.position, setplay.position)) return null;
  const diff = Math.abs(combo.endAdvantage - setplay.startAdvantage);
  if (diff === 0) return "exact";
  return diff <= NEAR_FRAMES ? "near" : null;
}

/** コンボから行ける起き攻めを、紐づけ済み→一致→±2Fの順に返す。 */
export function setplaysAfter(combo, setplays) {
  const order = { linked: 0, exact: 1, near: 2 };
  return setplays
    .map((setplay) => ({ setplay, fit: setplayFit(combo, setplay) }))
    .filter((entry) => entry.fit !== null)
    .sort((a, b) => order[a.fit] - order[b.fit] || a.setplay.title.localeCompare(b.setplay.title, "ja"));
}

/** 練習メニューの記録のうち、最高の連続成功数。 */
export function bestStreakOf(logs) {
  return logs.reduce((best, log) => Math.max(best, log.bestStreak ?? 0), 0);
}

/**
 * 練習の結果から、紐づけたコンボ・起き攻めの習得度を3段階目に上げてよいか。
 * 10回連続を達成していて、今の習得度が2段階目以下のときだけ。
 */
export function shouldRaiseMastery(target, logs) {
  return Boolean(target) && target.mastery < 2 && bestStreakOf(logs) >= STREAK_GOAL;
}
