import { useCallback, useMemo, useRef, useState } from "react";
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

export type QuizStage = "setup" | "loading" | "empty" | "quiz" | "results";

export interface QuizDisplayError {
  message: string;
  stage?: string;
  reason?: string;
  action?: string;
  details: string[];
  reference?: string;
}

/** 提出済みの1回分。採点はバックグラウンドで進み、その間に次の出題へ進める。 */
export interface GradingJob {
  id: number;
  questions: QuizQuestion[];
  answers: Record<string, string>;
  skipped: Record<string, boolean>;
  requestedCount: number;
  generationFailures: QuizGenerationFailure[];
  status: "grading" | "done" | "error";
  results: QuizGradeResult[];
  failures: QuizGradeFailure[];
  error: QuizDisplayError | null;
  /** 採点完了後に結果を開いたか。未確認の完了だけを通知する。 */
  seen: boolean;
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
  const [error, setError] = useState<QuizDisplayError | null>(null);
  const [emptyReason, setEmptyReason] = useState<QuizEmptyReason | null>(null);
  const [early, setEarly] = useState(false);
  const [requestedCount, setRequestedCount] = useState(0);
  const [generationFailures, setGenerationFailures] = useState<QuizGenerationFailure[]>([]);
  const [jobs, setJobs] = useState<GradingJob[]>([]);
  const [viewingJobId, setViewingJobId] = useState<number | null>(null);
  const nextJobId = useRef(1);
  // 採点完了時の再読込は1本ずつ流し、結果画面からの編集と競合させない。
  const reloadChain = useRef<Promise<void>>(Promise.resolve());
  // 採点完了時に、その回の結果画面を開いているか（開いていれば確認済みとして通知しない）。
  const openResultsJobId = useRef<number | null>(null);
  openResultsJobId.current = stage === "results" ? viewingJobId : null;

  const gradingIds = useMemo(
    () => jobs.filter((job) => job.status === "grading").flatMap((job) => job.questions
      .filter((question) => !job.skipped[question.id])
      .map((question) => question.id)),
    [jobs],
  );

  const updateJob = useCallback((id: number, change: Partial<GradingJob>) => {
    setJobs((current) => current.map((job) => job.id === id ? { ...job, ...change } : job));
  }, []);

  const runGrading = useCallback(async (job: GradingJob) => {
    const submitted = job.questions.flatMap((q, questionIndex) => job.skipped[q.id] ? [] : [{
      questionIndex,
      token: q.token,
      answer: job.answers[q.id] ?? "",
    }]);
    if (submitted.length === 0) {
      updateJob(job.id, { status: "done", results: [], failures: [], error: null, seen: openResultsJobId.current === job.id });
      return;
    }
    try {
      const graded = await gradeQuiz(submitted.map(({ token, answer }) => ({ token, answer })));
      const recorded = graded.results.length > 0 || graded.failures.some((failure) => failure.recorded === true);
      if (recorded && onRecorded) {
        reloadChain.current = reloadChain.current.then(async () => {
          try {
            await onRecorded();
          } catch {
            // 再読込側がエラーを表示する。採点自体は確定済みなので結果は表示する。
          }
        });
        await reloadChain.current;
      }
      updateJob(job.id, {
        status: "done",
        results: graded.results,
        failures: graded.failures.map((failure) => ({
          ...failure,
          index: submitted[failure.index]?.questionIndex ?? failure.index,
        })),
        error: null,
        seen: openResultsJobId.current === job.id,
      });
    } catch (caught) {
      updateJob(job.id, {
        status: "error",
        error: displayError(caught, "採点に失敗しました。"),
        seen: openResultsJobId.current === job.id,
      });
    }
  }, [onRecorded, updateJob]);

  const start = useCallback(async (
    categories: string[],
    limit: number,
    format: QuizFormatRequest,
    mode: "daily" | "custom" = "custom",
  ) => {
    setStage("loading");
    setError(null);
    setViewingJobId(null);
    setRequestedCount(0);
    setGenerationFailures([]);
    try {
      const {
        items, reason, early: isEarly, requestedCount: requested, generationFailures: generationErrors,
      } = await startQuiz(categories, limit, format, mode, gradingIds);
      if (items.length === 0) {
        setQuestions([]);
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
  }, [gradingIds]);

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

  /** 採点を待たずに結果画面へ移る。採点はバックグラウンドで進む。 */
  const submit = useCallback(() => {
    if (questions.length === 0) return;
    const job: GradingJob = {
      id: nextJobId.current++,
      questions,
      answers,
      skipped,
      requestedCount,
      generationFailures,
      status: "grading",
      results: [],
      failures: [],
      error: null,
      seen: true,
    };
    setJobs((current) => [...current, job]);
    setViewingJobId(job.id);
    setQuestions([]);
    setAnswers({});
    setSkipped({});
    setIndex(0);
    setError(null);
    setStage("results");
    openResultsJobId.current = job.id;
    void runGrading(job);
  }, [questions, answers, skipped, requestedCount, generationFailures, runGrading]);

  const retryJob = useCallback((id: number) => {
    const job = jobs.find((candidate) => candidate.id === id);
    if (!job || job.status !== "error") return;
    const retried: GradingJob = { ...job, status: "grading", error: null };
    updateJob(id, { status: "grading", error: null });
    // 出題トークンのnonceで重複記録はDB側が防ぐため、同じ回答をそのまま再送できる。
    void runGrading(retried);
  }, [jobs, runGrading, updateJob]);

  const viewJob = useCallback((id: number) => {
    setViewingJobId(id);
    setJobs((current) => current.map((job) => job.id === id && job.status !== "grading" ? { ...job, seen: true } : job));
    setStage("results");
  }, []);

  const resumeQuiz = useCallback(() => {
    if (questions.length === 0) return;
    setViewingJobId(null);
    setStage("quiz");
  }, [questions.length]);

  const viewingJob = jobs.find((job) => job.id === viewingJobId) ?? null;

  const syncKnowledgeResult = useCallback((updated: Knowledge) => {
    setJobs((current) => current.map((job) => ({
      ...job,
      results: job.results.map((result) => result.id === updated.id
        ? {
          ...result,
          title: updated.title,
          category: updated.category,
          mastery: updated.mastery,
          priority: updated.priority,
          content_version: updated.content_version,
          next_review_on: updated.next_review_on,
          next_review_at: updated.next_review_at,
          stability_hours: updated.stability_hours,
          relearning_stage: updated.relearning_stage,
        }
        : result),
    })));
  }, []);

  /** 出題条件の選択へ戻る。採点中の回は結果の確認用に残す。 */
  const reset = useCallback(() => {
    setStage("setup");
    setQuestions([]);
    setAnswers({});
    setSkipped({});
    setIndex(0);
    setError(null);
    setEmptyReason(null);
    setEarly(false);
    setRequestedCount(0);
    setGenerationFailures([]);
    setViewingJobId(null);
    setJobs((current) => current.filter((job) => job.status === "grading" || !job.seen));
  }, []);

  return {
    stage, questions, answers, skipped, index, error, emptyReason, early,
    requestedCount, generationFailures, jobs, viewingJob, gradingIds,
    start, answerCurrent, skipCurrent, goNext, goBack, submit, reset, syncKnowledgeResult,
    retryJob, viewJob, resumeQuiz,
  };
}
