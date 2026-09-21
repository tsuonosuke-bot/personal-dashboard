import { useMemo, useState } from "react";
import {
  DEFAULT_QUIZ_FORMAT, DEFAULT_QUIZ_LIMIT, QUIZ_FORMAT_OPTIONS, QUIZ_LIMIT_OPTIONS, useQuiz,
} from "../hooks/useQuiz";
import { PRIORITY_INTERVAL_HINTS, PRIORITY_ORDER } from "../constants";
import { KnowledgeDetailModal } from "./KnowledgeDetailModal";
import { KnowledgeFormModal } from "./KnowledgeFormModal";
import type {
  Knowledge, KnowledgeDraft, KnowledgePriority, QuizFormatRequest, QuizGradeResult, QuizLog,
  QuizQuestion,
} from "../types";

/** 形式ごとに、どこまで書けばよいかを入力欄のプレースホルダで伝える。 */
const ANSWER_PLACEHOLDER: Record<string, string> = {
  一問一答: "回答を入力",
  四択: "回答を入力",
  記述説明: "理由や使い分けまで含めて説明する",
  産出: "覚えた知識を実際に使って書く",
};

const VERDICT_CLASS: Record<string, string> = {
  正解: "quiz-verdict-ok",
  部分正解: "quiz-verdict-partial",
  不正解: "quiz-verdict-ng",
};

interface Props {
  knowledge: Knowledge[];
  quizLog: QuizLog[];
  onExit: () => void;
  onRecorded: () => void | Promise<void>;
  onKnowledgeUpdate: (
    id: string,
    expectedVersion: number,
    changes: Partial<KnowledgeDraft>,
  ) => Promise<Knowledge>;
}

type PriorityFeedback = {
  id: string;
  status: "saving" | "saved" | "error";
  priority?: KnowledgePriority;
  message?: string;
};

export function QuizView({
  knowledge, quizLog, onExit, onRecorded, onKnowledgeUpdate,
}: Props) {
  const quiz = useQuiz(onRecorded);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [limit, setLimit] = useState<number>(DEFAULT_QUIZ_LIMIT);
  const [format, setFormat] = useState<QuizFormatRequest>(DEFAULT_QUIZ_FORMAT);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<Knowledge | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [priorityFeedback, setPriorityFeedback] = useState<PriorityFeedback | null>(null);

  const categories = useMemo(
    () => [...new Set(knowledge.map((item) => item.category))].sort(),
    [knowledge],
  );
  const detail = knowledge.find((item) => item.id === detailId) ?? null;

  const toggleCategory = (category: string) => {
    setSelectedCategories((prev) => prev.includes(category)
      ? prev.filter((value) => value !== category)
      : [...prev, category]);
  };

  const resetQuiz = () => {
    setPriorityFeedback(null);
    quiz.reset();
  };

  const changePriority = async (result: QuizGradeResult, priority: KnowledgePriority) => {
    if (priority === result.priority || priorityFeedback?.status === "saving") return;
    setPriorityFeedback({ id: result.id, status: "saving", priority });
    try {
      const updated = await onKnowledgeUpdate(result.id, result.content_version, { priority });
      quiz.syncKnowledgeResult(updated);
      setPriorityFeedback({ id: result.id, status: "saved" });
    } catch (caught) {
      setPriorityFeedback({
        id: result.id,
        status: "error",
        message: caught instanceof Error ? caught.message : "優先度の保存に失敗しました。",
      });
    }
  };

  const openEdit = (item: Knowledge) => {
    setDetailId(null);
    setEditError(null);
    setEditTarget(item);
  };

  const closeEdit = () => {
    const id = editTarget?.id ?? null;
    setEditTarget(null);
    setEditError(null);
    setDetailId(id);
  };

  const saveEdit = async (draft: KnowledgeDraft) => {
    if (!editTarget || editSaving) return;
    setEditSaving(true);
    setEditError(null);
    try {
      const updated = await onKnowledgeUpdate(
        editTarget.id,
        editTarget.content_version,
        draft,
      );
      quiz.syncKnowledgeResult(updated);
      setEditTarget(null);
      setDetailId(updated.id);
    } catch (caught) {
      setEditError(caught instanceof Error ? caught.message : "保存に失敗しました。");
    } finally {
      setEditSaving(false);
    }
  };

  return (
    <div className="quiz-page">
      <header className="quiz-header">
        <button className="text-button" onClick={onExit}>← ダッシュボードへ戻る</button>
        <h1>復習クイズ</h1>
      </header>

      <main className="quiz-body">
        {quiz.error && <div className="err compact" role="alert">{quiz.error}</div>}

        {quiz.stage === "setup" && (
          <div className="quiz-setup card">
            <p>出題するカテゴリ・問題数・形式を選んでください。</p>
            <div className="quiz-category-select" role="group" aria-label="出題カテゴリ">
              <button
                aria-pressed={selectedCategories.length === 0}
                className={selectedCategories.length === 0 ? "active" : ""}
                onClick={() => setSelectedCategories([])}
              >
                すべて
              </button>
              {categories.map((category) => (
                <button
                  key={category}
                  aria-pressed={selectedCategories.includes(category)}
                  className={selectedCategories.includes(category) ? "active" : ""}
                  onClick={() => toggleCategory(category)}
                >
                  {category}
                </button>
              ))}
            </div>
            <label className="quiz-limit-select">
              問題数
              <select value={limit} onChange={(event) => setLimit(Number(event.target.value))}>
                {QUIZ_LIMIT_OPTIONS.map((value) => (
                  <option key={value} value={value}>{value}問</option>
                ))}
              </select>
            </label>
            <label className="quiz-limit-select">
              出題形式
              <select
                value={format}
                onChange={(event) => setFormat(event.target.value as QuizFormatRequest)}
              >
                {QUIZ_FORMAT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <p className="quiz-format-hint muted">
              {QUIZ_FORMAT_OPTIONS.find((option) => option.value === format)?.hint}
            </p>
            <button
              className="primary-button quiz-start-button"
              onClick={() => void quiz.start(selectedCategories, limit, format)}
            >
              出題する
            </button>
          </div>
        )}

        {quiz.stage === "loading" && <div className="msg">出題を準備中...</div>}

        {quiz.stage === "empty" && (
          <div className="quiz-setup card">
            <p>
              {quiz.emptyReason === "done_today"
                ? "本日の出題は終わっています。選んだカテゴリは全問採点済みです。"
                : "選んだカテゴリに出題できるナレッジがありません。"}
            </p>
            <button className="primary-button" onClick={resetQuiz}>戻る</button>
          </div>
        )}

        {quiz.stage === "quiz" && quiz.early && (
          <p className="quiz-early-note">本日期限の分はないので、復習日が近い順に出します。</p>
        )}

        {quiz.stage === "quiz" && quiz.questions[quiz.index] && (
          <QuizQuestionCard
            key={quiz.questions[quiz.index].id}
            index={quiz.index}
            total={quiz.questions.length}
            question={quiz.questions[quiz.index]}
            answer={quiz.answers[quiz.questions[quiz.index].id] ?? ""}
            onAnswer={quiz.answerCurrent}
            onBack={quiz.goBack}
            onNext={quiz.goNext}
            onSubmit={() => void quiz.submit()}
            isLast={quiz.index === quiz.questions.length - 1}
          />
        )}

        {quiz.stage === "grading" && <div className="msg">採点中...</div>}

        {quiz.stage === "results" && (
          <div className="quiz-results">
            <ul className="quiz-result-list">
              {quiz.questions.map((question) => {
                const result = quiz.results.find((r) => r.id === question.id);
                if (!result) return null;
                const displayedPriority = priorityFeedback?.id === result.id
                  && priorityFeedback.status === "saving"
                  && priorityFeedback.priority
                  ? priorityFeedback.priority
                  : result.priority;
                return (
                  <li key={question.id} className="quiz-result-item card">
                    <div className="quiz-result-head">
                      <span className={`badge ${VERDICT_CLASS[result.verdict] ?? ""}`}>{result.verdict}</span>
                      <span className="quiz-result-q">q{result.quality}</span>
                      <span className="quiz-result-format">{question.format}</span>
                      {!result.recorded && <span className="muted">（本日分は記録済み）</span>}
                    </div>
                    <p className="quiz-result-question">{question.question}</p>
                    <div className="content-block">
                      <h3>正解</h3>
                      <p>{result.correct_answer}</p>
                      <p className="quiz-result-source">
                        出典:{" "}
                        {knowledge.some((item) => item.id === result.id) ? (
                          <button className="text-button" onClick={() => setDetailId(result.id)}>
                            {result.title}
                          </button>
                        ) : result.title}
                      </p>
                    </div>
                    <div className="content-block">
                      <h3>解説</h3>
                      <p>{result.explanation}</p>
                    </div>
                    <div className="quiz-priority-panel">
                      <label className="quiz-priority-control">
                        <span>優先度</span>
                        <select
                          aria-label={`${result.title}の優先度`}
                          value={displayedPriority}
                          disabled={priorityFeedback?.status === "saving"}
                          onChange={(event) => void changePriority(
                            result,
                            event.target.value as KnowledgePriority,
                          )}
                        >
                          {PRIORITY_ORDER.map((priority) => (
                            <option key={priority} value={priority}>{priority}</option>
                          ))}
                        </select>
                      </label>
                      <p className="quiz-priority-hint">
                        {PRIORITY_INTERVAL_HINTS[displayedPriority]}。予定がある場合は次回復習日も更新されます。
                      </p>
                      {result.next_review_on && (
                        <p className="quiz-next-review">次回復習日: {result.next_review_on}</p>
                      )}
                      <div className="quiz-priority-feedback" aria-live="polite">
                        {priorityFeedback?.id === result.id && priorityFeedback.status === "saving" && "保存中…"}
                        {priorityFeedback?.id === result.id && priorityFeedback.status === "saved" && "保存しました。"}
                        {priorityFeedback?.id === result.id && priorityFeedback.status === "error" && (
                          <span className="quiz-priority-error">{priorityFeedback.message}</span>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="quiz-result-actions">
              <button className="primary-button" onClick={resetQuiz}>もう一度</button>
              <button onClick={onExit}>ダッシュボードへ戻る</button>
            </div>
          </div>
        )}
      </main>

      {detail && (
        <KnowledgeDetailModal
          knowledge={detail}
          quizLog={quizLog}
          mutating={false}
          onClose={() => setDetailId(null)}
          onEdit={() => openEdit(detail)}
        />
      )}
      {editTarget && (
        <KnowledgeFormModal
          key={editTarget.id}
          knowledge={editTarget}
          categories={categories}
          saving={editSaving}
          error={editError}
          onClose={closeEdit}
          onSave={saveEdit}
        />
      )}
    </div>
  );
}

function QuizQuestionCard({
  index, total, question, answer, onAnswer, onBack, onNext, onSubmit, isLast,
}: {
  index: number;
  total: number;
  question: QuizQuestion;
  answer: string;
  onAnswer: (text: string) => void;
  onBack: () => void;
  onNext: () => void;
  onSubmit: () => void;
  isLast: boolean;
}) {
  return (
    <div className="quiz-question card">
      <p className="quiz-progress">
        {index + 1} / {total}
        <span className="quiz-question-format">{question.format}</span>
      </p>
      <p className="quiz-question-text">{question.question}</p>
      {question.choices ? (
        <div className="quiz-choices" role="radiogroup" aria-label="選択肢">
          {question.choices.map((choice) => (
            <label
              key={choice}
              className={`quiz-choice${answer === choice ? " selected" : ""}`}
            >
              <input
                type="radio"
                name={`choice-${question.id}`}
                value={choice}
                checked={answer === choice}
                onChange={() => onAnswer(choice)}
              />
              <span>{choice}</span>
            </label>
          ))}
        </div>
      ) : (
        <textarea
          className="quiz-answer-input"
          rows={question.format === "一問一答" ? 3 : 6}
          value={answer}
          placeholder={ANSWER_PLACEHOLDER[question.format]}
          autoFocus
          onChange={(event) => onAnswer(event.target.value)}
        />
      )}
      <div className="quiz-question-actions">
        <button onClick={onBack} disabled={index === 0}>← 前へ</button>
        {isLast ? (
          <button className="primary-button" onClick={onSubmit}>採点する</button>
        ) : (
          <button className="primary-button" onClick={onNext}>次へ →</button>
        )}
      </div>
    </div>
  );
}
