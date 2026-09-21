import { useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_QUIZ_FORMAT, DEFAULT_QUIZ_LIMIT, QUIZ_FORMAT_OPTIONS, QUIZ_LIMIT_OPTIONS, useQuiz,
} from "../hooks/useQuiz";
import { PRIORITY_INTERVAL_HINTS, PRIORITY_ORDER } from "../constants";
import { dashboardRoutePath } from "../lib/dashboardRoute";
import { KnowledgeDetailModal } from "./KnowledgeDetailModal";
import { KnowledgeFormModal } from "./KnowledgeFormModal";
import { ReviewCategoryCounts } from "./ReviewCategoryCounts";
import type {
  DailyReviewStatus, Knowledge, KnowledgeDraft, KnowledgePriority, QuizFormatRequest, QuizGradeResult, QuizLog,
  QuizQuestion,
} from "../types";

/** 形式ごとに、どこまで書けばよいかを入力欄のプレースホルダで伝える。 */
const ANSWER_PLACEHOLDER: Record<string, string> = {
  一問一答: "回答を入力",
  四択: "回答を入力",
  記述説明: "理由や使い分けまで含めて説明する",
  産出: "覚えた知識を実際に使って書く",
};
const MAX_QUIZ_ANSWER_CHARS = 2_000;

const VERDICT_CLASS: Record<string, string> = {
  正解: "quiz-verdict-ok",
  部分正解: "quiz-verdict-partial",
  不正解: "quiz-verdict-ng",
};

const QUALITY_INTERVAL_LABEL: Record<number, string> = {
  0: "10分後",
  1: "30分後",
  2: "6時間後",
  3: "12時間後",
  4: "1日以上",
  5: "3日以上",
};

const FAILURE_PHASE_LABEL: Record<string, string> = {
  verification: "問題の確認",
  grading: "AI採点",
  recording: "採点結果の保存",
  confirmation: "保存後の確認",
};

function formatReviewTime(value: string): string {
  return new Date(value).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface Props {
  knowledge: Knowledge[];
  quizLog: QuizLog[];
  onExit: () => void;
  onRecorded: () => void | Promise<void>;
  autoStartDaily?: boolean;
  dailyStatus: DailyReviewStatus | null;
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
  knowledge, quizLog, onExit, onRecorded, onKnowledgeUpdate, autoStartDaily = false, dailyStatus,
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
  const autoStarted = useRef(false);

  const categories = useMemo(
    () => [...new Set(knowledge.map((item) => item.category))].sort(),
    [knowledge],
  );
  const detail = knowledge.find((item) => item.id === detailId) ?? null;

  useEffect(() => {
    if (!autoStartDaily || autoStarted.current || quiz.stage !== "setup") return;
    autoStarted.current = true;
    void quiz.start([], dailyStatus?.limit ?? DEFAULT_QUIZ_LIMIT, DEFAULT_QUIZ_FORMAT, "daily");
  }, [autoStartDaily, dailyStatus?.limit, quiz]);

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
        <h1>復習</h1>
      </header>

      <main className="quiz-body">
        {quiz.error && (
          <div className="err compact quiz-generation-error" role="alert">
            <strong>{quiz.error.message}</strong>
            {(quiz.error.stage || quiz.error.reason) && (
              <dl>
                {quiz.error.stage && (
                  <div>
                    <dt>失敗した処理</dt>
                    <dd>{quiz.error.stage}</dd>
                  </div>
                )}
                {quiz.error.reason && (
                  <div>
                    <dt>原因</dt>
                    <dd>{quiz.error.reason}</dd>
                  </div>
                )}
              </dl>
            )}
            {quiz.error.details.length > 0 && (
              <div className="quiz-generation-error-details">
                <span>該当項目</span>
                <ul>
                  {quiz.error.details.map((detail, index) => <li key={`${index}-${detail}`}>{detail}</li>)}
                </ul>
              </div>
            )}
            {quiz.error.action && <p><b>対処:</b> {quiz.error.action}</p>}
            {quiz.error.reference && <small>問い合わせ用ID: {quiz.error.reference}</small>}
          </div>
        )}

        {quiz.stage === "setup" && (
          <div className="quiz-setup card">
            <div className="daily-quiz-start">
              <div>
                <strong>今日の復習キュー</strong>
                <span>
                  {dailyStatus
                    ? `今日${dailyStatus.completed}件実施・今すぐ${dailyStatus.remaining}件`
                    : "1回15件ずつ、復習対象がある限り続行"}
                </span>
              </div>
              <button
                className="primary-button"
                disabled={dailyStatus?.remaining === 0}
                onClick={() => void quiz.start([], dailyStatus?.limit ?? DEFAULT_QUIZ_LIMIT, format, "daily")}
              >
                {dailyStatus?.remaining
                  ? `次の${Math.min(dailyStatus.limit, dailyStatus.remaining)}件を開始`
                  : "今すぐの復習は完了"}
              </button>
            </div>
            {dailyStatus && (
              <ReviewCategoryCounts
                items={dailyStatus.remaining_by_category}
                total={dailyStatus.remaining}
              />
            )}
            <div className="quiz-divider"><span>カスタム出題</span></div>
            <p>カテゴリ・問題数・形式を指定して出題できます。</p>
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
              onClick={() => void quiz.start(selectedCategories, limit, format, "custom")}
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
                ? dailyStatus?.retry_waiting
                  ? `今すぐ復習できる問題はありません。${dailyStatus.retry_waiting}件が段階別の再復習時刻を待っています。`
                  : "今すぐ復習できる問題はありません。"
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
            {quiz.failures.length > 0 && (
              <div className="quiz-partial-summary" role="status">
                <strong>
                  採点結果を{quiz.results.length}問表示し、{quiz.failures.length}問でエラーが発生しました。
                </strong>
                <span>正常な問題の採点は完了しています。エラー原因は該当する問題にだけ表示します。</span>
              </div>
            )}
            <ul className="quiz-result-list">
              {quiz.questions.map((question, questionIndex) => {
                const result = quiz.results.find((r) => r.id === question.id);
                const failure = quiz.failures.find((item) => item.index === questionIndex);
                const userAnswer = quiz.answers[question.id] ?? "";
                const hasUserAnswer = userAnswer.trim().length > 0;
                if (!result) {
                  if (!failure) return null;
                  return (
                    <li key={question.id} className="quiz-result-item quiz-result-failure card">
                      <div className="quiz-result-head">
                        <span className="badge quiz-verdict-error">採点エラー</span>
                        <span className="quiz-result-format">{question.format}</span>
                        <span className="quiz-failure-phase">
                          {FAILURE_PHASE_LABEL[failure.phase] ?? failure.phase}
                        </span>
                      </div>
                      <p className="quiz-result-question">{question.question}</p>
                      <div className="content-block quiz-user-answer-block">
                        <h3>あなたの回答</h3>
                        <p className={`quiz-user-answer${hasUserAnswer ? "" : " unanswered"}`}>
                          {hasUserAnswer ? userAnswer : "（未回答）"}
                        </p>
                      </div>
                      <div className="content-block quiz-failure-reason" role="alert">
                        <h3>原因</h3>
                        <p>{failure.error}</p>
                        <p className="muted">
                          {failure.recorded === true
                            ? "採点結果は保存済みです。"
                            : failure.recorded === false
                              ? "この問題の採点結果は保存されていません。"
                              : "通信結果が不明なため、保存成否を確認できませんでした。"}
                        </p>
                      </div>
                    </li>
                  );
                }
                const knowledgeHref = dashboardRoutePath(window.location.href, {
                  kind: "knowledge",
                  knowledgeId: result.id,
                });
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
                      {!result.recorded && <span className="muted">（同じ回答はすでに記録済みです）</span>}
                    </div>
                    <p className="quiz-result-question">{question.question}</p>
                    <div className="content-block quiz-user-answer-block">
                      <h3>あなたの回答</h3>
                      <p className={`quiz-user-answer${hasUserAnswer ? "" : " unanswered"}`}>
                        {hasUserAnswer ? userAnswer : "（未回答）"}
                      </p>
                    </div>
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
                    <div className="quiz-knowledge-panel">
                      <dl className="quiz-knowledge-meta">
                        <div>
                          <dt>ナレッジID</dt>
                          <dd><code>{result.id}</code></dd>
                        </div>
                        <div>
                          <dt>分類</dt>
                          <dd>{result.category}</dd>
                        </div>
                      </dl>
                      <div className="quiz-knowledge-actions">
                        <a
                          className="quiz-knowledge-link"
                          href={knowledgeHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`${result.title}の詳細・編集画面を新しいタブで開く`}
                        >
                          詳細・編集を新しいタブで開く ↗
                        </a>
                        <span>習熟度の変更やアーカイブも行えます。</span>
                      </div>
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
                        {PRIORITY_INTERVAL_HINTS[displayedPriority]}。優先度は出題順だけに使い、復習間隔は変えません。
                      </p>
                      <p className="quiz-next-review">
                        {result.schedule_updated
                          ? `次回: ${formatReviewTime(result.next_review_at)}（${QUALITY_INTERVAL_LABEL[result.quality] ?? "定着間隔に応じて調整"}）`
                          : `次回: ${formatReviewTime(result.next_review_at)}（期限前の正解のため予定は据え置き）`}
                        {result.relearning_stage === "recognition" && "・次は四択で再認"}
                        {result.relearning_stage === "recall" && "・次は一問一答で想起"}
                      </p>
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
          maxLength={MAX_QUIZ_ANSWER_CHARS}
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
