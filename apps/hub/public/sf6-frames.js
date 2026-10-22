// SF6のフレームデータ（sf6_moves）の読み方・検索・表示用の計算と、投入スクリプト用の検証。
// 公式の表にはカウンター・パニッシュカウンターの列がないので、共通ルール（ヒット+2F／+4F）で計算し、
// 備考に個別の性能がある技だけ override の文字を優先する。DOMに触れないのでテストとスクリプトから直接読める。

/** ガードでこれ以下なら確定反撃を取られる（4F技）。HEAVY 以下は多くの技で取られる。距離や押し戻しで変わる。 */
export const PUNISHABLE_AT = -4;
export const HEAVY_PUNISH_AT = -6;
export const COUNTER_BONUS = 2;
export const PUNISH_COUNTER_BONUS = 4;
/** 公式の見出しの順：通常技・特殊技・必殺技・SA・投げ・共通システム */
export const CATEGORIES = ["normal", "unique", "special", "super", "throw", "common"];

const EMPTY_TEXT = new Set(["", "-", "—", "―", "ー"]);
const TEXT_LIMIT = 60;
const TEXT_FIELDS = [
  ["startup", "startup_text"], ["active", "active_text"], ["recovery", "recovery_text"], ["hit", "hit_text"],
  ["block", "block_text"], ["cancel", "cancel_text"], ["damage", "damage_text"], ["scaling", "scaling_text"],
  ["driveGain", "drive_gain_text"], ["driveLoss", "drive_loss_text"], ["saGain", "sa_gain_text"], ["attribute", "attribute_text"],
];

function clean(text) {
  return String(text ?? "").normalize("NFKC").trim();
}

/**
 * 公式の表記を数値にする。"+4"→4、"D"→ダウン、"-12～-1"→最小値と幅、発生の "2-4"→2、"6+0"→6。
 * 符号付きの値の前にある注記 "※-2" は-2。注記番号だけの "※1"、空や "-" はnull。
 * 読めない表記は value が null（knockdown も false）。
 */
export function parseFrameText(text, kind) {
  const value = clean(text).replace(/^※(?=[+-]\d)/, "");
  const result = { value: null, min: null, max: null, knockdown: false };
  if (EMPTY_TEXT.has(value)) return result;
  if (value === "D") return { ...result, knockdown: true };
  if (kind === "startup") {
    const split = value.match(/^(\d+)\s*\+\s*(\d+)$/);
    if (split) return { ...result, value: Number(split[1]) + Number(split[2]) };
    const match = value.match(/^(\d+)(?:\s*[-~]\s*\d+)?$/);
    return match ? { ...result, value: Number(match[1]) } : result;
  }
  const single = value.match(/^[+-]?\d+$/);
  if (single) return { ...result, value: Number(value) };
  const range = value.match(/^([+-]?\d+)\s*~\s*([+-]?\d+)$/);
  if (range) {
    const [low, high] = [Number(range[1]), Number(range[2])].sort((a, b) => a - b);
    return { value: low, min: low, max: high, knockdown: false };
  }
  return result;
}

function signed(value) {
  return `${value > 0 ? "+" : ""}${value}`;
}

/** 有利Fの表示。数値は符号を付け、幅は "-12～-1"、ダウンは "D"、読めないものは公式の表記のまま。 */
export function formatAdvantage(text) {
  const parsed = parseFrameText(text, "advantage");
  if (parsed.knockdown) return "D";
  if (parsed.min !== null) return `${signed(parsed.min)}～${signed(parsed.max)}`;
  if (parsed.value !== null) return `${clean(text).startsWith("※") ? "※" : ""}${signed(parsed.value)}`;
  return clean(text);
}

function bonusText(move, bonus, override) {
  if (override) return { text: override, overridden: true };
  const parsed = parseFrameText(move.hitText, "advantage");
  if (parsed.knockdown || move.hitKnockdown) return { text: "D", overridden: false };
  if (parsed.min !== null) return { text: `${signed(parsed.min + bonus)}～${signed(parsed.max + bonus)}`, overridden: false };
  const base = parsed.value ?? move.onHit ?? null;
  return { text: base === null ? "" : signed(base + bonus), overridden: false };
}

/** カウンター時：ヒット+2F。ダウンはD、備考に個別の性能があればそれ。 */
export function counterText(move) {
  return bonusText(move, COUNTER_BONUS, move.counterOverride);
}

/** パニッシュカウンター時：ヒット+4F。ダウンはD、備考に個別の性能があればそれ。 */
export function punishCounterText(move) {
  return bonusText(move, PUNISH_COUNTER_BONUS, move.punishCounterOverride);
}

/** ガードされたときに確定反撃を取られるか。"heavy"（-6F以下）/ "light"（-4〜-5F）/ null。 */
export function punishLevel(move) {
  if (move.onBlock === null || move.onBlock === undefined) return null;
  if (move.onBlock <= HEAVY_PUNISH_AT) return "heavy";
  return move.onBlock <= PUNISHABLE_AT ? "light" : null;
}

/** ガードした技から使える発生F。幅のある技は不利が小さい側を使い、不明・有利・五分は判定しない。 */
export function punishWindowForMove(move) {
  if (!move) return null;
  const parsed = parseFrameText(move.blockText, "advantage");
  const block = parsed.max ?? parsed.value ?? (clean(move.blockText) === "" ? move.onBlock : null);
  return Number.isInteger(block) && block < 0 ? -block : null;
}

/** 検索用に表記をそろえる：全角半角（NFKC）・カタカナ→ひらがな・小文字・空白除去。 */
export function normalizeQuery(text) {
  return String(text ?? "")
    .normalize("NFKC")
    .replace(/[ァ-ヶ]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0x60))
    .toLowerCase()
    .replace(/\s+/g, "");
}

function byOfficialOrder(a, b) {
  return a.sortOrder - b.sortOrder;
}

/** 技名・コマンドの一部、カテゴリ、確反の段階、キャンセル可で絞り、公式順・発生順・ガード有利/不利順に並べる。 */
export function searchMoves(moves, options = {}) {
  const { query = "", category = "", punishableOnly = false, heavyPunishableOnly = false, cancelableOnly = false, sort = "official" } = options;
  const needle = normalizeQuery(query);
  const list = moves.filter((move) => (!category || move.category === category)
    && (!needle || normalizeQuery(move.name).includes(needle) || normalizeQuery(move.command).includes(needle))
    && (!punishableOnly || punishLevel(move) !== null)
    && (!heavyPunishableOnly || punishLevel(move) === "heavy")
    && (!cancelableOnly || clean(move.cancelText) !== ""));
  if (sort === "startup") return list.sort((a, b) => (a.startup ?? Infinity) - (b.startup ?? Infinity) || byOfficialOrder(a, b));
  if (sort === "block") return list.sort((a, b) => (b.onBlock ?? -Infinity) - (a.onBlock ?? -Infinity) || byOfficialOrder(a, b));
  if (sort === "blockDisadvantage") return list.sort((a, b) => (a.onBlock ?? Infinity) - (b.onBlock ?? Infinity) || byOfficialOrder(a, b));
  return list.sort(byOfficialOrder);
}

/** レシピの "5中P" と技データの "中P" を同じものとして比べる（立ちのニュートラルは書いても書かなくてもよい）。 */
function canonicalCommand(text) {
  return String(text ?? "").trim().split(/\s+/).map((token) => token.replace(/^5(?=(?:弱|中|強)?[PK]|PP|KK)/, "")).join(" ");
}

function moveByCommand(command, moves) {
  const key = canonicalCommand(command);
  return moves.filter((move) => move.command && canonicalCommand(move.command) === key).sort(byOfficialOrder)[0] || null;
}

/** レシピの先頭（"溜め" などを含めて最大2語）と一致する技。長い一致を優先する。 */
export function starterMove(notation, moves) {
  const tokens = String(notation ?? "").trim().split(/\s+/).filter(Boolean);
  for (const length of [2, 1]) {
    if (tokens.length < length) continue;
    const move = moveByCommand(tokens.slice(0, length).join(" "), moves);
    if (move) return move;
  }
  return null;
}

/** 移行時と同じく手順名の最後の語＋「締め後」。名前が空ならレシピの締め技を使う。 */
export function defaultStateName(notation, moves, title = "") {
  const ending = String(title ?? "").trim().split(/\s+/).filter(Boolean).at(-1);
  const nameAfter = (name) => `${[...name].slice(0, 57).join("")}締め後`;
  if (ending) return nameAfter(ending);
  const tokens = String(notation ?? "").trim().split(/\s+/).filter(Boolean);
  for (let end = tokens.length; end > 0; end -= 1) {
    for (const length of [2, 1]) {
      if (end - length < 0) continue;
      const move = moveByCommand(tokens.slice(end - length, end).join(" "), moves);
      if (move) return nameAfter(move.name.replace(/[（(].*$/, "").replace(/\s+/g, ""));
    }
  }
  return null;
}

function optionalText(input, key, label, limit, errors) {
  const raw = input[key];
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") {
    errors.push(`${label}は文字列にしてください`);
    return null;
  }
  const value = raw.trim();
  if ([...value].length > limit) errors.push(`${label}が${limit}字を超えています`);
  return value || null;
}

/** 投入スクリプト用：JSON 1件を表の列に直す。問題は errors に入れる（行は作る）。 */
export function toMoveRow(input, sortOrder) {
  const errors = [];
  const name = typeof input?.name === "string" ? input.name.trim() : "";
  const label = name || `${sortOrder}件目`;
  const problems = (message) => errors.push(`${label}: ${message}`);
  if (!name || [...name].length > 80) problems("技名は1〜80字にしてください");
  if (!CATEGORIES.includes(input?.category)) problems(`カテゴリ「${input?.category}」は ${CATEGORIES.join("/")} のどれかにしてください`);
  const local = [];
  const row = {
    sort_order: sortOrder,
    category: input?.category,
    name,
    command: optionalText(input || {}, "command", "コマンド", 60, local),
  };
  for (const [key, column] of TEXT_FIELDS) row[column] = optionalText(input || {}, key, key, TEXT_LIMIT, local);
  row.notes = optionalText(input || {}, "notes", "備考", 2000, local);
  row.counter_override = optionalText(input || {}, "counterOverride", "counterOverride", 40, local);
  row.punish_counter_override = optionalText(input || {}, "punishCounterOverride", "punishCounterOverride", 40, local);
  local.forEach(problems);

  const startup = parseFrameText(row.startup_text, "startup");
  const hit = parseFrameText(row.hit_text, "advantage");
  const block = parseFrameText(row.block_text, "advantage");
  const unreadable = (text, parsed) => text !== null && !EMPTY_TEXT.has(clean(text)) && parsed.value === null && !parsed.knockdown;
  if (unreadable(row.startup_text, startup) || startup.knockdown) problems(`発生「${row.startup_text}」を数値にできません`);
  if (unreadable(row.hit_text, hit)) problems(`ヒット「${row.hit_text}」を数値にできません`);
  if (unreadable(row.block_text, block) || block.knockdown) problems(`ガード「${row.block_text}」を数値にできません`);
  row.startup = startup.value;
  row.on_hit = hit.value;
  row.hit_knockdown = hit.knockdown;
  row.on_block = block.value;
  if (row.startup !== null && (row.startup < 1 || row.startup > 200)) problems(`発生 ${row.startup} は1〜200にしてください`);
  for (const [column, value] of [["ヒット", row.on_hit], ["ガード", row.on_block]]) {
    if (value !== null && (value < -99 || value > 99)) problems(`${column} ${value} は-99〜99にしてください`);
  }
  return { row, errors };
}
