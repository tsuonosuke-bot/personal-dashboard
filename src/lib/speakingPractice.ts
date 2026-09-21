import type {
  Knowledge,
  SpeakingPracticeLog,
  SpeakingPracticeType,
} from "../types";

export type SpeakingPracticeMode = "mixed" | SpeakingPracticeType;

export interface SpeakingPracticeCard {
  knowledge: Knowledge;
  type: SpeakingPracticeType;
  prompt: string;
  target: string;
}

const JAPANESE_PATTERN = /[ぁ-んァ-ヶ一-龠々]/;
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

function hideTarget(text: string, target: string): string {
  const normalizedTarget = target.trim();
  if (!normalizedTarget) return text;
  const escaped = normalizedTarget.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(escaped, "gi"), "＿＿");
}

/** 説明から日本語の短い意味ヒントを作り、答えそのものは隠す。 */
export function instantCompositionPrompt(item: Knowledge): string {
  const source = hideTarget(item.explanation?.trim() ?? "", item.title)
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[`*_#]/g, "")
    .trim();
  const segments = source
    .split(/(?:\r?\n|(?<=[。！？]))/)
    .map((segment) => segment.trim())
    .filter((segment) => segment && JAPANESE_PATTERN.test(segment));
  // 日本語の説明中に例文や英単語が残っていても、答えを先に見せない。
  const hint = (segments[0] ?? "登録された意味・場面に合う表現")
    .replace(/[A-Za-z][A-Za-z0-9'’.,!?()/-]*(?:\s+[A-Za-z][A-Za-z0-9'’.,!?()/-]*)*/g, "＿＿")
    .replace(/＿＿(?:\s*＿＿)+/g, "＿＿")
    .slice(0, 220);
  return `次の意味を英語で言ってください。\n${hint}`;
}

function shuffled<T>(items: T[], random: () => number): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

/** 同じ項目の連続を避けながら、指定した形式と件数で練習カードを作る。 */
export function buildSpeakingPracticeSession(
  knowledge: Knowledge[],
  mode: SpeakingPracticeMode,
  limit: number,
  random: () => number = Math.random,
): SpeakingPracticeCard[] {
  const candidates = shuffled(speakingPracticeCandidates(knowledge), random);
  const safeLimit = Math.max(1, Math.min(15, Math.floor(limit)));
  return candidates.slice(0, safeLimit).map((item, index) => {
    const type: SpeakingPracticeType = mode === "mixed"
      ? (index % 2 === 0 ? "instant_composition" : "read_aloud")
      : mode;
    return {
      knowledge: item,
      type,
      prompt: type === "instant_composition"
        ? instantCompositionPrompt(item)
        : "表示された英語を、意味を意識しながら3回音読してください。",
      target: item.title.trim(),
    };
  });
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
