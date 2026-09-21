import { useCallback, useState } from "react";
import { ApiError, gradeQuiz, startQuiz } from "../lib/api";
import type {
  Knowledge, QuizEmptyReason, QuizFormatRequest, QuizGenerationFailure, QuizGradeFailure, QuizGradeResult, QuizQuestion,
} from "../types";

export const QUIZ_LIMIT_OPTIONS = [5, 10, 15, 20, 30] as const;
export const DEFAULT_QUIZ_LIMIT = 15;

/** 出題形式の選択肢。並び順がそのまま画面の並びになる。 */
export const QUIZ_FORMAT_OPTIONS: { value: QuizFormatRequest; label: string; hint: string }[] = [
  { value: "おまかせ", label: "おまかせ", hint: "再認→自由想起へ進め、知識の構造に合わせて一問一答・説明・産出を選ぶ" },
  { value: "四択", label: "四択", hint: "選択肢から選ぶ。思い出せない項目の足場向け" },
  { value: "一問一答", label: "一問一答", hint: "選択肢なしでキーワードを答える。標準" },
  { value: "記述説明", label: "記述説明", hint: "理由や使い分けを数文で説明する" },
  { value: "産出", label: "産出", hint: "英作文など、覚えた知識を実際に使う" },
];
export const DEFAULT_QUIZ_FORMAT: QuizFormatRequest = "おまかせ";

export type QuizStage = "setup" | "loading" | "empty" | "quiz" | "grading" | "results";

export interface QuizDisplayError {
  message: string;
  stage?: string;
  reason?: string;
  action?: string;
  details: string[];
  reference?: string;
}

function displayError(caught: unknown, fallback: string): QuizDisplayError {
  if (caught instanceof ApiError) {
    return {
      message: caught.message,
      stage: caught.stage,
      reason: caught.reason,
      action: caught.action,
      details: caught.details,
      reference: caught.reference,
    };
  }
  return {
    message: caught instanceof Error ? caught.message : fallback,
    details: [],
  };
}

export function useQuiz(onRecorded?: () => void | Promise<void>) {
  const [stage, setStage] = useState<QuizStage>("setup");
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [skipped, setSkipped] = useState<Record<string, boolean>>({});
  const [index, setIndex] = useState(0);
  const [results, setResults] = useState<QuizGradeResult[]>([]);
  const [failures, setFailures] = useState<QuizGradeFailure[]>([]);
  const [error, setError] = useState<QuizDisplayError | null>(null);
  const [emptyReason, setEmptyReason] = useState<QuizEmptyReason | null>(null);
  const [early, setEarly] = useState(false);
  const [requestedCount, setRequestedCount] = useState(0);
  const [generationFailures, setGenerationFailures] = useState<QuizGenerationFailure[]>([]);

  const start = useCallback(async (
    categories: string[],
    limit: number,
    format: QuizFormatRequest,
    mode: "daily" | "custom" = "custom",
  ) => {
    setStage("loading");
    setError(null);
    setResults([]);
    setFailures([]);
    setRequestedCount(0);
    setGenerationFailures([]);
    try {
      const {
        items, reason, early: isEarly, requestedCount: requested, generationFailures: generationErrors,
      } = await startQuiz(categories, limit, format, mode);
      if (items.length === 0) {
        setEmptyReason(reason);
        setStage("empty");
        return;
      }
      setQuestions(items);
      setAnswers(Object.fromEntries(items.map((item) => [item.id, ""])));
      setSkipped(Object.fromEntries(items.map((item) => [item.id, false])));
      setIndex(0);
      setEarly(isEarly);
      setRequestedCount(requested);
      setGenerationFailures(generationErrors);
      setStage("quiz");
    } catch (caught) {
      setError(displayError(caught, "出題に失敗しました。"));
      setStage("setup");
    }
  }, []);

  const answerCurrent = useCallback((text: string) => {
    const current = questions[index];
    if (!current) return;
    setAnswers((prev) => ({ ...prev, [current.id]: text }));
  }, [questions, index]);

  const skipCurrent = useCallback((value: boolean) => {
    const current = questions[index];
    if (!current) return;
    setSkipped((prev) => ({ ...prev, [current.id]: value }));
  }, [questions, index]);

  const goNext = useCallback(() => {
    setIndex((prev) => Math.min(prev + 1, questions.length - 1));
  }, [questions.length]);

  const goBack = useCallback(() => {
    setIndex((prev) => Math.max(prev - 1, 0));
  }, []);

  const submit = useCallback(async () => {
    setStage("grading");
    setError(null);
    try {
      const submitted = questions.flatMap((q, questionIndex) => skipped[q.id] ? [] : [{
        questionIndex,
        token: q.token,
        answer: answers[q.id] ?? "",
      }]);
      if (submitted.length === 0) {
        setResults([]);
        setFailures([]);
        setStage("results");
        return;
      }
      const payload = submitted.map(({ token, answer }) => ({ token, answer }));
      const graded = await gradeQuiz(payload);
      setResults(graded.results);
      setFailures(graded.failures.map((failure) => ({
        ...failure,
        index: submitted[failure.index]?.questionIndex ?? failure.index,
      })));
      // 採点直後の再読込と結果画面からの優先度更新を競合させない。
      if (graded.results.length > 0 || graded.failures.some((failure) => failure.recorded === true)) {
        try {
          await onRecorded?.();
        } catch {
          // 再読込側がエラーを表示する。採点自体は確定済みなので結果は表示する。
        }
      }
      setStage("results");
    } catch (caught) {
      setError(displayError(caught, "採点に失敗しました。"));
      setStage("quiz");
    }
  }, [questions, answers, skipped, onRecorded]);

  const syncKnowledgeResult = useCallback((updated: Knowledge) => {
    setResults((current) => current.map((result) => result.id === updated.id
      ? {
        ...result,
        title: updated.title,
        category: updated.category,
        priority: updated.priority,
        content_version: updated.content_version,
        next_review_on: updated.next_review_on,
        next_review_at: updated.next_review_at,
        stability_hours: updated.stability_hours,
        relearning_stage: updated.relearning_stage,
      }
      : result));
  }, []);

  const reset = useCallback(() => {
    setStage("setup");
    setQuestions([]);
    setAnswers({});
    setSkipped({});
    setIndex(0);
    setResults([]);
    setFailures([]);
    setError(null);
    setEmptyReason(null);
    setEarly(false);
    setRequestedCount(0);
    setGenerationFailures([]);
  }, []);

  return {
    stage, questions, answers, skipped, index, results, failures, error, emptyReason, early,
    requestedCount, generationFailures,
    start, answerCurrent, skipCurrent, goNext, goBack, submit, reset, syncKnowledgeResult,
  };
}
