import { useCallback, useRef, useState } from "react";
import { discardReviewQuestion, serveReviewQuestions, submitReviewAnswer } from "../lib/api";
import type { QuizVerdict, ReviewAnswerResult, ReviewQuestion } from "../types";

export type ReviewStage = "setup" | "loading" | "question" | "feedback" | "done";

/** 1問ごとの結果。四択と無回答は回答時に記録済み、それ以外は採点待ち。 */
export interface ReviewOutcome {
  id: number;
  knowledge_id: string;
  status: "graded" | "answered" | "skipped" | "discarded";
  verdict: QuizVerdict | null;
}

/** 回答した直後に見せる答え合わせ。 */
export interface ReviewFeedback {
  question: ReviewQuestion;
  answer: string;
  accepted: ReviewAnswerResult;
}

/** 一度に受け取る問題数。使い切ったら次を自動で受け取る。 */
const SERVE_BATCH = 30;

/**
 * キューの上から順に解き続ける。回答は1問ごとにすぐ送るので、いつ終えても答えた分は残る。
 * 飛ばした問題は出題待ちのまま残り、この回では二度と出さず、次の復習でまた出る。
 */
export function useReviewSession(onAnswered?: () => void | Promise<void>) {
  const [stage, setStage] = useState<ReviewStage>("setup");
  const [questions, setQuestions] = useState<ReviewQuestion[]>([]);
  const [index, setIndex] = useState(0);
  const [outcomes, setOutcomes] = useState<ReviewOutcome[]>([]);
  const [feedback, setFeedback] = useState<ReviewFeedback | null>(null);
  const [exhausted, setExhausted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** この回で出した問題。飛ばした問題は出題待ちのまま残るので、手元で除く。 */
  const seen = useRef(new Set<number>());

  const loadNext = useCallback(async (): Promise<boolean> => {
    const served = await serveReviewQuestions(SERVE_BATCH);
    const fresh = served.filter((question) => !seen.current.has(question.id));
    if (fresh.length === 0) return false;
    setQuestions(fresh);
    setIndex(0);
    return true;
  }, []);

  const finish = useCallback((ranOut: boolean) => {
    setExhausted(ranOut);
    setFeedback(null);
    setStage("done");
    void onAnswered?.();
  }, [onAnswered]);

  const start = useCallback(async () => {
    seen.current = new Set();
    setOutcomes([]);
    setFeedback(null);
    setError(null);
    setStage("loading");
    try {
      if (await loadNext()) setStage("question");
      else finish(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "問題を取得できませんでした。");
      setStage("setup");
    }
  }, [finish, loadNext]);

  /** 次の問題へ。手元の問題を使い切ったら、キューから次を受け取る。 */
  const advance = useCallback(async () => {
    setFeedback(null);
    setError(null);
    if (index + 1 < questions.length) {
      setIndex(index + 1);
      setStage("question");
      return;
    }
    setStage("loading");
    try {
      if (await loadNext()) setStage("question");
      else finish(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "次の問題を取得できませんでした。");
      finish(false);
    }
  }, [finish, index, loadNext, questions.length]);

  const current = questions[index] ?? null;

  const answerCurrent = useCallback(async (answer: string) => {
    if (!current || busy) return;
    setBusy(true);
    setError(null);
    try {
      const accepted = await submitReviewAnswer(current.id, answer);
      seen.current.add(current.id);
      setOutcomes((list) => [...list, {
        id: current.id,
        knowledge_id: current.knowledge_id,
        status: accepted.status === "graded" ? "graded" : "answered",
        verdict: accepted.result?.verdict ?? null,
      }]);
      setFeedback({ question: current, answer: answer.trim(), accepted });
      setStage("feedback");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "回答を送信できませんでした。");
    } finally {
      setBusy(false);
    }
  }, [busy, current]);

  const skipCurrent = useCallback(() => {
    if (!current || busy) return;
    seen.current.add(current.id);
    setOutcomes((list) => [...list, { id: current.id, knowledge_id: current.knowledge_id, status: "skipped", verdict: null }]);
    void advance();
  }, [advance, busy, current]);

  const discardCurrent = useCallback(async () => {
    if (!current || busy) return;
    setBusy(true);
    setError(null);
    try {
      await discardReviewQuestion(current.id);
      seen.current.add(current.id);
      setOutcomes((list) => [...list, { id: current.id, knowledge_id: current.knowledge_id, status: "discarded", verdict: null }]);
      await advance();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "問題を取り下げられませんでした。");
    } finally {
      setBusy(false);
    }
  }, [advance, busy, current]);

  const reset = useCallback(() => {
    seen.current = new Set();
    setStage("setup");
    setQuestions([]);
    setOutcomes([]);
    setFeedback(null);
    setIndex(0);
    setError(null);
    setExhausted(false);
  }, []);

  return {
    stage, current, outcomes, feedback, exhausted, busy, error,
    start, answerCurrent, skipCurrent, discardCurrent, next: advance, stop: () => finish(false), reset,
  };
}
