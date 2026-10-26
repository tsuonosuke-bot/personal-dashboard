/** Generated-question contracts, format selection, normalization and answer-leak validation. */
import { type QuizFormat, MAX_CHOICE_CHARS, type QuizFormatRequest, AUTO_FORMAT } from "./quizValidation.ts";

/**
 * 復習問題の生成。30分ごとの生成バッチ（api/review-batch/generate）が使うプロンプト・形式決定・検証。
 */

/** 四択の講評としてDBへ保存する上限。 */
export const MAX_PREPARED_EXPLANATION_CHARS = 2_000;

/** この長さまでの想定解だけを、問題文への漏れとして照合する。 */
const MAX_LEAK_CHECK_ANSWER_CHARS = 60;

export interface GenerationFailure {
  stage: string;
  reason: string;
  action: string;
  reference?: string;
  status: number;
}

export interface RecentNote {
  asked_on: string;
  verdict: string;
  note: string;
}

/** get_recent_quiz_notes の行を、項目ごとに直近 NOTES_PER_ITEM 件までのつまずきメモへまとめる。 */
export function groupRecentNotes(rows: unknown[]): Map<string, RecentNote[]> {
  const notesById = new Map<string, RecentNote[]>();
  for (const row of rows) {
    const { knowledge_id, note, verdict, asked_on } = (row ?? {}) as Record<string, unknown>;
    if (typeof knowledge_id !== "string" || typeof note !== "string" || !note.trim()) continue;
    const history = notesById.get(knowledge_id) ?? [];
    if (history.length >= NOTES_PER_ITEM) continue;
    history.push({
      asked_on: typeof asked_on === "string" ? asked_on : "",
      verdict: typeof verdict === "string" ? verdict : "",
      note: note.trim(),
    });
    notesById.set(knowledge_id, history);
  }
  return notesById;
}

/** 1件あたり直近何回分のつまずきメモを出題の参考に渡すか。 */
export const NOTES_PER_ITEM = 2;

/** その回で何を問うか。weak_point は直近の回答で外した点、core は本文（title・explanation）の知識。 */
export type QuestionFocus = "weak_point" | "core";

/**
 * 直近の回答で外していて、その前は外していなければ、外した点を突く。それ以外は本文の知識を問う。
 * メモは正解でも毎回付くため、メモがあるだけで弱点を突くと本文の知識が問われなくなる。
 * 続けて外しているときも、前回すでに弱点を突いたものとみなして本文に戻る。
 */
export function questionFocus(notes: RecentNote[]): QuestionFocus {
  const [latest, previous] = notes;
  if (!latest || latest.verdict === "正解") return "core";
  return previous && previous.verdict !== "正解" ? "core" : "weak_point";
}

/** 四択の選択肢数。DBにもUIにも持たせず、ここだけを基準にする。 */
export const CHOICE_COUNT = 4;

const JAPANESE_WORD_COUNTS = new Map([
  ["一", 1], ["二", 2], ["三", 3], ["四", 4], ["五", 5],
  ["六", 6], ["七", 7], ["八", 8], ["九", 9], ["十", 10],
]);

interface ChoiceSet {
  choices: string[];
  correctChoice: string;
}

type ChoiceSetResult =
  | { ok: true; value: ChoiceSet }
  | { ok: false; reason: string };

export interface GeneratedQuestion {
  question: string;
  format: QuizFormat;
  choices: string[] | null;
  correctChoice: string | null;
  /** 四択のときだけ入る、回答直後に見せる講評。AIが返さなければnull。 */
  explanation: string | null;
  /** この問題文に対する想定解。漏れの検査と、回答直後の表示に使う。AIが返さなければnull。 */
  expectedAnswer: string | null;
}

/** AIの選択肢と正解を受け取れる形に正規化し、不採用時は利用者向けの理由も返す。 */
export function normalizeChoiceSet(value: unknown, correctChoice: unknown): ChoiceSetResult {
  if (!Array.isArray(value)) {
    return { ok: false, reason: "四択のchoicesが返されませんでした。" };
  }
  const trimmed: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") {
      return { ok: false, reason: "選択肢に文字列以外の値が含まれています。" };
    }
    const text = entry.trim();
    if (!text) return { ok: false, reason: "空の選択肢が含まれています。" };
    if (text.length > MAX_CHOICE_CHARS) {
      return { ok: false, reason: `選択肢が上限の${MAX_CHOICE_CHARS}文字を超えています。` };
    }
    if (trimmed.includes(text)) {
      return { ok: false, reason: "同じ選択肢が重複しています。" };
    }
    trimmed.push(text);
  }
  if (trimmed.length !== CHOICE_COUNT) {
    return {
      ok: false,
      reason: `選択肢が${trimmed.length}件です（${CHOICE_COUNT}件必要です）。`,
    };
  }
  if (typeof correctChoice !== "string" || !correctChoice.trim()) {
    return { ok: false, reason: "正解選択肢のcorrect_choiceが返されませんでした。" };
  }
  const normalizedCorrectChoice = correctChoice.trim();
  if (!trimmed.includes(normalizedCorrectChoice)) {
    return { ok: false, reason: "correct_choiceが4件の選択肢のどれとも一致しません。" };
  }
  return {
    ok: true,
    value: { choices: trimmed, correctChoice: normalizedCorrectChoice },
  };
}

/** 「3語」「三語」「3 words」のような、問題文で明示された英語の語数を取り出す。 */
export function requestedWordCount(question: string): number | null {
  const normalized = question.replace(/[０-９]/g, (digit) =>
    String.fromCharCode(digit.charCodeAt(0) - 0xfee0));
  const match = normalized.match(/(?:(\d{1,2})|([一二三四五六七八九十]))\s*語|\b(\d{1,2})\s*words?\b/iu);
  if (!match) return null;
  if (match[1] || match[3]) return Number(match[1] ?? match[3]);
  return JAPANESE_WORD_COUNTS.get(match[2]) ?? null;
}

/** タイトルが英語の語句そのものなら、空白区切りの語数を返す。説明文などは判定対象にしない。 */
export function englishTitleWordCount(title: string): number | null {
  const trimmed = title.trim().replace(/[.!?]+$/u, "");
  if (!trimmed || !/^[A-Za-z][A-Za-z'\u2019-]*(?:\s+[A-Za-z][A-Za-z'\u2019-]*)*$/u.test(trimmed)) {
    return null;
  }
  return trimmed.split(/\s+/u).length;
}

/** 語学問題に語数指定を入れた場合、正解タイトルの実語数と一致していることを機械的に確認する。 */
export function hasConsistentWordCount(item: PickedItem, question: string): boolean {
  if (!PRODUCTION_CATEGORIES.has(item.category)) return true;
  const requested = requestedWordCount(question);
  const actual = englishTitleWordCount(item.title);
  return requested === null || actual === null || requested === actual;
}

/**
 * 句読点や全半角の違いを無視して、正解タイトルが問題文へそのまま露出していないか確認する。
 * 日本語を含むタイトルは助詞が直後に続くため、空白を除いた完全な部分一致で確認する。
 */
function normalizedLeakText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[\u2018\u2019]/gu, "'")
    .replace(/[^\p{L}\p{N}']+/gu, " ")
    .trim();
}

export function questionRevealsTitle(title: string, question: string): boolean {
  const normalizedTitle = normalizedLeakText(title);
  if (!normalizedTitle) return false;

  if (/[^\x00-\x7f]/u.test(normalizedTitle)) {
    const compactTitle = normalizedTitle.replace(/\s+/gu, "");
    const compactQuestion = normalizedLeakText(question).replace(/\s+/gu, "");
    return compactTitle.length >= 2 && compactQuestion.includes(compactTitle);
  }

  // 1文字だけのタイトルは、冠詞やプレースホルダーとの偶然一致が多すぎるため対象外にする。
  if (normalizedTitle.length < 2) return false;
  return ` ${normalizedLeakText(question)} `.includes(` ${normalizedTitle} `);
}

/** 「使わせる」問い方が成立する、語学系のカテゴリ。 */
const PRODUCTION_CATEGORIES = new Set(["英語", "単語"]);

export interface PickedItem {
  id: string;
  title: string;
  explanation: string | null;
  category: string;
  mastery: string;
  times_asked: number;
  pool: string;
  stability_hours: number;
  relearning_stage: "recognition" | "recall" | null;
}

export function isPickedItem(value: unknown): value is PickedItem {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === "string" && typeof record.title === "string"
    && (record.explanation === null || typeof record.explanation === "string")
    && typeof record.category === "string" && typeof record.mastery === "string"
    && typeof record.times_asked === "number" && typeof record.pool === "string"
    && typeof record.stability_hours === "number"
    && (record.relearning_stage === null || record.relearning_stage === "recognition"
      || record.relearning_stage === "recall");
}

/**
 * おまかせ指定のとき、DB状態から許可できる形式だけを返す。複数ある場合は、
 * ナレッジの構造を読めるAIに最適な1つを選ばせる。
 */
export function allowedFormats(item: PickedItem, requested: QuizFormatRequest): QuizFormat[] {
  if (requested !== AUTO_FORMAT) return [requested];
  if (item.relearning_stage === "recognition") return ["四択"];
  if (item.relearning_stage === "recall") return ["一問一答"];
  if (item.mastery === "未学習" || (item.mastery === "学習中" && item.stability_hours < 24)) {
    return ["四択"];
  }
  if (item.mastery === "学習中") return ["一問一答"];
  if (PRODUCTION_CATEGORIES.has(item.category)) return ["産出"];
  if (item.mastery === "定着") return ["一問一答", "記述説明", "産出"];
  return ["一問一答", "記述説明"];
}

/** 正解の位置が偏らないよう選択肢を並べ替える。AIの出力順をそのまま見せない。 */
export function shuffle(values: string[]): string[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/** 作り直すときに添える、前回の問題文と不採用の理由。 */
export interface PreviousAttempt {
  question: string | null;
  problem: string;
}

export interface QuestionToolInput {
  id: string;
  question: string;
  format?: unknown;
  choices?: unknown;
  correct_choice?: unknown;
  explanation?: unknown;
  expected_answer?: unknown;
}

export function generationIssue(
  item: PickedItem,
  generated: GeneratedQuestion | undefined,
  parserIssue: string | undefined,
): string | null {
  if (!generated) return parserIssue ?? "AIの応答にこの項目の問題が含まれていませんでした。";
  if (questionRevealsTitle(item.title, generated.question)) {
    return "問題文に正解であるtitleの語句がそのまま含まれています。答えを伏せてください。";
  }
  // タイトルが文章のときは上の照合では見つからないため、想定解の語句でも漏れを確かめる。
  // 記述説明・産出の模範解答は長い文になり、問題文と一致することはまずないので短い解答だけを照合する。
  if (generated.expectedAnswer && generated.expectedAnswer.length <= MAX_LEAK_CHECK_ANSWER_CHARS
    && questionRevealsTitle(generated.expectedAnswer, generated.question)) {
    return "問題文に想定解の語句がそのまま含まれています。答えを伏せてください。";
  }
  if (!hasConsistentWordCount(item, generated.question)) {
    const requested = requestedWordCount(generated.question);
    const actual = englishTitleWordCount(item.title);
    return requested !== null && actual !== null
      ? `問題文では${requested}語と指定していますが、正解は${actual}語です。`
      : "問題文の語数指定が正解と一致しません。";
  }
  if (generated.format === "四択" && !generated.choices) {
    return parserIssue ?? "四択の選択肢を確認できませんでした。";
  }
  return null;
}
