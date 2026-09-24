import { useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_QUIZ_FORMAT, DEFAULT_QUIZ_LIMIT, QUIZ_FORMAT_OPTIONS, QUIZ_LIMIT_OPTIONS, useQuiz, type GradingJob,
} from "../hooks/useQuiz";
import { MASTERY_ORDER, PRIORITY_ORDER } from "../constants";
import { addDeepDiveToInbox } from "../lib/api";
import { dashboardRoutePath } from "../lib/dashboardRoute";
import { KnowledgeDetailModal } from "./KnowledgeDetailModal";
import { KnowledgeFormModal } from "./KnowledgeFormModal";
import { ReviewCategoryCounts } from "./ReviewCategoryCounts";
import type {
  DailyReviewStatus, Knowledge, KnowledgeDraft, KnowledgePriority, Mastery, QuizFormatRequest, QuizGenerationFailure,
  QuizGradeResult, QuizLog, QuizQuestion,
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
    changes: Partial<KnowledgeDraft> | { archived: boolean },
  ) => Promise<Knowledge>;
}

type ResultEdit = Pick<KnowledgeDraft, "mastery" | "priority">;
type ResultChange = Partial<ResultEdit> | { archived: boolean };

type ResultEditFeedback = {
  id: string;
  status: "saving" | "saved" | "error";
  pending?: Partial<ResultEdit>;
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
  const [editFeedback, setEditFeedback] = useState<ResultEditFeedback | null>(null);
  const [archivedIds, setArchivedIds] = useState<ReadonlySet<string>>(() => new Set());
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
    setEditFeedback(null);
    setArchivedIds(new Set());
    quiz.reset();
  };

  const saveResultChange = async (result: QuizGradeResult, changes: ResultChange, savedMessage: string) => {
    if (editFeedback?.status === "saving") return;
    setEditFeedback({
      id: result.id,
      status: "saving",
      pending: "archived" in changes ? undefined : changes,
    });
    try {
      const updated = await onKnowledgeUpdate(result.id, result.content_version, changes);
      quiz.syncKnowledgeResult(updated);
      setArchivedIds((current) => {
        const next = new Set(current);
        if (updated.archived) next.add(updated.id);
        else next.delete(updated.id);
        return next;
      });
      setEditFeedback({ id: result.id, status: "saved", message: savedMessage });
    } catch (caught) {
      setEditFeedback({
        id: result.id,
        status: "error",
        message: caught instanceof Error ? caught.message : "保存に失敗しました。",
      });
    }
  };

  const changeResultField = (result: QuizGradeResult, changes: Partial<ResultEdit>) => {
    const unchanged = (Object.keys(changes) as (keyof ResultEdit)[])
      .every((key) => changes[key] === result[key]);
    if (unchanged) return;
    void saveResultChange(result, changes, "保存しました。");
  };

  const archiveResult = (result: QuizGradeResult) => {
    if (!window.confirm(`「${result.title}」をアーカイブしますか？\n今後の復習に出題されなくなります。`)) return;
    void saveResultChange(result, { archived: true }, "アーカイブしました。");
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

  const exit = () => {
    if (quiz.gradingIds.length > 0 && !window.confirm(
      "採点中の問題があります。採点と記録はこのまま続きますが、戻るとこの回の結果は表示できません。戻りますか？",
    )) return;
    onExit();
  };

  const startNextDaily = () => void quiz.start([], dailyStatus?.limit ?? DEFAULT_QUIZ_LIMIT, format, "daily");
  const otherJobs = quiz.jobs.filter((job) => job.id !== quiz.viewingJob?.id
    && (job.status === "grading" || !job.seen));

  return (
    <div className="quiz-page">
      <header className="quiz-header">
        <button className="text-button" onClick={exit}>← ダッシュボードへ戻る</button>
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

        {otherJobs.length > 0 && (
          <GradingJobsBanner jobs={otherJobs} onView={quiz.viewJob} onRetry={quiz.retryJob} />
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
                onClick={startNextDaily}
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
              {quiz.emptyReason === "in_grading"
                ? "今すぐ復習できる問題は、すべて採点中です。採点が終わるまでお待ちください。"
                : quiz.emptyReason === "done_today"
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

        {quiz.stage === "quiz" && quiz.generationFailures.length > 0 && (
          <GenerationFailureNotice
            requestedCount={quiz.requestedCount}
            deliveredCount={quiz.questions.length}
            failures={quiz.generationFailures}
          />
        )}

        {quiz.stage === "quiz" && quiz.questions[quiz.index] && (
          <QuizQuestionCard
            key={quiz.questions[quiz.index].id}
            index={quiz.index}
            total={quiz.questions.length}
            question={quiz.questions[quiz.index]}
            answer={quiz.answers[quiz.questions[quiz.index].id] ?? ""}
            skipped={quiz.skipped[quiz.questions[quiz.index].id] ?? false}
            onAnswer={quiz.answerCurrent}
            onSkip={quiz.skipCurrent}
            onBack={quiz.goBack}
            onNext={quiz.goNext}
            onSubmit={quiz.submit}
            isLast={quiz.index === quiz.questions.length - 1}
          />
        )}

        {quiz.stage === "results" && quiz.viewingJob && (() => {
          const job = quiz.viewingJob;
          return (
          <div className="quiz-results">
            {job.status === "grading" && (
              <div className="quiz-grading-status card" role="status">
                <span className="spinner" aria-hidden="true" />
                <div>
                  <strong>採点中…（{job.questions.filter((q) => !job.skipped[q.id]).length}問）</strong>
                  <span>採点はバックグラウンドで続きます。待つ間に次の復習を始められます。終わるとこの画面か上部の通知から結果を確認できます。</span>
                </div>
                <div className="quiz-grading-actions">
                  {quiz.questions.length > 0 ? (
                    <button className="primary-button" onClick={quiz.resumeQuiz}>解答中の問題に戻る</button>
                  ) : (
                    <button className="primary-button" disabled={dailyStatus?.remaining === 0} onClick={startNextDaily}>
                      待つ間に次の復習を始める
                    </button>
                  )}
                </div>
              </div>
            )}
            {job.status === "error" && job.error && (
              <div className="err compact quiz-generation-error" role="alert">
                <strong>{job.error.message}</strong>
                {job.error.reason && <p>{job.error.reason}</p>}
                {job.error.action && <p><b>対処:</b> {job.error.action}</p>}
                {job.error.reference && <small>問い合わせ用ID: {job.error.reference}</small>}
                <p className="muted">回答は保持しています。同じ回答で再採点しても二重には記録されません。</p>
                <button className="primary-button" onClick={() => quiz.retryJob(job.id)}>もう一度採点する</button>
              </div>
            )}
            {job.generationFailures.length > 0 && (
              <GenerationFailureNotice
                requestedCount={job.requestedCount}
                deliveredCount={job.questions.length}
                failures={job.generationFailures}
              />
            )}
            {job.failures.length > 0 && (
              <div className="quiz-partial-summary" role="status">
                <strong>
                  採点結果を{job.results.length}問表示し、{job.failures.length}問でエラーが発生しました。
                </strong>
                <span>正常な問題の採点は完了しています。エラー原因は該当する問題にだけ表示します。</span>
              </div>
            )}
            {Object.values(job.skipped).some(Boolean) && (
              <div className="quiz-skipped-summary" role="status">
                記録しなかった問題: {Object.values(job.skipped).filter(Boolean).length}問
              </div>
            )}
            {job.results.length > 0 && (
              <p className="quiz-results-note">
                習熟度・優先度の変更とアーカイブはこの画面で行えます。優先度は同じ期限内の出題順だけに使い、復習間隔は変えません。
              </p>
            )}
            <ul className="quiz-result-list">
              {job.status !== "grading" && job.questions.map((question, questionIndex) => {
                const result = job.results.find((r) => r.id === question.id);
                const failure = job.failures.find((item) => item.index === questionIndex);
                const userAnswer = job.answers[question.id] ?? "";
                const hasUserAnswer = userAnswer.trim().length > 0;
                if (job.skipped[question.id]) {
                  return (
                    <li key={question.id} className="quiz-result-item quiz-result-skipped card">
                      <div className="quiz-result-head">
                        <span className="badge quiz-verdict-skipped">記録なし</span>
                        <span className="quiz-result-format">{question.format}</span>
                      </div>
                      <p className="quiz-result-question">{question.question}</p>
                      <p className="muted">この問題は採点せず、復習履歴にも記録していません。</p>
                    </li>
                  );
                }
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
                const pending = editFeedback?.id === result.id && editFeedback.status === "saving"
                  ? editFeedback.pending
                  : undefined;
                const shown: ResultEdit = {
                  mastery: pending?.mastery ?? result.mastery,
                  priority: pending?.priority ?? result.priority,
                };
                const archived = archivedIds.has(result.id);
                const saving = editFeedback?.status === "saving";
                const editDisabled = saving || archived;
                const feedback = editFeedback?.id === result.id ? editFeedback : null;
                return (
                  <li key={question.id} className={`quiz-result-item card${archived ? " archived" : ""}`}>
                    <div className="quiz-result-head">
                      <span className={`badge ${VERDICT_CLASS[result.verdict] ?? ""}`}>{result.verdict}</span>
                      <span className="quiz-result-q">q{result.quality}</span>
                      <span className="quiz-result-format">{question.format}</span>
                      {!result.recorded && <span className="muted">（同じ回答はすでに記録済みです）</span>}
                      {archived && <span className="badge quiz-archived-badge">アーカイブ済み</span>}
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
                    <DeepDiveInbox knowledgeId={result.id} title={result.title} />
                    <div className="quiz-knowledge-panel">
                      <div className="quiz-edit-fields">
                        <label className="quiz-edit-control">
                          <span>習熟度</span>
                          <select
                            aria-label={`${result.title}の習熟度`}
                            value={shown.mastery}
                            disabled={editDisabled}
                            onChange={(event) => changeResultField(result, {
                              mastery: event.target.value as Mastery,
                            })}
                          >
                            {MASTERY_ORDER.map((mastery) => (
                              <option key={mastery} value={mastery}>{mastery}</option>
                            ))}
                          </select>
                        </label>
                        <label className="quiz-edit-control">
                          <span>優先度</span>
                          <select
                            aria-label={`${result.title}の優先度`}
                            value={shown.priority}
                            disabled={editDisabled}
                            onChange={(event) => changeResultField(result, {
                              priority: event.target.value as KnowledgePriority,
                            })}
                          >
                            {PRIORITY_ORDER.map((priority) => (
                              <option key={priority} value={priority}>{priority}</option>
                            ))}
                          </select>
                        </label>
                        {archived ? (
                          <button
                            className="quiz-archive-button"
                            disabled={saving}
                            onClick={() => void saveResultChange(result, { archived: false }, "復元しました。")}
                          >
                            元に戻す
                          </button>
                        ) : (
                          <button
                            className="danger-button quiz-archive-button"
                            disabled={saving}
                            onClick={() => archiveResult(result)}
                          >
                            アーカイブ
                          </button>
                        )}
                      </div>
                      <div className="quiz-edit-feedback" aria-live="polite">
                        {feedback?.status === "saving" && "保存中…"}
                        {feedback?.status === "saved" && feedback.message}
                        {feedback?.status === "error" && (
                          <span className="quiz-edit-error">{feedback.message}</span>
                        )}
                      </div>
                      <p className="quiz-next-review">
                        {result.schedule_updated
                          ? `次回: ${formatReviewTime(result.next_review_at)}（${QUALITY_INTERVAL_LABEL[result.quality] ?? "定着間隔に応じて調整"}）`
                          : `次回: ${formatReviewTime(result.next_review_at)}（期限前の正解のため予定は据え置き）`}
                        {result.relearning_stage === "recognition" && "・次は四択で再認"}
                        {result.relearning_stage === "recall" && "・次は一問一答で想起"}
                      </p>
                      <dl className="quiz-knowledge-meta">
                        <div>
                          <dt>ナレッジID</dt>
                          <dd><code>{result.id}</code></dd>
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
                        <span>本文・タグ・分類の編集も行えます。</span>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="quiz-result-actions">
              {quiz.questions.length > 0 && (
                <button className="primary-button" onClick={quiz.resumeQuiz}>解答中の問題に戻る</button>
              )}
              <button className={quiz.questions.length > 0 ? "" : "primary-button"} onClick={resetQuiz}>もう一度</button>
              <button onClick={exit}>ダッシュボードへ戻る</button>
            </div>
          </div>
          );
        })()}
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

function GradingJobsBanner({
  jobs, onView, onRetry,
}: {
  jobs: GradingJob[];
  onView: (id: number) => void;
  onRetry: (id: number) => void;
}) {
  return (
    <ul className="quiz-grading-banner" aria-live="polite">
      {jobs.map((job) => {
        const count = job.questions.filter((q) => !job.skipped[q.id]).length;
        if (job.status === "grading") {
          return (
            <li key={job.id} className="grading">
              <span className="spinner" aria-hidden="true" />
              <span>前の{count}問を採点中…</span>
            </li>
          );
        }
        if (job.status === "error") {
          return (
            <li key={job.id} className="error">
              <span>前の{count}問の採点に失敗しました。</span>
              <button className="text-button" onClick={() => onRetry(job.id)}>再採点</button>
              <button className="text-button" onClick={() => onView(job.id)}>詳細</button>
            </li>
          );
        }
        const correct = job.results.filter((result) => result.verdict === "正解").length;
        return (
          <li key={job.id} className="done">
            <span>前の{count}問の採点が完了しました（正解 {correct}/{job.results.length}）。</span>
            <button className="text-button" onClick={() => onView(job.id)}>結果を見る</button>
          </li>
        );
      })}
    </ul>
  );
}

const MAX_DEEP_DIVE_CHARS = 1_000;

function DeepDiveInbox({ knowledgeId, title }: { knowledgeId: string; title: string }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  const save = async () => {
    if (status === "saving" || !note.trim()) return;
    setStatus("saving");
    setMessage(null);
    try {
      await addDeepDiveToInbox(knowledgeId, note);
      setStatus("saved");
      setOpen(false);
    } catch (caught) {
      setStatus("error");
      setMessage(caught instanceof Error ? caught.message : "Inboxに登録できませんでした。");
    }
  };

  if (status === "saved") {
    return <p className="quiz-deep-dive-saved" role="status">深掘りしたい点をInboxに登録しました。Ideaの未整理Inboxから整理できます。</p>;
  }
  if (!open) {
    return (
      <button className="text-button quiz-deep-dive-toggle" onClick={() => setOpen(true)}>
        あとで深掘りする（Inboxへ登録）
      </button>
    );
  }
  return (
    <div className="quiz-deep-dive">
      <label>
        <span>深掘りしたい点</span>
        <textarea
          rows={3}
          value={note}
          maxLength={MAX_DEEP_DIVE_CHARS}
          placeholder="例: なぜ for ではなく of になるのか調べる"
          aria-label={`${title}について深掘りしたい点`}
          autoFocus
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      <small className="muted">「深掘り元: 復習「{title}」」を添えて未整理のInboxに入ります。採点結果や復習予定は変わりません。</small>
      {message && <p className="quiz-edit-error" role="alert">{message}</p>}
      <div className="quiz-deep-dive-actions">
        <button onClick={() => { setOpen(false); setMessage(null); }} disabled={status === "saving"}>やめる</button>
        <button className="primary-button" onClick={() => void save()} disabled={status === "saving" || !note.trim()}>
          {status === "saving" ? "登録中…" : "Inboxに登録"}
        </button>
      </div>
    </div>
  );
}

function GenerationFailureNotice({
  requestedCount, deliveredCount, failures,
}: {
  requestedCount: number;
  deliveredCount: number;
  failures: QuizGenerationFailure[];
}) {
  return (
    <div className="quiz-generation-summary" role="status">
      <strong>
        {requestedCount}問中{deliveredCount}問を出題します。{failures.length}問は生成エラーのためスキップしました。
      </strong>
      <span>追加のAI再生成は行っていません。</span>
      <details>
        <summary>エラー原因を表示</summary>
        <ul>
          {failures.map((failure) => (
            <li key={`${failure.position}-${failure.category}`}>
              {failure.position}問目（{failure.category}）: {failure.reason}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function QuizQuestionCard({
  index, total, question, answer, skipped, onAnswer, onSkip, onBack, onNext, onSubmit, isLast,
}: {
  index: number;
  total: number;
  question: QuizQuestion;
  answer: string;
  skipped: boolean;
  onAnswer: (text: string) => void;
  onSkip: (value: boolean) => void;
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
                disabled={skipped}
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
          disabled={skipped}
          maxLength={MAX_QUIZ_ANSWER_CHARS}
          placeholder={ANSWER_PLACEHOLDER[question.format]}
          autoFocus
          onChange={(event) => onAnswer(event.target.value)}
        />
      )}
      <label className={`quiz-skip-control${skipped ? " selected" : ""}`}>
        <input
          type="checkbox"
          checked={skipped}
          onChange={(event) => onSkip(event.target.checked)}
        />
        <span>この問題は採点・復習履歴に記録しない</span>
      </label>
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
