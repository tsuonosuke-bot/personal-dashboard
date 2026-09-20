import { lazy, Suspense, useMemo, useState } from "react";
import { ArchivedKnowledgeModal } from "./components/ArchivedKnowledgeModal";
import { FilterBar } from "./components/FilterBar";
import { KnowledgeTable } from "./components/KnowledgeTable";
import { KnowledgeDetailModal } from "./components/KnowledgeDetailModal";
import { KnowledgeFormModal } from "./components/KnowledgeFormModal";
import { Pagination } from "./components/Pagination";
import { ReviewInsights } from "./components/ReviewInsights";
import { StatsCards } from "./components/StatsCards";
import { ALL, DEFAULT_PAGE_SIZE } from "./constants";
import { useFilteredKnowledge } from "./hooks/useFilteredKnowledge";
import { useKnowledgeData } from "./hooks/useKnowledgeData";
import type { Filters, Knowledge, KnowledgeDraft, ReviewFilter, SortKey, SortState } from "./types";

const DashboardCharts = lazy(() => import("./components/DashboardCharts")
  .then((module) => ({ default: module.DashboardCharts })));
const QuizView = lazy(() => import("./components/QuizView")
  .then((module) => ({ default: module.QuizView })));

export default function App() {
  const [showQuiz, setShowQuiz] = useState(() => new URLSearchParams(window.location.search).get("view") === "quiz");
  const {
    knowledge, archivedKnowledge, quizLog, loading, error, mutating,
    reload, createKnowledge, updateKnowledge,
  } = useKnowledgeData();
  const [filters, setFilters] = useState<Filters>({
    search: "",
    category: ALL,
    mastery: ALL,
    review: "all",
  });
  const [sort, setSort] = useState<SortState>({ key: "created_at", direction: "desc" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [selected, setSelected] = useState<Knowledge | null>(null);
  const [formTarget, setFormTarget] = useState<Knowledge | null | undefined>(undefined);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [undoArchived, setUndoArchived] = useState<Knowledge | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);

  const filtered = useFilteredKnowledge(knowledge, filters, sort);
  const categories = useMemo(
    () => [...new Set(knowledge.map((k) => k.category))].sort(),
    [knowledge],
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const rows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const updateFilters = (patch: Partial<Filters>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
    setPage(1);
  };

  const handleReload = () => {
    setPage(1);
    setNotice(null);
    setUndoArchived(null);
    void reload();
  };

  const handleSort = (key: SortKey) => {
    setSort((current) => current.key === key
      ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
      : { key, direction: key === "title" || key === "category" || key === "mastery" ? "asc" : "desc" });
    setPage(1);
  };

  const selectReview = (review: ReviewFilter) => updateFilters({ review });
  const selectCategory = (category: string) => updateFilters({ category, review: "all" });

  const setQuizOpen = (open: boolean) => {
    const url = new URL(window.location.href);
    if (open) url.searchParams.set("view", "quiz");
    else url.searchParams.delete("view");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    setShowQuiz(open);
  };

  const openNew = () => {
    setActionError(null);
    setFormTarget(null);
  };

  const openEdit = (item: Knowledge) => {
    setSelected(null);
    setActionError(null);
    setFormTarget(item);
  };

  const saveKnowledge = async (draft: KnowledgeDraft) => {
    setActionError(null);
    try {
      if (formTarget) {
        await updateKnowledge(formTarget.id, formTarget.content_version, draft);
        setNotice("ナレッジを更新しました。");
      } else {
        await createKnowledge(draft);
        setNotice("ナレッジを追加しました。");
      }
      setFormTarget(undefined);
      setPage(1);
      setUndoArchived(null);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "保存に失敗しました。");
    }
  };

  const archiveKnowledge = async (item: Knowledge) => {
    if (!window.confirm(`「${item.title}」をアーカイブしますか？\n一覧から非表示になります。`)) return;
    setActionError(null);
    try {
      const archived = await updateKnowledge(item.id, item.content_version, { archived: true });
      setSelected(null);
      setNotice("ナレッジをアーカイブしました。");
      setUndoArchived(archived);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "アーカイブに失敗しました。");
    }
  };

  const restoreKnowledge = async (item: Knowledge) => {
    setActionError(null);
    try {
      await updateKnowledge(item.id, item.content_version, { archived: false });
      setUndoArchived(null);
      setNotice("ナレッジを復元しました。");
      setPage(1);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "復元に失敗しました。");
    }
  };

  if (showQuiz) {
    return (
      <Suspense fallback={<div className="msg">読み込み中...</div>}>
        <QuizView
          knowledge={knowledge}
          quizLog={quizLog}
          onExit={() => setQuizOpen(false)}
          onRecorded={reload}
        />
      </Suspense>
    );
  }

  return (
    <div className="app-page">
      <header className="app-header">
        <div className="head">
          <div className="page-heading">
            <span className="eyebrow">Personal knowledge</span>
            <h1>ナレッジ</h1>
            <p>学びを整理・確認</p>
          </div>
          <div className="head-actions">
            <a className="hub-link" href="https://personal-dashboard-7md.pages.dev/">← Hub</a>
            <button className="primary-button quiz-nav-button" onClick={() => setQuizOpen(true)}>▶ 復習する</button>
            <button onClick={handleReload} disabled={loading || mutating}>↻ 更新</button>
            <button
              className="archive-button"
              onClick={() => { setActionError(null); setArchiveOpen(true); }}
              disabled={loading || mutating}
            >
              アーカイブ {archivedKnowledge.length}件
            </button>
            <button className="primary-button" onClick={openNew} disabled={loading || mutating}>＋ ナレッジを追加</button>
          </div>
        </div>
      </header>

      <main className="wrap">

      {loading && <div className="msg">読み込み中...</div>}
      {!loading && error && <div className="err">エラー: {error}</div>}
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
          <StatsCards knowledge={knowledge} quizLog={quizLog} />
          <ReviewInsights
            knowledge={knowledge}
            onReviewSelect={selectReview}
            onCategorySelect={selectCategory}
          />

          <Suspense fallback={<div className="card chart-loading" role="status">グラフを読み込み中...</div>}>
            <DashboardCharts knowledge={knowledge} quizLog={quizLog} />
          </Suspense>

          <FilterBar
            filters={filters}
            categories={categories}
            resultCount={filtered.length}
            onChange={updateFilters}
          />
          <KnowledgeTable rows={rows} sort={sort} onSort={handleSort} onOpen={setSelected} />
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
          onClose={() => setSelected(null)}
          onEdit={() => openEdit(selected)}
          onArchive={() => void archiveKnowledge(selected)}
        />
      )}
      {formTarget !== undefined && (
        <KnowledgeFormModal
          key={formTarget?.id ?? "new"}
          knowledge={formTarget}
          categories={categories}
          saving={mutating}
          error={actionError}
          onClose={() => { setFormTarget(undefined); setActionError(null); }}
          onSave={saveKnowledge}
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
