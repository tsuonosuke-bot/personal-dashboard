import { lazy, Suspense, useMemo, type Dispatch, type SetStateAction } from "react";
import { ArchivedKnowledgeModal } from "./ArchivedKnowledgeModal";
import { FilterBar } from "./FilterBar";
import { KnowledgeTable } from "./KnowledgeTable";
import { KnowledgeDetailModal } from "./KnowledgeDetailModal";
import { KnowledgeFormModal } from "./KnowledgeFormModal";
import { Pagination } from "./Pagination";
import { MissedReviewSheet } from "./MissedReviewSheet";
import { TodayLearningPanel } from "./TodayLearningPanel";
import { KnowledgeHeader } from "./KnowledgeHeader";
import { SpeakingPracticePanel } from "./SpeakingPracticePanel";
import type { useKnowledgeData } from "../hooks/useKnowledgeData";
import type { useDailyReview } from "../hooks/useDailyReview";
import type { useReviewQueueStatus } from "../hooks/useReviewQueueStatus";
import type { useInsights } from "../hooks/useInsights";
import type { useInsightGroups } from "../hooks/useInsightGroups";
import type { KnowledgeNavigation } from "../hooks/useKnowledgeNavigation";
import type { KnowledgeActions } from "../hooks/useKnowledgeActions";
import { missesToReview } from "../lib/learningSummary";

const DashboardCharts = lazy(() => import("./DashboardCharts").then((module) => ({ default: module.DashboardCharts })));
type Props = {
  data: ReturnType<typeof useKnowledgeData>; navigation: KnowledgeNavigation; actions: KnowledgeActions;
  dailyReview: ReturnType<typeof useDailyReview>; reviewQueue: ReturnType<typeof useReviewQueueStatus>;
  insightStore: ReturnType<typeof useInsights>; insightGroupStore: ReturnType<typeof useInsightGroups>;
  actionError: string | null; setActionError: Dispatch<SetStateAction<string | null>>;
  notice: string | null; setNotice: Dispatch<SetStateAction<string | null>>;
  missesOpen: boolean; setMissesOpen: Dispatch<SetStateAction<boolean>>;
  confirmMiss: (quizLogId: number) => Promise<void>;
};

export function KnowledgeDashboard({ data, navigation, actions, dailyReview, reviewQueue, insightStore, insightGroupStore,
  actionError, setActionError, notice, setNotice, missesOpen, setMissesOpen, confirmMiss }: Props) {
  const { knowledge, archivedKnowledge, quizLog, loading, error, mutating } = data;
  const { archiveOpen, setArchiveOpen, filters, sort, setSort, pageSize, setPageSize, setPage, filtered,
    totalPages, currentPage, rows, selected, closeKnowledge, openKnowledge, updateFilters, clearFilters,
    handleSort, setQuizOpen, setSpeakingOpen, setLogOpen, setSearchOpen, setOrganizeOpen, setHelpOpen } = navigation;
  const { formTarget, setFormTarget, undoArchived, setUndoArchived, handleReload, removeAutoTagFrom,
    openNew, openEdit, saveKnowledge, archiveKnowledge, restoreKnowledge } = actions;
  const categories = useMemo(
    () => [...new Set(knowledge.map((k) => k.category))].sort(),
    [knowledge],
  );
  const tagSuggestions = useMemo(
    () => [...new Set([...knowledge, ...archivedKnowledge].flatMap((item) => item.tags))].sort((a, b) => a.localeCompare(b, "ja")),
    [archivedKnowledge, knowledge],
  );
  const registrationKnowledge = useMemo(
    () => [...knowledge, ...archivedKnowledge],
    [archivedKnowledge, knowledge],
  );
  const knowledgeById = useMemo(
    () => new Map(registrationKnowledge.map((item) => [item.id, item])),
    [registrationKnowledge],
  );
  const misses = useMemo(() => missesToReview(quizLog), [quizLog]);


  return (
    <div className="app-page">
      <KnowledgeHeader error={error} loading={loading} mutating={mutating} handleReload={handleReload} setHelpOpen={setHelpOpen} openNew={openNew} />

      <main className="wrap">

      <nav className="page-tools" aria-label="ナレッジのページ">
        <button
          className="page-tool page-tool-primary"
          onClick={() => setOrganizeOpen("questions")}
          aria-label={`問い・示唆・タグ（示唆 ${insightStore.insights.length}件）`}
        >
          <svg className="page-tool-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1 2V16h5.2v-.2c0-.8.4-1.5 1-2A6 6 0 0 0 12 3Z" />
          </svg>
          <span className="page-tool-label">問い・示唆・タグ</span>
          <span className="page-tool-count" aria-hidden="true">示唆 {insightStore.insights.length}</span>
        </button>
        <button className="page-tool" onClick={() => setLogOpen(true)}>学習ログ</button>
        <button className="page-tool" onClick={() => setSearchOpen(true)}>意味で検索</button>
        <button
          className="page-tool"
          onClick={() => { setActionError(null); setArchiveOpen(true); }}
          disabled={loading || mutating}
          aria-label={`アーカイブ（${archivedKnowledge.length}件）`}
        >
          <span className="page-tool-label">アーカイブ</span>
          <span className="page-tool-count" aria-hidden="true">{archivedKnowledge.length}</span>
        </button>
        <details className="page-tool-more">
          <summary className="page-tool">その他</summary>
          <div className="page-tool-menu">
            <a href="api/export">JSON書き出し</a>
            <a href="https://personal-dashboard-7md.pages.dev/status/">接続状態</a>
          </div>
        </details>
      </nav>

      {loading && <div className="msg">読み込み中...</div>}
      {!loading && error && (
        <div className="err load-error" role="alert">
          <strong>データを読み込めませんでした</strong>
          <p>{error}</p>
          <button type="button" onClick={handleReload}>再試行</button>
        </div>
      )}
      {notice && (
        <div className="notice" role="status">
          <span>{notice}</span>
          <span className="notice-actions">
            {undoArchived && (
              <button className="notice-undo" disabled={mutating} onClick={() => void restoreKnowledge(undoArchived)}>
                元に戻す
              </button>
            )}
            <button
              aria-label="閉じる"
              onClick={() => { setNotice(null); setUndoArchived(null); }}
            >
              ×
            </button>
          </span>
        </div>
      )}
      {formTarget === undefined && !archiveOpen && actionError && <div className="err compact" role="alert">{actionError}</div>}

      {!loading && !error && (
        <>
          <TodayLearningPanel
            status={dailyReview.status}
            loading={dailyReview.loading}
            error={dailyReview.error}
            queueStatus={reviewQueue.status}
            quizLog={quizLog}
            missCount={misses.length}
            missWrong={misses.filter((row) => row.verdict === "不正解").length}
            missPartial={misses.filter((row) => row.verdict === "部分正解").length}
            onStart={() => setQuizOpen(true, "daily")}
            onCategoryReview={() => setQuizOpen(true, "custom")}
            onOpenMisses={() => setMissesOpen(true)}
            onOpenLog={() => setLogOpen(true)}
          />
          <SpeakingPracticePanel
            knowledge={knowledge}
            onStart={() => setSpeakingOpen(true)}
          />

          <Suspense fallback={<div className="card chart-loading" role="status">グラフを読み込み中...</div>}>
            <DashboardCharts
              knowledge={knowledge}
              registrationKnowledge={registrationKnowledge}
              quizLog={quizLog}
            />
          </Suspense>

          <h2 className="section-title">ナレッジ</h2>
          <FilterBar
            filters={filters}
            categories={categories}
            resultCount={filtered.length}
            onChange={updateFilters}
            onClear={clearFilters}
          />
          <KnowledgeTable rows={rows} sort={sort} onSort={handleSort} onSortChange={(next) => { setSort(next); setPage(1); }} onOpen={openKnowledge} />
          <Pagination
            page={currentPage}
            totalPages={totalPages}
            pageSize={pageSize}
            totalItems={filtered.length}
            onChange={setPage}
            onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
          />
        </>
      )}

      {selected && (
        <KnowledgeDetailModal
          knowledge={selected}
          quizLog={quizLog}
          mutating={mutating}
          onClose={closeKnowledge}
          onEdit={selected.archived ? undefined : () => openEdit(selected)}
          onArchive={selected.archived ? undefined : () => void archiveKnowledge(selected)}
          insightStore={insightStore}
          insightGroupStore={insightGroupStore}
          onRemoveAutoTag={(tag) => void removeAutoTagFrom(selected, tag)}
        />
      )}
      {formTarget !== undefined && (
        <KnowledgeFormModal
          key={formTarget?.id ?? "new"}
          knowledge={formTarget}
          categories={categories}
          tagSuggestions={tagSuggestions}
          saving={mutating}
          error={actionError}
          onClose={() => { setFormTarget(undefined); setActionError(null); }}
          onSave={saveKnowledge}
        />
      )}
      {missesOpen && (
        <MissedReviewSheet
          misses={misses}
          knowledgeById={knowledgeById}
          onConfirm={confirmMiss}
          onOpenKnowledge={(item) => { setMissesOpen(false); openKnowledge(item); }}
          onClose={() => setMissesOpen(false)}
        />
      )}
      {archiveOpen && (
        <ArchivedKnowledgeModal
          knowledge={archivedKnowledge}
          mutating={mutating}
          error={actionError}
          onClose={() => { setArchiveOpen(false); setActionError(null); }}
          onRestore={restoreKnowledge}
        />
      )}
      </main>
    </div>
  );
}
