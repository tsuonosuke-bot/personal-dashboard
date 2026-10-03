import { useMemo, useState } from "react";
import type { InsightGroupStore } from "../hooks/useInsightGroups";
import type { InsightStore } from "../hooks/useInsights";
import { confirmReviewResults } from "../lib/api";
import { getJstToday } from "../lib/knowledge";
import {
  ALL_CATEGORIES, buildLearningLog, type LearningLogFilters, type LearningLogPeriod,
} from "../lib/learningLog";
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
  onReload: () => void | Promise<void>;
  insightStore: InsightStore;
  insightGroupStore: InsightGroupStore;
  /** 問題を作れなかったカードを、編集できる詳細で開く。 */
  onOpenKnowledge: (id: string) => void;
}

const CONFIRM_CHUNK = 200;

function isUnconfirmed(entry: QuizLog): boolean {
  return entry.review_queue_id !== null && entry.confirmed_at === null;
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

export function LearningLogView({
  knowledge, quizLog, loading, error, onExit, initialUnconfirmedOnly = false, onKnowledgeUpdate, onReload,
  insightStore, insightGroupStore, onOpenKnowledge,
}: Props) {
  const [tab, setTab] = useState<"review" | "speaking">("review");
  const [unconfirmedOnly, setUnconfirmedOnly] = useState(initialUnconfirmedOnly);
  /** この画面で確認した記録。一覧から消さずに「確認済み」として表示するため、手元で持つ。 */
  const [confirmedIds, setConfirmedIds] = useState<ReadonlySet<number>>(() => new Set());
  const [detailId, setDetailId] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
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
      .filter((entry) => !unconfirmedOnly || isUnconfirmed(entry)),
    [filters, knowledge, quizLog, unconfirmedOnly],
  );
  const unconfirmedCount = entries.filter((entry) => isUnconfirmed(entry) && !confirmedIds.has(entry.id)).length;
  const detail = detailId ? knowledgeById.get(detailId) ?? null : null;

  const confirm = async (ids: number[]) => {
    const pending = ids.filter((id) => !confirmedIds.has(id));
    if (pending.length === 0) return;
    setConfirmError(null);
    try {
      for (let start = 0; start < pending.length; start += CONFIRM_CHUNK) {
        await confirmReviewResults(pending.slice(start, start + CONFIRM_CHUNK));
      }
      setConfirmedIds((current) => new Set([...current, ...pending]));
    } catch (caught) {
      setConfirmError(caught instanceof Error ? caught.message : "確認済みにできませんでした。");
    }
  };
  const correct = entries.filter((entry) => entry.verdict === "正解").length;
  const totalPages = Math.max(1, Math.ceil(entries.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const rows = entries.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const updateFilters = (patch: Partial<LearningLogFilters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  };

  return (
    <div className="quiz-page">
      <header className="quiz-header">
        <button className="text-button" onClick={onExit}>← ダッシュボードへ戻る</button>
        <h1>学習ログ</h1>
      </header>
      <main className="quiz-body learning-log">
        <div className="organize-tabs card" role="group" aria-label="表示するログ">
          <button type="button" aria-pressed={tab === "review"} onClick={() => setTab("review")}>復習</button>
          <button type="button" aria-pressed={tab === "speaking"} onClick={() => setTab("speaking")}>英会話練習</button>
        </div>
        {tab === "speaking" ? <SpeakingLogPanel knowledge={knowledge} periodOptions={PERIOD_OPTIONS} /> : <>
        <PendingAnswersPanel titleById={titleById} onGraded={onReload} />
        <GenerationHoldsPanel onOpenKnowledge={onOpenKnowledge} />
        <div className="learning-log-filters card">
          <label>
            期間
            <select value={filters.period} onChange={(event) => updateFilters({ period: event.target.value as LearningLogPeriod })}>
              {PERIOD_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label>
            カテゴリ
            <select value={filters.category} onChange={(event) => updateFilters({ category: event.target.value })}>
              <option value={ALL_CATEGORIES}>すべて</option>
              {categories.map((category) => <option key={category} value={category}>{category}</option>)}
            </select>
          </label>
          <label>
            判定
            <select value={filters.verdict} onChange={(event) => updateFilters({ verdict: event.target.value as QuizVerdict | "all" })}>
              {VERDICT_OPTIONS.map((verdict) => (
                <option key={verdict} value={verdict}>{verdict === "all" ? "すべて" : verdict}</option>
              ))}
            </select>
          </label>
          <label>
            確認
            <select value={unconfirmedOnly ? "unconfirmed" : "all"} onChange={(event) => { setUnconfirmedOnly(event.target.value === "unconfirmed"); setPage(1); }}>
              <option value="all">すべて</option>
              <option value="unconfirmed">未確認のみ</option>
            </select>
          </label>
          <p className="learning-log-summary" aria-live="polite">
            {entries.length}件・正解{correct}件
            {entries.length > 0 && `（正答率${Math.round((correct / entries.length) * 100)}%）`}
          </p>
        </div>

        {unconfirmedCount > 0 && (
          <div className="review-unconfirmed-bar">
            <span>未確認の採点結果が{unconfirmedCount}件あります。開くと確認済みになります。</span>
            <button onClick={() => void confirm(entries.filter(isUnconfirmed).map((entry) => entry.id))}>
              表示中をすべて確認済みにする
            </button>
          </div>
        )}
        {confirmError && <div className="err compact" role="alert">{confirmError}</div>}
        {error && <div className="err compact" role="alert">{error}</div>}
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
                      if ((event.currentTarget as HTMLDetailsElement).open && isUnconfirmed(entry)) void confirm([entry.id]);
                    }}
                  >
                    <summary>
                      問題と講評を見る
                      {isUnconfirmed(entry) && !confirmedIds.has(entry.id) && <span className="badge review-unconfirmed">未確認</span>}
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
