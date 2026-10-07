import { useEffect, useMemo, useRef, useState } from "react";
import { runReviewBatch } from "../lib/api";
import type { InsightGroupStore } from "../hooks/useInsightGroups";
import type { InsightStore } from "../hooks/useInsights";
import { useReviewSession, type ReviewFeedback } from "../hooks/useReviewSession";
import type { Knowledge, QuizLog, ReviewBatchSummary, ReviewQuestion, ReviewQueueStatus } from "../types";
import { KnowledgeDetailModal } from "./KnowledgeDetailModal";
import { ReviewResultActions, type KnowledgeUpdate } from "./ReviewLogParts";
import { ReviewQueueSummary } from "./ReviewQueueSummary";
import { RelatedKnowledgePanel } from "./RelatedKnowledgePanel";
import { TagChips } from "./TagChips";

interface Props {
  knowledge: Knowledge[];
  /** 答え合わせ画面から開く詳細に、そのカードの出題履歴を出す。 */
  quizLog: QuizLog[];
  queueStatus: ReviewQueueStatus | null;
  onExit: () => void;
  /** 回答・採点・生成のあとで、ダッシュボードの件数や履歴を読み直す。 */
  onRecorded: () => void | Promise<void>;
  /** 答え合わせの画面から、学習ログと同じくそのカードの習熟度・優先度の変更とアーカイブを行う。 */
  onKnowledgeUpdate: KnowledgeUpdate;
  insightStore: InsightStore;
  insightGroupStore: InsightGroupStore;
  onOpenResults: () => void;
  onOpenLog: () => void;
  autoStartDaily?: boolean;
  /** 見直す講評（未確認の不正解・部分正解）の件数。復習を終えた画面から講評の見直しへ進む。 */
  missCount?: number;
  onOpenMisses?: () => void;
  /** ノートの復習（#96）。そのノートのナレッジの問題だけを出し、終えたらノートへ戻る。 */
  scope?: ReviewScope | null;
}

export interface ReviewScope {
  /** 問いの短い名前かテーマ名。 */
  label: string;
  knowledgeIds: string[];
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
  knowledge, quizLog, queueStatus, onExit, onRecorded, onKnowledgeUpdate, insightStore, insightGroupStore,
  onOpenResults, onOpenLog, autoStartDaily = false, missCount = 0, onOpenMisses, scope = null,
}: Props) {
  const session = useReviewSession(onRecorded, scope?.knowledgeIds);
  const [answer, setAnswer] = useState("");
  const [batchBusy, setBatchBusy] = useState<"generate" | "grade" | null>(null);
  const [batchNotice, setBatchNotice] = useState<string | null>(null);
  /** この画面で採点を実行したら、採点待ちの件数はキュー全体の最新値で示す。 */
  const [gradedHere, setGradedHere] = useState(false);
  const autoStarted = useRef(false);

  const titleById = useMemo(() => new Map(knowledge.map((item) => [item.id, item.title])), [knowledge]);
  const knowledgeById = useMemo(() => new Map(knowledge.map((item) => [item.id, item])), [knowledge]);
  const [detailId, setDetailId] = useState<string | null>(null);
  const detail = detailId ? knowledgeById.get(detailId) ?? null : null;
  const readyDue = queueStatus?.ready_due ?? 0;
  /** ノートのナレッジのうち期限が来たカード。問題がまだ作られていなければ、期限が来ていても出ない。 */
  const scopeDue = useMemo(() => {
    if (!scope) return 0;
    const now = Date.now();
    return scope.knowledgeIds.filter((id) => {
      const item = knowledgeById.get(id);
      return item && !item.archived && Date.parse(item.next_review_at) <= now;
    }).length;
  }, [knowledgeById, scope]);
  const autoStart = autoStartDaily || (scope !== null && scopeDue > 0);

  useEffect(() => {
    if (!autoStart || autoStarted.current || session.stage !== "setup") return;
    autoStarted.current = true;
    void session.start();
  }, [autoStart, session]);

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
        <button className="text-button" onClick={onExit}>{scope ? "← ノートへ戻る" : "← ダッシュボードへ戻る"}</button>
        <h1>{scope ? `「${scope.label}」の復習` : "復習"}</h1>
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

        {session.stage === "setup" && scope && (
          <div className="quiz-setup card">
            <div className="daily-quiz-start">
              <div>
                <strong>このノートの復習</strong>
                <span>期限が来たカード {scopeDue}枚（ノートのナレッジ {scope.knowledgeIds.length}件のうち）</span>
              </div>
              <button className="primary-button" disabled={scopeDue === 0} onClick={() => void session.start()}>
                {scopeDue > 0 ? "このノートの復習を始める" : "期限が来たカードはありません"}
              </button>
            </div>
            <p className="muted review-start-note">
              このノートのナレッジのうち、期限が来て問題ができているものだけを、いつもの順で出題します。
              復習の予定は前倒ししません。
            </p>
          </div>
        )}

        {session.stage === "setup" && !scope && (
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
            insightStore={insightStore}
            insightGroupStore={insightGroupStore}
            onOpenDetail={(item) => setDetailId(item.id)}
            onOpenKnowledgeId={setDetailId}
            onNext={() => void session.next()}
          />
        )}

        {session.stage === "done" && (
          <div className="quiz-setup card review-done">
            <h2>
              {!session.exhausted ? `${answered.length}問に回答しました`
                : scope ? "このノートで今すぐ解ける問題はすべて解きました" : "今すぐ解ける問題はすべて解きました"}
            </h2>
            {scope && session.exhausted && answered.length === 0 && (
              <div className="review-batch-actions">
                <p className="muted">期限が来たばかりのカードは、まだ問題が作られていないことがあります。</p>
                {generateButton}
              </div>
            )}
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
              採点待ちの回答は1時間ごとに自動で採点されます。採点が終わると、外した問題だけが「見直す講評」に入ります
              （正解した問題の講評は確認不要として扱います）。
            </p>
            <div className="review-batch-actions">
              {waitingCount > 0 && (
                <button className="primary-button" onClick={() => void runBatch("grade")} disabled={batchBusy !== null}>
                  {batchBusy === "grade" ? "採点中…" : "今すぐ採点する"}
                </button>
              )}
              {missCount > 0 && onOpenMisses && (
                <button className={waitingCount > 0 ? undefined : "primary-button"} onClick={onOpenMisses}>
                  外した問題の講評を見る（{missCount}件）
                </button>
              )}
              <button onClick={onOpenResults}>学習ログで結果を見る</button>
              <button onClick={backToSetup} disabled={batchBusy !== null}>復習の最初に戻る</button>
            </div>
          </div>
        )}
      </main>
      {/* 学習ログと同じく読み取り専用で開く。編集はダッシュボードから行う。 */}
      {detail && (
        <KnowledgeDetailModal
          knowledge={detail}
          quizLog={quizLog}
          mutating={false}
          onClose={() => setDetailId(null)}
          insightStore={insightStore}
          insightGroupStore={insightGroupStore}
        />
      )}
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
function ReviewFeedbackCard({
  feedback, item, onKnowledgeUpdate, insightStore, insightGroupStore, onOpenDetail, onOpenKnowledgeId, onNext,
}: {
  feedback: ReviewFeedback;
  item: Knowledge | undefined;
  onKnowledgeUpdate: KnowledgeUpdate;
  insightStore: InsightStore;
  insightGroupStore: InsightGroupStore;
  onOpenDetail: (item: Knowledge) => void;
  onOpenKnowledgeId: (id: string) => void;
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
        {/* この知識に付いているタグ。見るだけで、変更はナレッジ一覧・詳細から行う。 */}
        {item && (
          <div>
            <dt>タグ</dt>
            <dd className="review-feedback-tags">
              <TagChips item={item} emptyLabel="未設定" />
            </dd>
          </div>
        )}
      </dl>
      <p className="muted review-answer-hint">
        {result
          ? "この結果は記録済みです。"
          : "AIによる採点と講評は、1時間以内に学習ログへ届きます。"}
      </p>
      <div className="quiz-question-actions">
        <span className="action-spacer" />
        <button className="primary-button" onClick={onNext} autoFocus>次の問題へ →</button>
      </div>
      {/* 学習ログと同じ操作（示唆・あとで深掘り・習熟度・優先度・詳細・アーカイブ）を、ここでも済ませられる。 */}
      {item && (
        <div className="review-feedback-actions">
          <ReviewResultActions
            item={item}
            onKnowledgeUpdate={onKnowledgeUpdate}
            insightStore={insightStore}
            insightGroupStore={insightGroupStore}
            onOpenDetail={onOpenDetail}
            archiveWarning={result ? undefined : "採点前にアーカイブしたままだと、この回答は記録されません。"}
          />
        </div>
      )}
      {/* 意味の近いナレッジ・示唆・問い（#97）。答えを見た後だけ出す: 回答前に出すとヒントになる。 */}
      <RelatedKnowledgePanel knowledgeId={question.knowledge_id} onOpenKnowledge={onOpenKnowledgeId} />
    </div>
  );
}
