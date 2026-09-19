import { useCallback, useState } from "react";
import { gradeQuiz, startQuiz } from "../lib/api";
import type { QuizGradeResult, QuizMode, QuizQuestion } from "../types";

export const QUIZ_LIMIT = 15;

export type QuizStage = "setup" | "loading" | "empty" | "quiz" | "grading" | "results";

export function useQuiz() {
  const [stage, setStage] = useState<QuizStage>("setup");
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [index, setIndex] = useState(0);
  const [results, setResults] = useState<QuizGradeResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(async (mode: QuizMode) => {
    setStage("loading");
    setError(null);
    try {
      const items = await startQuiz(mode, QUIZ_LIMIT);
      if (items.length === 0) {
        setStage("empty");
        return;
      }
      setQuestions(items);
      setAnswers(Object.fromEntries(items.map((item) => [item.id, ""])));
      setIndex(0);
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
      const payload = questions.map((q) => ({ id: q.id, answer: answers[q.id] ?? "" }));
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
  }, []);

  return {
    stage, questions, answers, index, results, error,
    start, answerCurrent, goNext, goBack, submit, reset,
  };
}
