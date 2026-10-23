import { useMemo, useRef, useState } from "react";
import type { InsightGroupStore } from "../hooks/useInsightGroups";
import type { InsightStore } from "../hooks/useInsights";
import { confirmReviewResultsDetailed } from "../lib/api";
import { getJstToday } from "../lib/knowledge";
import {
  ALL_CATEGORIES, buildLearningLog, type LearningLogFilters, type LearningLogPeriod,
} from "../lib/learningLog";
import {
  createReviewConfirmationCoordinator, isUnconfirmedResult, unconfirmedResultIds,
  type ConfirmationProgress, type ConfirmationRunResult, type ReviewLogReloadResult,
} from "../lib/reviewConfirmation";
import { KnowledgeDetailModal } from "./KnowledgeDetailModal";
import { Pagination } from "./Pagination";
import { GenerationHoldsPanel, PendingAnswersPanel, ReviewResultActions, type KnowledgeUpdate } from "./ReviewLogParts";
import { SpeakingLogPanel } from "./SpeakingLogPanel";
import type { Knowledge, QuizLog, QuizVerdict } from "../types";

interface Props {
  knowledge: Knowledge[];
  quizLog: QuizLog[];
  loading: boolean;
  error: string | null;
  onExit: () => void;
  /** 未確認の採点結果だけを表示した状態で開く。 */
  initialUnconfirmedOnly?: boolean;
  onKnowledgeUpdate: KnowledgeUpdate;
  /** 採点や確認のあとで、履歴と件数を読み直す。 */
  onReload: () => Promise<ReviewLogReloadResult>;
  insightStore: InsightStore;
  insightGroupStore: InsightGroupStore;
  /** 問題を作れなかったカードを、編集できる詳細で開く。 */
  onOpenKnowledge: (id: string) => void;
}

const PERIOD_OPTIONS: { value: LearningLogPeriod; label: string }[] = [
  { value: "7", label: "直近7日" },
  { value: "30", label: "直近30日" },
  { value: "90", label: "直近90日" },
  { value: "all", label: "すべて" },
];

const VERDICT_OPTIONS: (QuizVerdict | "all")[] = ["all", "正解", "部分正解", "不正解"];

const VERDICT_CLASS: Record<QuizVerdict, string> = {
  正解: "quiz-verdict-ok",
  部分正解: "quiz-verdict-partial",
  不正解: "quiz-verdict-ng",
};

function confirmationMessage(progress: ConfirmationProgress | null, result: ConfirmationRunResult | null, count: number): string {
  if (progress) return progress.phase === "refreshing"
    ? `${progress.confirmedIds.length} / ${progress.total}件を確認済み。最新の状態を取得しています…`
    : `確認中 ${progress.confirmedIds.length} / ${progress.total}件`;
  if (!result) return `検索結果に未確認の採点結果が${count}件あります。開くと確認済みになります。`;
  if (!result.verified) return `${result.confirmedIds.length}件は確認済みです。残りの状態は未確認です。再読み込みして続けてください。`;
  const excluded = result.excludedIds.length ? `・${result.excludedIds.length}件は削除等で対象外` : "";
  if (result.remainingIds.length) return `${result.confirmedIds.length}件確認済み・残り${result.remainingIds.length}件${excluded}。`;
  return `対象${result.targetIds.length}件の確認が完了しました（${result.confirmedIds.length}件確認済み${excluded}）。`;
}

export function LearningLogView({
  knowledge, quizLog, loading, error, onExit, initialUnconfirmedOnly = false, onKnowledgeUpdate, onReload,
  insightStore, insightGroupStore, onOpenKnowledge,
}: Props) {
  const [tab, setTab] = useState<"review" | "speaking">("review");
  const [unconfirmedOnly, setUnconfirmedOnly] = useState(initialUnconfirmedOnly);
  /** この画面で確認した記録。一覧から消さずに「確認済み」として表示するため、手元で持つ。 */
  const [confirmedIds, setConfirmedIds] = useState<ReadonlySet<number>>(() => new Set());
  const [detailId, setDetailId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [progress, setProgress] = useState<ConfirmationProgress | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmationRunResult | null>(null);
  const reloadRef = useRef(onReload);
  reloadRef.current = onReload;
  const coordinatorRef = useRef<ReturnType<typeof createReviewConfirmationCoordinator> | null>(null);
  if (coordinatorRef.current === null) coordinatorRef.current = createReviewConfirmationCoordinator({
    confirm: confirmReviewResultsDetailed,
    reload: () => reloadRef.current(),
    onConfirmed: (ids) => setConfirmedIds((current) => new Set([...current, ...ids])),
    onProgress: setProgress,
  });
  const [filters, setFilters] = useState<LearningLogFilters>({
    period: "30",
    category: ALL_CATEGORIES,
    verdict: "all",
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(30);

  const categories = useMemo(
    () => [...new Set(knowledge.map((item) => item.category))].sort(),
    [knowledge],
  );
  const knowledgeById = useMemo(() => new Map(knowledge.map((item) => [item.id, item])), [knowledge]);
  const titleById = useMemo(() => new Map(knowledge.map((item) => [item.id, item.title])), [knowledge]);
  const entries = useMemo(
    () => buildLearningLog(quizLog, knowledge, filters, getJstToday())
      .filter((entry) => !unconfirmedOnly || isUnconfirmedResult(entry)),
    [filters, knowledge, quizLog, unconfirmedOnly],
  );
  const unconfirmedIds = unconfirmedResultIds(entries, confirmedIds);
  const unconfirmedCount = unconfirmedIds.length;
  const detail = detailId ? knowledgeById.get(detailId) ?? null : null;

  const confirm = async (ids: number[], previous?: ConfirmationRunResult, recheckOnly = false) => {
    const coordinator = coordinatorRef.current!;
    if (coordinator.busy || loading || (error && !recheckOnly)) return;
    if (ids.length === 0 && !recheckOnly) return;
    setConfirming(true);
    setConfirmation(null);
    try {
      const result = await coordinator.run(ids, { previous, recheckOnly });
      if (result) {
        setConfirmation(result);
        // 成功した全件再取得は正本。通信成功時の一時表示だけで完了とはしない。
        if (result.verified) setConfirmedIds((current) => new Set([
          ...[...current].filter((id) => !result.targetIds.includes(id)), ...result.confirmedIds,
        ]));
      }
    } finally {
      setConfirming(false);
      setProgress(null);
    }
  };
  const correct = entries.filter((entry) => entry.verdict === "正解").length;
  const totalPages = Math.max(1, Math.ceil(entries.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const rows = entries.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const updateFilters = (patch: Partial<LearningLogFilters>) => {
    if (coordinatorRef.current?.busy) return;
    setFilters((current) => ({ ...current, ...patch }));
    setConfirmation(null);
    setPage(1);
  };

  return (
    <div className="quiz-page">
      <header className="quiz-header">
        <button className="text-button" disabled={confirming} onClick={onExit}>← ダッシュボードへ戻る</button>
        <h1>学習ログ</h1>
      </header>
      <main className="quiz-body learning-log">
        <div className="organize-tabs card" role="group" aria-label="表示するログ">
          <button type="button" disabled={confirming} aria-pressed={tab === "review"} onClick={() => setTab("review")}>復習</button>
          <button type="button" disabled={confirming} aria-pressed={tab === "speaking"} onClick={() => setTab("speaking")}>英会話練習</button>
        </div>
        {tab === "speaking" ? <SpeakingLogPanel knowledge={knowledge} periodOptions={PERIOD_OPTIONS} /> : <>
        <PendingAnswersPanel titleById={titleById} onGraded={async () => { await onReload(); }} />
        <GenerationHoldsPanel onOpenKnowledge={onOpenKnowledge} />
        <div className="learning-log-filters card">
          <label>
            期間
            <select disabled={confirming} value={filters.period} onChange={(event) => updateFilters({ period: event.target.value as LearningLogPeriod })}>
              {PERIOD_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label>
            カテゴリ
            <select disabled={confirming} value={filters.category} onChange={(event) => updateFilters({ category: event.target.value })}>
              <option value={ALL_CATEGORIES}>すべて</option>
              {categories.map((category) => <option key={category} value={category}>{category}</option>)}
            </select>
          </label>
          <label>
            判定
            <select disabled={confirming} value={filters.verdict} onChange={(event) => updateFilters({ verdict: event.target.value as QuizVerdict | "all" })}>
              {VERDICT_OPTIONS.map((verdict) => (
                <option key={verdict} value={verdict}>{verdict === "all" ? "すべて" : verdict}</option>
              ))}
            </select>
          </label>
          <label>
            確認
            <select disabled={confirming} value={unconfirmedOnly ? "unconfirmed" : "all"} onChange={(event) => {
              if (coordinatorRef.current?.busy) return;
              setUnconfirmedOnly(event.target.value === "unconfirmed"); setPage(1); setConfirmation(null);
            }}>
              <option value="all">すべて</option>
              <option value="unconfirmed">未確認のみ</option>
            </select>
          </label>
          <p className="learning-log-summary" aria-live="polite">
            {entries.length}件・正解{correct}件
            {entries.length > 0 && `（正答率${Math.round((correct / entries.length) * 100)}%）`}
          </p>
        </div>

        {(unconfirmedCount > 0 || confirming || confirmation) && (
          <div className="review-unconfirmed-bar">
            <span role="status" aria-live="polite">
              {confirmationMessage(progress, confirmation, unconfirmedCount)}
            </span>
            {!confirming && confirmation && (!confirmation.verified || error) ? (
              <button disabled={loading} onClick={() => void confirm(confirmation.targetIds, confirmation, true)}>状態を再読み込み</button>
            ) : !confirming && confirmation?.remainingIds.length ? (
              <button disabled={loading || Boolean(error)} onClick={() => void confirm(confirmation.targetIds, confirmation)}>残り{confirmation.remainingIds.length}件を再実行</button>
            ) : unconfirmedCount > 0 && (
              <button disabled={confirming || loading || Boolean(error)} onClick={() => void confirm(unconfirmedIds)}>
                検索結果の未確認{unconfirmedCount}件すべてを確認済みにする
              </button>
            )}
          </div>
        )}
        {confirmation?.error && <div className="err compact" role="alert">{confirmation.error}</div>}
        {error && <div className="err compact" role="alert">{error}</div>}
        {error && !confirmation && <button disabled={loading || confirming} onClick={() => void confirm(unconfirmedIds, undefined, true)}>再読み込み</button>}
        {loading && entries.length === 0 && <div className="msg">読み込み中...</div>}
        {!loading && !error && entries.length === 0 && (
          <div className="msg">条件に合う回答はありません。</div>
        )}

        {rows.length > 0 && (
          <ol className="learning-log-list">
            {rows.map((entry) => (
              <li key={entry.id} className="learning-log-item card">
                <div className="learning-log-head">
                  <time dateTime={entry.asked_on}>{entry.asked_on}</time>
                  <span className={`badge ${VERDICT_CLASS[entry.verdict]}`}>{entry.verdict}</span>
                  <span className="quiz-result-q">q{entry.quality}</span>
                  <span className="quiz-result-format">{entry.format}</span>
                  <span className="learning-log-category">{entry.category}</span>
                </div>
                <strong className="learning-log-title">{entry.title}</strong>
                {entry.question ? (
                  <details
                    className="review-result-details"
                    onToggle={(event) => {
                      if ((event.currentTarget as HTMLDetailsElement).open && isUnconfirmedResult(entry) && !confirmedIds.has(entry.id)) void confirm([entry.id]);
                    }}
                  >
                    <summary aria-disabled={confirming && isUnconfirmedResult(entry)} onClick={(event) => {
                      if (coordinatorRef.current?.busy && isUnconfirmedResult(entry)) event.preventDefault();
                    }}>
                      問題と講評を見る
                      {isUnconfirmedResult(entry) && !confirmedIds.has(entry.id) && <span className="badge review-unconfirmed">未確認</span>}
                    </summary>
                    <dl className="review-result-body">
                      <div><dt>問題</dt><dd>{entry.question}</dd></div>
                      <div><dt>あなたの回答</dt><dd>{entry.user_answer || "（空欄）"}</dd></div>
                      {entry.correct_answer && <div><dt>正解</dt><dd>{entry.correct_answer}</dd></div>}
                      {entry.explanation && <div><dt>講評</dt><dd>{entry.explanation}</dd></div>}
                    </dl>
                    {knowledgeById.get(entry.knowledge_id) && (
                      <ReviewResultActions
                        item={knowledgeById.get(entry.knowledge_id)!}
                        onKnowledgeUpdate={onKnowledgeUpdate}
                        insightStore={insightStore}
                        insightGroupStore={insightGroupStore}
                        onOpenDetail={(item) => setDetailId(item.id)}
                        gradingReport={{
                          question: entry.question ?? "",
                          userAnswer: entry.user_answer ?? "",
                          correctAnswer: entry.correct_answer ?? "",
                          explanation: entry.explanation ?? "",
                          quality: entry.quality,
                          verdict: entry.verdict,
                        }}
                      />
                    )}
                  </details>
                ) : entry.note && <p className="learning-log-note">{entry.note}</p>}
              </li>
            ))}
          </ol>
        )}

        {entries.length > 0 && (
          <Pagination
            page={currentPage}
            totalPages={totalPages}
            pageSize={pageSize}
            totalItems={entries.length}
            onChange={setPage}
            onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
          />
        )}
        </>}
      </main>
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
