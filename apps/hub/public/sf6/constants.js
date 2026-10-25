

// SF6ページ。コンボパーツ・状況・フレーム・練習メニュー・対戦振り返りの5タブ。
// コンボパーツ（sequences）は、始動の状況・レシピ・結果（ヒット・ガード・相手の行動ごと → 次の状況）を持つ。続けられるなら次のパーツへ。状況（situations）は
// きっかけと局面の2種類。ルートと状況の管理は、1つのシート（#sheet）を使い回して開く。
// 編集は1つのモーダルを使い回し、FORMS の定義から入力欄を組み立てる。

export const CHARACTERS = [
  "リュウ", "ルーク", "ジェイミー", "春麗", "ガイル", "キンバリー", "ジュリ", "ケン", "ブランカ", "ダルシム",
  "エドモンド本田", "ディージェイ", "マノン", "マリーザ", "JP", "ザンギエフ", "リリー", "キャミィ",
  "ラシード", "A.K.I.", "エド", "豪鬼", "ベガ", "テリー", "舞", "エレナ", "サガット", "C.ヴァイパー", "アレックス", "イングリッド",
];

export const POSITIONS = { anywhere: "どこでも", midscreen: "画面中央", corner: "画面端" };

export const RESULTS = { win: "勝ち", lose: "負け", draw: "引き分け" };

export const MODES = { ranked: "ランクマ", casual: "カジュアル", battle_hub: "バトルハブ", tournament: "大会", other: "その他" };

export const SA_LEVELS = { 0: "なし", 1: "SA1", 2: "SA2", 3: "SA3", 4: "CA" };

// 0, 0.5, 1, … 6 の順に並べるため配列で持つ（オブジェクトだと整数のキーが先に並ぶ）
export const DRIVE_STEPS = Array.from({ length: 13 }, (_, index) => [String(index / 2), String(index / 2)]);

export const RECOVERIES = { back_roll: "後ろ受け身 可", no_back_roll: "後ろ受け身 不可", none: "ダウンなし" };

export const LAYERINGS = { meaty: "持続重ね", safe_jump: "安全飛び", other: "その他" };

export const OPPONENT_LABELS = {
  reversal: "無敵技", backdash: "バクステ", jump: "ジャンプ", tech: "グラップ",
  delay_tech: "遅らせグラップ", mash: "暴れ", drive_impact: "ドライブインパクト", parry: "パリィ", drive_reversal: "ドライブリバーサル", back_roll: "後ろ受け身",
};

/** 起き攻めの相手の行動ごとの結果が、どのヒットか。 */
export const HIT_TYPE_LABELS = { hit: "通常ヒット", counter_hit: "カウンターヒット", punish_counter: "パニッシュカウンター", other: "その他" };

export const RESULT_LABELS = { hit: "ヒット", counter_hit: "カウンターヒット", punish_counter: "パニッシュカウンター", hit_other: "ヒット（その他）", guard: "ガード" };

export const OUTCOME_MARKS = { win: "○", lose: "×", unknown: "–" };

export const GUARD_SETTINGS = { none: "ガードしない", all: "全部ガード", random: "ランダムガード" };

export const COUNTER_SETTINGS = { normal: "通常", counter: "カウンター", punish_counter: "パニッシュカウンター", random: "ランダム" };

export const RECOVERY_SETTINGS = { neutral: "その場起き", back: "後ろ受け身", random: "受け身ランダム" };

export const SITUATION_KINDS = { trigger: "きっかけ", state: "局面" };

export const TABS = ["sequences", "situations", "frames", "drills", "matches"];

export const ADD_LABELS = { sequences: "パーツを追加", situations: "状況を追加", frames: "", drills: "練習を追加", matches: "振り返りを追加" };

/** 以前の「コンボ」「起き攻め」タブの保存値・URLを、手順タブ（＋種類の絞り込み）に読み替える。 */
export const LEGACY_TABS = { combos: "sequences", setplays: "sequences" };
