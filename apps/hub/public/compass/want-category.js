// Wantsを「やりたいことのバックログ」として分類する。DOMに触れないので、テストから直接読み込める。
//
// 正本は public.wants.category（nullは未分類）。Inboxから「欲しいもの」で作ったWantは
// categoryが空でも type='wish' なので「欲しい」に入れる。

export const WANT_CATEGORIES = [
  { key: "place", label: "行きたい", description: "行きたい場所" },
  { key: "watch", label: "観たい", description: "見たい映画・ドラマ・アニメ" },
  { key: "play", label: "遊びたい", description: "プレイしたいゲーム" },
  { key: "read", label: "読みたい", description: "読みたい本" },
  { key: "do", label: "やってみたい", description: "体験・挑戦・食べたいもの" },
  { key: "wish", label: "欲しい", description: "欲しいもの" },
  { key: "other", label: "未分類", description: "分類をまだ選んでいないWant" },
];

/** DBに保存する分類。「未分類」はnullで表す。 */
export const STORED_WANT_CATEGORIES = WANT_CATEGORIES.filter((category) => category.key !== "other").map((category) => category.key);

const CATEGORY_BY_KEY = new Map(WANT_CATEGORIES.map((category) => [category.key, category]));

/** @param {string} key */
export function wantCategoryMeta(key) {
  return CATEGORY_BY_KEY.get(key) || CATEGORY_BY_KEY.get("other");
}

/** @param {{ type?: string | null, category?: string | null }} want */
export function wantCategory(want) {
  if (want.category && STORED_WANT_CATEGORIES.includes(want.category)) return want.category;
  return want.type === "wish" ? "wish" : "other";
}

/**
 * バックログ上の段階。再訪日が来たものを先に、寝かせ中（再訪日が未来）を後ろに置く。
 * @param {{ revisitOn?: string | null }} want
 * @param {string} today YYYY-MM-DD
 */
export function wantBacklogStage(want, today) {
  if (!want.revisitOn) return "ready";
  return want.revisitOn <= today ? "due" : "sleeping";
}

const STAGE_ORDER = { due: 0, ready: 1, sleeping: 2 };

/**
 * Active Wantsを分類ごとにまとめる。分類はWANT_CATEGORIESの順、空の分類は返さない。
 * 分類の中は「再訪日が来た → いつでも → 寝かせ中」、同じ段階なら新しい順。
 * @template {{ id?: number | null, type?: string | null, category?: string | null, revisitOn?: string | null, createdAt?: string | null }} T
 * @param {T[]} wants
 * @param {string} today
 * @returns {{ key: string, label: string, description: string, items: T[] }[]}
 */
export function groupWantsByCategory(wants, today) {
  const groups = new Map(WANT_CATEGORIES.map((category) => [category.key, []]));
  wants.forEach((want) => groups.get(wantCategory(want)).push(want));
  return WANT_CATEGORIES
    .map(({ key, label, description }) => ({
      key,
      label,
      description,
      items: groups.get(key).sort((a, b) => STAGE_ORDER[wantBacklogStage(a, today)] - STAGE_ORDER[wantBacklogStage(b, today)]
        || String(b.createdAt || "").localeCompare(String(a.createdAt || ""))
        || (b.id ?? 0) - (a.id ?? 0)),
    }))
    .filter((group) => group.items.length > 0);
}
