import { useCallback, useState } from "react";
import { serveReviewQuestions, submitReviewAnswer } from "../lib/api";
import type { QuizVerdict, ReviewQuestion } from "../types";

export type ReviewStage = "setup" | "loading" | "empty" | "question" | "done";

/** 1問ごとの結果。四択と無回答は回答時に記録済み、それ以外は採点待ち。 */
export interface ReviewOutcome {
  id: number;
  knowledge_id: string;
  status: "graded" | "answered" | "skipped";
  verdict: QuizVerdict | null;
}

/**
 * キューから出題された問題に1問ずつ答える。回答は1問ごとにすぐ送るので、途中で閉じても
 * 答えた分は失われない。答えずに飛ばした問題は出題待ちのまま残り、次の復習でまた出る。
 */
export function useReviewSession(onAnswered?: () => void | Promise<void>) {
  const [stage, setStage] = useState<ReviewStage>("setup");
  const [questions, setQuestions] = useState<ReviewQuestion[]>([]);
  const [index, setIndex] = useState(0);
  const [outcomes, setOutcomes] = useState<ReviewOutcome[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(async (limit: number, categories: string[] = []) => {
    setStage("loading");
    setError(null);
    setOutcomes([]);
    setIndex(0);
    try {
      const served = await serveReviewQuestions(limit, categories);
      setQuestions(served);
      setStage(served.length > 0 ? "question" : "empty");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "問題を取得できませんでした。");
      setStage("setup");
    }
  }, []);

  const advance = useCallback((outcome: ReviewOutcome) => {
    setOutcomes((current) => [...current, outcome]);
    setError(null);
    if (index + 1 < questions.length) {
      setIndex(index + 1);
    } else {
      setStage("done");
      void onAnswered?.();
    }
  }, [index, onAnswered, questions.length]);

  const answerCurrent = useCallback(async (answer: string) => {
    const current = questions[index];
    if (!current || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const accepted = await submitReviewAnswer(current.id, answer);
      advance({
        id: current.id,
        knowledge_id: current.knowledge_id,
        status: accepted.status === "graded" ? "graded" : "answered",
        verdict: accepted.result?.verdict ?? null,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "回答を送信できませんでした。");
    } finally {
      setSubmitting(false);
    }
  }, [advance, index, questions, submitting]);

  const skipCurrent = useCallback(() => {
    const current = questions[index];
    if (!current || submitting) return;
    advance({ id: current.id, knowledge_id: current.knowledge_id, status: "skipped", verdict: null });
  }, [advance, index, questions, submitting]);

  const reset = useCallback(() => {
    setStage("setup");
    setQuestions([]);
    setOutcomes([]);
    setIndex(0);
    setError(null);
  }, []);

  return { stage, questions, index, current: questions[index] ?? null, outcomes, submitting, error, start, answerCurrent, skipCurrent, reset };
}
