import { useEffect, useMemo, useRef, useState } from "react";
import { runReviewBatch } from "../lib/api";
import { useReviewSession } from "../hooks/useReviewSession";
import type { Knowledge, ReviewBatchSummary, ReviewQuestion, ReviewQueueStatus } from "../types";
import { ReviewQueueSummary } from "./ReviewQueueSummary";

interface Props {
  knowledge: Knowledge[];
  queueStatus: ReviewQueueStatus | null;
  onExit: () => void;
  /** 回答・採点・生成のあとで、ダッシュボードの件数や履歴を読み直す。 */
  onRecorded: () => void | Promise<void>;
  onOpenResults: () => void;
  autoStartDaily?: boolean;
}

const DAILY_BATCH = 15;
const LIMIT_OPTIONS = [5, 10, 15, 20, 30] as const;
const MAX_ANSWER_CHARS = 2_000;

/** 形式ごとに、どこまで書けばよいかを入力欄のプレースホルダで伝える。 */
const ANSWER_PLACEHOLDER: Record<string, string> = {
  一問一答: "回答を入力",
  四択: "回答を入力",
  記述説明: "理由や使い分けまで含めて説明する",
  産出: "覚えた知識を実際に使って書く",
};


function batchMessage(summary: ReviewBatchSummary): string {
  if (summary.status === "busy") return summary.kind === "grade" ? "別の採点が実行中です。少し待ってから確認してください。" : "別の問題生成が実行中です。少し待ってから確認してください。";
  if (summary.kind === "grade") {
    if (summary.status === "skipped") return summary.note ?? "採点待ちの回答はありませんでした。";
    const base = `${summary.succeeded}件を採点しました。`;
    return summary.failed > 0 ? `${base}${summary.failed}件は採点できず、次の採点で再試行します。` : base;
  }
  if (summary.status === "skipped") return summary.note ?? "新しく作る問題はありませんでした。";
  if (summary.status === "failed" && summary.succeeded === 0) return `問題を作れませんでした。${summary.note ?? ""}`;
  const base = `${summary.succeeded}問を追加しました。`;
  return summary.failed > 0 ? `${base}${summary.failed}問は次の生成で作り直します。` : base;
}

/**
 * キューから出題する復習画面。問題の生成と採点はバッチで行うため、ここではAIを呼ばずに
 * 出題と回答の送信だけを行う。採点結果は学習ログで確認する。
 */
export function ReviewView({ knowledge, queueStatus, onExit, onRecorded, onOpenResults, autoStartDaily = false }: Props) {
  const session = useReviewSession(onRecorded);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [limit, setLimit] = useState<number>(DAILY_BATCH);
  const [answer, setAnswer] = useState("");
  const [batchBusy, setBatchBusy] = useState<"generate" | "grade" | null>(null);
  const [batchNotice, setBatchNotice] = useState<string | null>(null);
  /** この画面で採点を実行したら、採点待ちの件数はキュー全体の最新値で示す。 */
  const [gradedHere, setGradedHere] = useState(false);
  const autoStarted = useRef(false);

  const categories = useMemo(() => [...new Set(knowledge.map((item) => item.category))].sort(), [knowledge]);
  const titleById = useMemo(() => new Map(knowledge.map((item) => [item.id, item.title])), [knowledge]);
  const readyDue = queueStatus?.ready_due ?? 0;
  const nextDaily = Math.min(DAILY_BATCH, readyDue);

  useEffect(() => {
    if (!autoStartDaily || autoStarted.current || session.stage !== "setup") return;
    autoStarted.current = true;
    void session.start(DAILY_BATCH);
  }, [autoStartDaily, session]);

  useEffect(() => { setAnswer(""); }, [session.current?.id]);

  const runBatch = async (kind: "generate" | "grade") => {
    if (batchBusy) return;
    setBatchBusy(kind);
    setBatchNotice(null);
    try {
      setBatchNotice(batchMessage(await runReviewBatch(kind)));
      if (kind === "grade") setGradedHere(true);
    } catch (caught) {
      setBatchNotice(caught instanceof Error ? caught.message : "実行できませんでした。");
    } finally {
      setBatchBusy(null);
      await onRecorded();
    }
  };

  const toggleCategory = (category: string) => {
    setSelectedCategories((prev) => prev.includes(category)
      ? prev.filter((value) => value !== category)
      : [...prev, category]);
  };

  const backToSetup = () => {
    setBatchNotice(null);
    setGradedHere(false);
    session.reset();
  };

  const answered = session.outcomes.filter((outcome) => outcome.status !== "skipped");
  const graded = session.outcomes.filter((outcome) => outcome.status === "graded");
  const waiting = session.outcomes.filter((outcome) => outcome.status === "answered");
  const skipped = session.outcomes.filter((outcome) => outcome.status === "skipped");
  const waitingCount = gradedHere && queueStatus ? queueStatus.waiting_grading : waiting.length;

  const generateButton = (
    <button onClick={() => void runBatch("generate")} disabled={batchBusy !== null || queueStatus?.queue_full === true}>
      {batchBusy === "generate" ? "問題を作成中…" : "今すぐ問題を作る"}
    </button>
  );

  return (
    <div className="quiz-page">
      <header className="quiz-header">
        <button className="text-button" onClick={onExit}>← ダッシュボードへ戻る</button>
        <h1>復習</h1>
      </header>

      <main className="quiz-body">
        {session.error && <div className="err compact" role="alert">{session.error}</div>}
        {batchNotice && <div className="review-batch-notice" role="status">{batchNotice}</div>}

        {session.stage === "setup" && (
          <div className="quiz-setup card">
            <div className="daily-quiz-start">
              <div>
                <strong>今日の復習</strong>
                <span>{queueStatus ? `出題できる問題 ${readyDue}問` : "出題できる問題を確認中…"}</span>
              </div>
              <button className="primary-button" disabled={nextDaily === 0} onClick={() => void session.start(DAILY_BATCH)}>
                {nextDaily > 0 ? `次の${nextDaily}問を開始` : "今すぐ出題できる問題はありません"}
              </button>
            </div>
            <ReviewQueueSummary status={queueStatus} onOpenResults={onOpenResults} />
            <div className="review-batch-actions">{generateButton}</div>

            <div className="quiz-divider"><span>カテゴリを選んで出題</span></div>
            <p>出題できる問題の中から、選んだカテゴリだけを出します。出題形式は、知識の状態に合わせて自動で決まります。</p>
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
                {LIMIT_OPTIONS.map((value) => <option key={value} value={value}>{value}問</option>)}
              </select>
            </label>
            <button className="primary-button quiz-start-button" onClick={() => void session.start(limit, selectedCategories)}>
              出題する
            </button>
          </div>
        )}

        {session.stage === "loading" && <div className="msg">問題を準備中...</div>}

        {session.stage === "empty" && (
          <div className="quiz-setup card">
            <p>今すぐ出題できる問題はありません。</p>
            <p className="muted">
              {queueStatus && queueStatus.ready_total > 0
                ? `期限前の問題が${queueStatus.ready_total}問あります。期限が来ると出題されます。`
                : "問題は30分ごとに自動で作られます。すぐに解きたいときは、今すぐ作ることもできます。"}
            </p>
            <div className="review-batch-actions">
              {generateButton}
              <button className="primary-button" onClick={backToSetup}>戻る</button>
            </div>
          </div>
        )}

        {session.stage === "question" && session.current && (
          <ReviewQuestionCard
            key={session.current.id}
            index={session.index}
            total={session.questions.length}
            question={session.current}
            answer={answer}
            submitting={session.submitting}
            onAnswer={setAnswer}
            onSubmit={() => void session.answerCurrent(answer)}
            onSkip={session.skipCurrent}
          />
        )}

        {session.stage === "done" && (
          <div className="quiz-setup card review-done">
            <h2>{answered.length}問に回答しました</h2>
            <ul className="review-done-counts">
              <li><strong>{graded.length}</strong><span>その場で記録（四択・無回答）</span></li>
              <li><strong>{waitingCount}</strong><span>{gradedHere ? "採点待ち（全体）" : "採点待ち"}</span></li>
              {skipped.length > 0 && <li><strong>{skipped.length}</strong><span>スキップ（次回また出ます）</span></li>}
            </ul>
            {graded.length > 0 && (
              <p className="muted">
                その場で記録した分: 正解 {graded.filter((outcome) => outcome.verdict === "正解").length}問
                {graded.some((outcome) => outcome.verdict !== "正解") && (
                  <>（{graded.filter((outcome) => outcome.verdict !== "正解")
                    .map((outcome) => titleById.get(outcome.knowledge_id) ?? "削除されたナレッジ").join("、")} は要復習）</>
                )}
              </p>
            )}
            <p className="muted">
              採点待ちの回答は15分ごとに自動で採点されます。結果と講評は学習ログで確認できます。
            </p>
            <div className="review-batch-actions">
              {waitingCount > 0 && (
                <button className="primary-button" onClick={() => void runBatch("grade")} disabled={batchBusy !== null}>
                  {batchBusy === "grade" ? "採点中…" : "今すぐ採点する"}
                </button>
              )}
              <button onClick={onOpenResults}>学習ログで結果を見る</button>
              <button onClick={backToSetup} disabled={batchBusy !== null}>復習の最初に戻る</button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function ReviewQuestionCard({
  index, total, question, answer, submitting, onAnswer, onSubmit, onSkip,
}: {
  index: number;
  total: number;
  question: ReviewQuestion;
  answer: string;
  submitting: boolean;
  onAnswer: (text: string) => void;
  onSubmit: () => void;
  onSkip: () => void;
}) {
  const isLast = index === total - 1;
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
            <label key={choice} className={`quiz-choice${answer === choice ? " selected" : ""}`}>
              <input
                type="radio"
                name={`choice-${question.id}`}
                value={choice}
                checked={answer === choice}
                disabled={submitting}
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
          disabled={submitting}
          maxLength={MAX_ANSWER_CHARS}
          placeholder={ANSWER_PLACEHOLDER[question.format]}
          autoFocus
          onChange={(event) => onAnswer(event.target.value)}
        />
      )}
      <p className="muted review-answer-hint">
        空欄のまま送ると「思い出せなかった」として記録します。答えずに飛ばすと、この問題は次の復習でまた出ます。
      </p>
      <div className="quiz-question-actions">
        <button onClick={onSkip} disabled={submitting}>スキップ</button>
        <button className="primary-button" onClick={onSubmit} disabled={submitting}>
          {submitting ? "送信中…" : isLast ? "回答して終える" : "回答して次へ →"}
        </button>
      </div>
    </div>
  );
}
