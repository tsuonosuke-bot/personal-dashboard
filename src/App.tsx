import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { ArchivedKnowledgeModal } from "./components/ArchivedKnowledgeModal";
import { DailyReviewPanel } from "./components/DailyReviewPanel";
import { FilterBar } from "./components/FilterBar";
import { KnowledgeTable } from "./components/KnowledgeTable";
import { KnowledgeDetailModal } from "./components/KnowledgeDetailModal";
import { KnowledgeFormModal } from "./components/KnowledgeFormModal";
import { Pagination } from "./components/Pagination";
import { ReviewInsights } from "./components/ReviewInsights";
import { StatsCards } from "./components/StatsCards";
import { SpeakingPracticePanel } from "./components/SpeakingPracticePanel";
import { ALL, DEFAULT_PAGE_SIZE } from "./constants";
import { useFilteredKnowledge } from "./hooks/useFilteredKnowledge";
import { useDailyReview } from "./hooks/useDailyReview";
import { useKnowledgeData } from "./hooks/useKnowledgeData";
import { dashboardRoutePath, parseDashboardRoute } from "./lib/dashboardRoute";
import type {
  Filters, Knowledge, KnowledgeDraft, ReviewFilter, SortKey, SortState,
} from "./types";

const DashboardCharts = lazy(() => import("./components/DashboardCharts")
  .then((module) => ({ default: module.DashboardCharts })));
const QuizView = lazy(() => import("./components/QuizView")
  .then((module) => ({ default: module.QuizView })));
const SpeakingPracticeView = lazy(() => import("./components/SpeakingPracticeView")
  .then((module) => ({ default: module.SpeakingPracticeView })));

export default function App() {
  const initialRoute = parseDashboardRoute(window.location.href);
  const [showQuiz, setShowQuiz] = useState(() => initialRoute.kind === "quiz");
  const [showSpeaking, setShowSpeaking] = useState(() => initialRoute.kind === "speaking");
  const [quizMode, setQuizMode] = useState<"daily" | "custom">(() => (
    initialRoute.kind === "quiz" ? initialRoute.mode : "custom"
  ));
  const {
    knowledge, archivedKnowledge, quizLog, loading, error, mutating,
    reload, createKnowledge, updateKnowledge,
  } = useKnowledgeData();
  const dailyReview = useDailyReview();
  const [filters, setFilters] = useState<Filters>({
    search: "",
    category: ALL,
    mastery: ALL,
    priority: ALL,
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
  const registrationKnowledge = useMemo(
    () => [...knowledge, ...archivedKnowledge],
    [archivedKnowledge, knowledge],
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const rows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const replaceRoute = useCallback((route: Parameters<typeof dashboardRoutePath>[1]) => {
    window.history.replaceState(null, "", dashboardRoutePath(window.location.href, route));
  }, []);

  const applyDashboardRoute = useCallback((notify = true) => {
    const route = parseDashboardRoute(window.location.href);
    if (route.kind === "quiz") {
      setSelected(null);
      setArchiveOpen(false);
      setQuizMode(route.mode);
      setShowSpeaking(false);
      setShowQuiz(true);
      return;
    }

    if (route.kind === "speaking") {
      setSelected(null);
      setArchiveOpen(false);
      setShowQuiz(false);
      setShowSpeaking(true);
      return;
    }

    setShowQuiz(false);
    setShowSpeaking(false);
    if (loading || error) return;

    if (route.kind === "knowledge") {
      const active = knowledge.find((item) => item.id === route.knowledgeId);
      if (active) {
        setArchiveOpen(false);
        setSelected(active);
        return;
      }
      const archived = archivedKnowledge.find((item) => item.id === route.knowledgeId);
      setSelected(null);
      replaceRoute({ kind: "dashboard" });
      if (archived) {
        setArchiveOpen(true);
        if (notify) setNotice("対象のナレッジはアーカイブ済みです。アーカイブ一覧を表示します。");
      } else {
        setArchiveOpen(false);
        if (notify) setNotice("対象のナレッジが見つかりません。一覧を表示します。");
      }
      return;
    }

    setSelected(null);
    if (route.kind === "invalid-knowledge") {
      replaceRoute({ kind: "dashboard" });
      if (notify) setNotice("指定されたナレッジを開けません。一覧を表示します。");
    }
  }, [archivedKnowledge, error, knowledge, loading, replaceRoute]);

  useEffect(() => {
    applyDashboardRoute();
    const handlePopState = () => applyDashboardRoute();
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [applyDashboardRoute]);

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
      : { key, direction: key === "title" || key === "category" || key === "mastery" || key === "priority" ? "asc" : "desc" });
    setPage(1);
  };

  const selectReview = (review: ReviewFilter) => updateFilters({ review });
  const selectCategory = (category: string) => updateFilters({ category, review: "all" });

  const setQuizOpen = (open: boolean, mode: "daily" | "custom" = "custom") => {
    replaceRoute(open ? { kind: "quiz", mode } : { kind: "dashboard" });
    setSelected(null);
    setQuizMode(mode);
    setShowSpeaking(false);
    setShowQuiz(open);
  };

  const setSpeakingOpen = (open: boolean) => {
    replaceRoute(open ? { kind: "speaking" } : { kind: "dashboard" });
    setSelected(null);
    setShowQuiz(false);
    setShowSpeaking(open);
  };

  const openKnowledge = (item: Knowledge) => {
    setActionError(null);
    setSelected(item);
    window.history.pushState(
      { dashboardRoute: "knowledge" },
      "",
      dashboardRoutePath(window.location.href, { kind: "knowledge", knowledgeId: item.id }),
    );
  };

  const closeKnowledge = () => {
    const route = parseDashboardRoute(window.location.href);
    if (route.kind === "knowledge" && window.history.state?.dashboardRoute === "knowledge") {
      window.history.back();
      return;
    }
    setSelected(null);
    replaceRoute({ kind: "dashboard" });
  };

  const reloadAfterReview = async () => {
    await Promise.all([reload(), dailyReview.refresh()]);
  };

  const openNew = () => {
    setActionError(null);
    setFormTarget(null);
  };

  const openEdit = (item: Knowledge) => {
    replaceRoute({ kind: "dashboard" });
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
      replaceRoute({ kind: "dashboard" });
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
          autoStartDaily={quizMode === "daily"}
          dailyStatus={dailyReview.status}
          onRecorded={reloadAfterReview}
          onKnowledgeUpdate={updateKnowledge}
        />
      </Suspense>
    );
  }

  if (showSpeaking) {
    return (
      <Suspense fallback={<div className="msg">読み込み中...</div>}>
        <SpeakingPracticeView
          knowledge={knowledge}
          loading={loading}
          error={error}
          onExit={() => setSpeakingOpen(false)}
        />
      </Suspense>
    );
  }

  return (
    <div className="app-page">
      <header className="app-header">
        <div className="head">
          <div className="dashboard-brand">
            <span className="dashboard-brand-mark" aria-hidden="true">K</span>
            <span>
              <h1>Knowledge</h1>
              <small>学びを整理・確認</small>
            </span>
          </div>
          <div className="head-actions">
            <a className="hub-link" href="https://personal-dashboard-7md.pages.dev/">← Hub</a>
            <details className="dashboard-switcher">
              <summary aria-label="ページを切り替える">
                <svg className="dashboard-switcher-icon" viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="5" cy="6" r="1" /><circle cx="5" cy="12" r="1" /><circle cx="5" cy="18" r="1" />
                  <path d="M9 6h10M9 12h10M9 18h10" />
                </svg>
                <span>Dashboards</span>
              </summary>
              <nav aria-label="ダッシュボードを切り替え">
                <a href="https://personal-dashboard-7md.pages.dev/compass/">Idea</a>
                <a href="https://personal-dashboard-7md.pages.dev/writing/">Writing</a>
                <a href="https://personal-dashboard-7md.pages.dev/habits/">Habits</a>
                <a href="https://personal-dashboard-7md.pages.dev/go/financial">Finance</a>
                <span aria-current="page">Knowledge</span>
              </nav>
            </details>
            <span className={`source-badge ${error ? "error" : loading ? "loading" : "live"}`}>
              {error ? "取得失敗" : loading ? "接続確認中" : "SUPABASE LIVE"}
            </span>
            <button className="refresh-button" onClick={handleReload} disabled={loading || mutating} aria-label="データを再読み込み" title="再読み込み">↻</button>
            <button className="primary-button" onClick={openNew} disabled={loading || mutating}>＋ ナレッジを追加</button>
          </div>
        </div>
      </header>

      <main className="wrap">

      <div className="page-tools">
        <button
          className="archive-button"
          onClick={() => { setActionError(null); setArchiveOpen(true); }}
          disabled={loading || mutating}
        >
          アーカイブ {archivedKnowledge.length}件
        </button>
      </div>

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
          <DailyReviewPanel
            status={dailyReview.status}
            loading={dailyReview.loading}
            error={dailyReview.error}
            onStart={() => setQuizOpen(true, "daily")}
            onCustomStart={() => setQuizOpen(true, "custom")}
          />
          <SpeakingPracticePanel
            knowledge={knowledge}
            onStart={() => setSpeakingOpen(true)}
          />
          <StatsCards knowledge={knowledge} quizLog={quizLog} />
          <ReviewInsights
            knowledge={knowledge}
            onReviewSelect={selectReview}
            onCategorySelect={selectCategory}
          />

          <Suspense fallback={<div className="card chart-loading" role="status">グラフを読み込み中...</div>}>
            <DashboardCharts
              knowledge={knowledge}
              registrationKnowledge={registrationKnowledge}
              quizLog={quizLog}
            />
          </Suspense>

          <FilterBar
            filters={filters}
            categories={categories}
            resultCount={filtered.length}
            onChange={updateFilters}
          />
          <KnowledgeTable rows={rows} sort={sort} onSort={handleSort} onOpen={openKnowledge} />
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
