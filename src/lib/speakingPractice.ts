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

/** AIに例文作成を依頼するナレッジを、重複なしで選ぶ。 */
export function selectSpeakingPracticeKnowledge(
  knowledge: Knowledge[],
  limit: number,
  random: () => number = Math.random,
): Knowledge[] {
  const candidates = shuffled(speakingPracticeCandidates(knowledge), random);
  const safeLimit = Math.max(1, Math.min(15, Math.floor(limit)));
  return candidates.slice(0, safeLimit);
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
