import { useCallback, useState } from "react";
import { gradeQuiz, startQuiz } from "../lib/api";
import type { QuizEmptyReason, QuizGradeResult, QuizQuestion } from "../types";

export const QUIZ_LIMIT_OPTIONS = [5, 10, 15, 20, 30] as const;
export const DEFAULT_QUIZ_LIMIT = 15;

export type QuizStage = "setup" | "loading" | "empty" | "quiz" | "grading" | "results";

export function useQuiz() {
  const [stage, setStage] = useState<QuizStage>("setup");
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [index, setIndex] = useState(0);
  const [results, setResults] = useState<QuizGradeResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [emptyReason, setEmptyReason] = useState<QuizEmptyReason | null>(null);
  const [early, setEarly] = useState(false);

  const start = useCallback(async (categories: string[], limit: number) => {
    setStage("loading");
    setError(null);
    try {
      const { items, reason, early: isEarly } = await startQuiz(categories, limit);
      if (items.length === 0) {
        setEmptyReason(reason);
        setStage("empty");
        return;
      }
      setQuestions(items);
      setAnswers(Object.fromEntries(items.map((item) => [item.id, ""])));
      setIndex(0);
      setEarly(isEarly);
      setStage("quiz");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "出題に失敗しました。");
      setStage("setup");
    }
  }, []);

  const answerCurrent = useCallback((text: string) => {
    const current = questions[index];
    if (!current) return;
    setAnswers((prev) => ({ ...prev, [current.id]: text }));
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
      const payload = questions.map((q) => ({
        id: q.id,
        question: q.question,
        answer: answers[q.id] ?? "",
      }));
      const graded = await gradeQuiz(payload);
      setResults(graded);
      setStage("results");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "採点に失敗しました。");
      setStage("quiz");
    }
  }, [questions, answers]);

  const reset = useCallback(() => {
    setStage("setup");
    setQuestions([]);
    setAnswers({});
    setIndex(0);
    setResults([]);
    setError(null);
    setEmptyReason(null);
    setEarly(false);
  }, []);

  return {
    stage, questions, answers, index, results, error, emptyReason, early,
    start, answerCurrent, goNext, goBack, submit, reset,
  };
}
