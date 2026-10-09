import type {
  Knowledge,
  SpeakingPracticeLog,
  SpeakingPracticeType,
} from "../types";

export type { SpeakingPracticeMode } from "../types";

export interface SpeakingPracticeCard {
  knowledge: Knowledge;
  type: SpeakingPracticeType;
  /** 瞬間英作文の日本語文、または音読例文の日本語訳。 */
  prompt: string;
  /** AIが生成した短いビジネス英語例文。 */
  target: string;
}

const ENGLISH_PATTERN = /[A-Za-z]/;
const PRACTICE_TAG_PATTERN = /(英語|英会話|会話|フレーズ|表現|単語|business\s*english)/i;

/** 英語カテゴリまたは英語系タグに属し、英字の練習対象を持つアクティブ項目だけを選ぶ。 */
export function isSpeakingPracticeCandidate(item: Knowledge): boolean {
  if (item.archived || !ENGLISH_PATTERN.test(item.title)) return false;
  return item.category.includes("英語") || item.tags.some((tag) => PRACTICE_TAG_PATTERN.test(tag));
}

export function speakingPracticeCandidates(knowledge: Knowledge[]): Knowledge[] {
  return knowledge.filter(isSpeakingPracticeCandidate);
}

function shuffled<T>(items: T[], random: () => number): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

/** 練習の対象（#138）。おまかせは全候補から、ほかは選んだカテゴリ・タグ・カードだけから出題する。 */
export type SpeakingPracticeScope =
  | { kind: "all" }
  | { kind: "category"; category: string }
  | { kind: "tag"; tag: string }
  | { kind: "cards"; ids: string[] };

export const SPEAKING_MAX_ITEMS = 15;

export function speakingPracticePool(candidates: Knowledge[], scope: SpeakingPracticeScope): Knowledge[] {
  if (scope.kind === "category") return candidates.filter((item) => item.category === scope.category);
  if (scope.kind === "tag") return candidates.filter((item) => item.tags.includes(scope.tag));
  if (scope.kind === "cards") {
    const ids = new Set(scope.ids);
    return candidates.filter((item) => ids.has(item.id));
  }
  return candidates;
}

/** 対象が0件のときに、なぜ始められないかを返す。0件でなければnull。 */
export function speakingPracticeEmptyReason(candidates: Knowledge[], scope: SpeakingPracticeScope): string | null {
  if (candidates.length === 0) return "カテゴリまたはタグが「英語」で、英字タイトルを持つナレッジがありません。";
  if (speakingPracticePool(candidates, scope).length > 0) return null;
  if (scope.kind === "category") return scope.category ? `カテゴリ「${scope.category}」に練習できる英語カードがありません。` : "カテゴリを選んでください。";
  if (scope.kind === "tag") return scope.tag ? `タグ「${scope.tag}」の付いた練習できる英語カードがありません。` : "タグを選んでください。";
  if (scope.kind === "cards") return "練習するカードを1件以上選んでください。";
  return null;
}

/** 選択欄に出すカテゴリ・タグと、それぞれの候補件数。 */
export function speakingPracticeGroups(candidates: Knowledge[]) {
  const count = (values: string[]) => {
    const counts = new Map<string, number>();
    for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0], "ja")).map(([name, total]) => ({ name, total }));
  };
  return {
    categories: count(candidates.map((item) => item.category)),
    tags: count(candidates.flatMap((item) => item.tags)),
  };
}

/** AIに例文作成を依頼するナレッジを、重複なしで選ぶ。カード指定のときは選んだカードをそのまま使う。 */
export function selectSpeakingPracticeKnowledge(
  knowledge: Knowledge[],
  limit: number,
  random: () => number = Math.random,
  scope: SpeakingPracticeScope = { kind: "all" },
): Knowledge[] {
  const pool = speakingPracticePool(speakingPracticeCandidates(knowledge), scope);
  const safeLimit = scope.kind === "cards" ? SPEAKING_MAX_ITEMS : Math.max(1, Math.min(SPEAKING_MAX_ITEMS, Math.floor(limit)));
  return shuffled(pool, random).slice(0, safeLimit);
}

/** 音声合成が使えるか。非対応ならお手本ボタンを無効にし、区切り読みを示す（#139）。 */
export function speechSynthesisSupported(target: unknown = globalThis): boolean {
  if (typeof target !== "object" || target === null) return false;
  return "speechSynthesis" in target && "SpeechSynthesisUtterance" in target;
}

/** 音声が使えないときの代替: 句読点と5語ごとに区切って、息継ぎの位置を示す。 */
export function readingChunks(sentence: string, maxWords = 5): string[] {
  const chunks: string[] = [];
  for (const part of sentence.split(/(?<=[,;:])\s+/)) {
    const words = part.trim().split(/\s+/).filter(Boolean);
    for (let index = 0; index < words.length; index += maxWords) chunks.push(words.slice(index, index + maxWords).join(" "));
  }
  return chunks;
}

export function speakingPracticeStats(logs: SpeakingPracticeLog[], now = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
  });
  const dateKey = (value: Date) => {
    const parts = Object.fromEntries(
      formatter.formatToParts(value).map((part) => [part.type, part.value]),
    );
    return `${parts.year}-${parts.month}-${parts.day}`;
  };
  const today = dateKey(now);
  const todayLogs = logs.filter((log) => dateKey(new Date(log.practiced_at)) === today);
  return {
    today: todayLogs.length,
    recent: logs.length,
    smooth: todayLogs.filter((log) => log.rating === "smooth").length,
  };
}
