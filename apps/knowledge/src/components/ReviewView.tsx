import { useEffect, useMemo, useRef, useState } from "react";
import { PRIORITY_ORDER } from "../constants";
import { runReviewBatch } from "../lib/api";
import { useReviewSession, type ReviewFeedback } from "../hooks/useReviewSession";
import type { Knowledge, KnowledgePriority, ReviewBatchSummary, ReviewQuestion, ReviewQueueStatus } from "../types";
import type { KnowledgeUpdate } from "./ReviewLogParts";
import { ReviewQueueSummary } from "./ReviewQueueSummary";

interface Props {
  knowledge: Knowledge[];
  queueStatus: ReviewQueueStatus | null;
  onExit: () => void;
  /** 回答・採点・生成のあとで、ダッシュボードの件数や履歴を読み直す。 */
  onRecorded: () => void | Promise<void>;
  /** 答え合わせの画面から、そのカードの優先度変更とアーカイブを行う。 */
  onKnowledgeUpdate: KnowledgeUpdate;
  onOpenResults: () => void;
  onOpenLog: () => void;
  autoStartDaily?: boolean;
}

const MAX_ANSWER_CHARS = 2_000;

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
 * キューの上から順に解き続ける復習画面。問題の生成と採点はバッチで行うため、ここではAIを呼ばない。
 * 回答した直後に想定解で答え合わせし、AIの採点と講評は学習ログで確認する。いつ終えてもよい。
 */
export function ReviewView({
  knowledge, queueStatus, onExit, onRecorded, onKnowledgeUpdate, onOpenResults, onOpenLog, autoStartDaily = false,
}: Props) {
  const session = useReviewSession(onRecorded);
  const [answer, setAnswer] = useState("");
  const [batchBusy, setBatchBusy] = useState<"generate" | "grade" | null>(null);
  const [batchNotice, setBatchNotice] = useState<string | null>(null);
  /** この画面で採点を実行したら、採点待ちの件数はキュー全体の最新値で示す。 */
  const [gradedHere, setGradedHere] = useState(false);
  const autoStarted = useRef(false);

  const titleById = useMemo(() => new Map(knowledge.map((item) => [item.id, item.title])), [knowledge]);
  const knowledgeById = useMemo(() => new Map(knowledge.map((item) => [item.id, item])), [knowledge]);
  const readyDue = queueStatus?.ready_due ?? 0;

  useEffect(() => {
    if (!autoStartDaily || autoStarted.current || session.stage !== "setup") return;
    autoStarted.current = true;
    void session.start();
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

  const backToSetup = () => {
    setBatchNotice(null);
    setGradedHere(false);
    session.reset();
  };

  const report = () => {
    if (!window.confirm("この問題を取り下げますか？\n記録はせず、次の問題生成で作り直します。")) return;
    void session.discardCurrent();
  };

  const answered = session.outcomes.filter((outcome) => outcome.status === "graded" || outcome.status === "answered");
  const graded = session.outcomes.filter((outcome) => outcome.status === "graded");
  const waiting = session.outcomes.filter((outcome) => outcome.status === "answered");
  const skipped = session.outcomes.filter((outcome) => outcome.status === "skipped");
  const discarded = session.outcomes.filter((outcome) => outcome.status === "discarded");
  const waitingCount = gradedHere && queueStatus ? queueStatus.waiting_grading : waiting.length;
  const inSession = session.stage === "question" || session.stage === "feedback" || session.stage === "loading";

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

        {inSession && (
          <div className="review-session-bar">
            <span>{answered.length}問回答</span>
            <button className="text-button" onClick={session.stop} disabled={session.busy}>終了する</button>
          </div>
        )}

        {session.stage === "setup" && (
          <div className="quiz-setup card">
            <div className="daily-quiz-start">
              <div>
                <strong>今日の復習</strong>
                <span>{queueStatus ? `出題できる問題 ${readyDue}問` : "出題できる問題を確認中…"}</span>
              </div>
              <button className="primary-button" disabled={readyDue === 0} onClick={() => void session.start()}>
                {readyDue > 0 ? "復習を始める" : "今すぐ出題できる問題はありません"}
              </button>
            </div>
            <p className="muted review-start-note">
              キューの上から順に出題します。答えた分はその都度記録されるので、いつ終えても大丈夫です。
            </p>
            <ReviewQueueSummary status={queueStatus} onOpenResults={onOpenResults} onOpenLog={onOpenLog} />
            <div className="review-batch-actions">{generateButton}</div>
          </div>
        )}

        {session.stage === "loading" && <div className="msg">問題を準備中...</div>}

        {session.stage === "question" && session.current && (
          <ReviewQuestionCard
            key={session.current.id}
            number={answered.length + skipped.length + discarded.length + 1}
            question={session.current}
            answer={answer}
            busy={session.busy}
            onAnswer={setAnswer}
            onSubmit={() => void session.answerCurrent(answer)}
            onSkip={session.skipCurrent}
            onReport={report}
          />
        )}

        {session.stage === "feedback" && session.feedback && (
          <ReviewFeedbackCard
            key={session.feedback.question.id}
            feedback={session.feedback}
            item={knowledgeById.get(session.feedback.question.knowledge_id)}
            onKnowledgeUpdate={onKnowledgeUpdate}
            onNext={() => void session.next()}
          />
        )}

        {session.stage === "done" && (
          <div className="quiz-setup card review-done">
            <h2>{session.exhausted ? "今すぐ解ける問題はすべて解きました" : `${answered.length}問に回答しました`}</h2>
            <ul className="review-done-counts">
              <li><strong>{answered.length}</strong><span>回答</span></li>
              <li><strong>{graded.length}</strong><span>その場で記録（四択・無回答）</span></li>
              <li><strong>{waitingCount}</strong><span>{gradedHere ? "採点待ち（全体）" : "採点待ち"}</span></li>
              {skipped.length > 0 && <li><strong>{skipped.length}</strong><span>スキップ（次回また出ます）</span></li>}
              {discarded.length > 0 && <li><strong>{discarded.length}</strong><span>取り下げ（作り直します）</span></li>}
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
              採点待ちの回答は15分ごとに自動で採点されます。AIの採点と講評は学習ログで確認できます。
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
  number, question, answer, busy, onAnswer, onSubmit, onSkip, onReport,
}: {
  number: number;
  question: ReviewQuestion;
  answer: string;
  busy: boolean;
  onAnswer: (text: string) => void;
  onSubmit: () => void;
  onSkip: () => void;
  onReport: () => void;
}) {
  return (
    <div className="quiz-question card">
      <p className="quiz-progress">
        {number}問目
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
                disabled={busy}
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
          disabled={busy}
          maxLength={MAX_ANSWER_CHARS}
          placeholder={ANSWER_PLACEHOLDER[question.format]}
          autoFocus
          onChange={(event) => onAnswer(event.target.value)}
        />
      )}
      <p className="muted review-answer-hint">
        空欄のまま送ると「思い出せなかった」として記録します。スキップした問題は次の復習でまた出ます。
      </p>
      <div className="quiz-question-actions">
        <button className="text-button review-report" onClick={onReport} disabled={busy}>おかしな問題を報告</button>
        <span className="action-spacer" />
        <button onClick={onSkip} disabled={busy}>スキップ</button>
        <button className="primary-button" onClick={onSubmit} disabled={busy}>
          {busy ? "送信中…" : "回答する"}
        </button>
      </div>
    </div>
  );
}

/** 回答した直後の答え合わせ。四択と無回答は確定した結果、それ以外は想定解を示す。 */
function ReviewFeedbackCard({ feedback, item, onKnowledgeUpdate, onNext }: {
  feedback: ReviewFeedback;
  item: Knowledge | undefined;
  onKnowledgeUpdate: KnowledgeUpdate;
  onNext: () => void;
}) {
  const { question, answer, accepted } = feedback;
  const result = accepted.result;
  const modelAnswer = result?.correct_answer ?? accepted.expected_answer;
  return (
    <div className="quiz-question card review-feedback">
      <p className="quiz-progress">
        答え合わせ
        <span className="quiz-question-format">{question.format}</span>
        {result && <span className={`badge ${VERDICT_CLASS[result.verdict] ?? ""}`}>{result.verdict}</span>}
      </p>
      <p className="quiz-question-text">{question.question}</p>
      <dl className="review-result-body">
        <div><dt>あなたの回答</dt><dd>{answer || "（空欄）"}</dd></div>
        {modelAnswer && <div><dt>{result ? "正解" : "模範解答"}</dt><dd>{modelAnswer}</dd></div>}
        {result?.explanation && <div><dt>講評</dt><dd>{result.explanation}</dd></div>}
      </dl>
      <p className="muted review-answer-hint">
        {result
          ? "この結果は記録済みです。"
          : "AIによる採点と講評は、15分以内に学習ログへ届きます。"}
      </p>
      <div className="quiz-question-actions">
        <span className="action-spacer" />
        <button className="primary-button" onClick={onNext} autoFocus>次の問題へ →</button>
      </div>
      {item && <FeedbackKnowledgeActions item={item} recorded={result != null} onKnowledgeUpdate={onKnowledgeUpdate} />}
    </div>
  );
}

/**
 * 答え合わせしたカードの優先度変更とアーカイブ。ナレッジ一覧へ移らずに済ませ、そのまま次の問題へ進める。
 * アーカイブは元に戻せる。採点前の回答は、アーカイブされたままだと採点バッチが記録せずに破棄する。
 */
function FeedbackKnowledgeActions({ item, recorded, onKnowledgeUpdate }: {
  item: Knowledge;
  recorded: boolean;
  onKnowledgeUpdate: KnowledgeUpdate;
}) {
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const save = async (changes: { priority: KnowledgePriority } | { archived: boolean }, done: string) => {
    if (saving) return;
    setSaving(true);
    setMessage(null);
    try {
      await onKnowledgeUpdate(item.id, item.content_version, changes);
      setMessage(done);
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "保存に失敗しました。");
    } finally {
      setSaving(false);
    }
  };

  const archive = () => {
    const warning = recorded ? "" : "\n採点前にアーカイブしたままだと、この回答は記録されません。";
    if (!window.confirm(`「${item.title}」をアーカイブしますか？\n今後の復習に出題されなくなります。${warning}`)) return;
    void save({ archived: true }, "アーカイブしました。");
  };

  if (item.archived) {
    return (
      <div className="quiz-knowledge-panel review-feedback-actions">
        <div className="quiz-edit-fields">
          <span className="muted">このナレッジはアーカイブ済みです。今後の復習には出題されません。</span>
          <button onClick={() => void save({ archived: false }, "復元しました。")} disabled={saving}>元に戻す</button>
          {saving && <span className="quiz-edit-feedback">保存中…</span>}
          {!saving && message && <span className="quiz-edit-feedback">{message}</span>}
        </div>
      </div>
    );
  }

  return (
    <div className="quiz-knowledge-panel review-feedback-actions">
      <div className="quiz-edit-fields">
        <label className="quiz-edit-control">
          <span>優先度</span>
          <select
            aria-label={`${item.title}の優先度`}
            value={item.priority}
            disabled={saving}
            onChange={(event) => void save({ priority: event.target.value as KnowledgePriority }, "保存しました。")}
          >
            {PRIORITY_ORDER.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <button className="danger-button" onClick={archive} disabled={saving}>アーカイブ</button>
        {saving && <span className="quiz-edit-feedback">保存中…</span>}
        {!saving && message && <span className="quiz-edit-feedback">{message}</span>}
      </div>
      <p className="muted review-priority-note">優先度を変えると、次回の復習時刻も優先度の倍率で計算し直します（再学習中を除く）。</p>
    </div>
  );
}
