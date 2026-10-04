import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArchivedKnowledgeModal } from "./components/ArchivedKnowledgeModal";
import { DailyReviewPanel } from "./components/DailyReviewPanel";
import { FilterBar } from "./components/FilterBar";
import { KnowledgeTable } from "./components/KnowledgeTable";
import { KnowledgeDetailModal } from "./components/KnowledgeDetailModal";
import { KnowledgeFormModal } from "./components/KnowledgeFormModal";
import { Pagination } from "./components/Pagination";
import { ReviewInsights } from "./components/ReviewInsights";
import { StatsCards } from "./components/StatsCards";
import { ThemeSelect } from "./components/ThemeSelect";
import { SpeakingPracticePanel } from "./components/SpeakingPracticePanel";
import { ALL, DEFAULT_PAGE_SIZE } from "./constants";
import { useFilteredKnowledge } from "./hooks/useFilteredKnowledge";
import { useDailyReview } from "./hooks/useDailyReview";
import { useKnowledgeData } from "./hooks/useKnowledgeData";
import { useInsights } from "./hooks/useInsights";
import { useInsightGroups } from "./hooks/useInsightGroups";
import { useReviewQueueStatus } from "./hooks/useReviewQueueStatus";
import { dashboardRoutePath, parseDashboardRoute, type OrganizeTab } from "./lib/dashboardRoute";
import type {
  Filters, Knowledge, KnowledgeDraft, ReviewFilter, SortKey, SortState,
} from "./types";

const DashboardCharts = lazy(() => import("./components/DashboardCharts")
  .then((module) => ({ default: module.DashboardCharts })));
const ReviewView = lazy(() => import("./components/ReviewView")
  .then((module) => ({ default: module.ReviewView })));
const LearningLogView = lazy(() => import("./components/LearningLogView")
  .then((module) => ({ default: module.LearningLogView })));
const OrganizeView = lazy(() => import("./components/OrganizeView")
  .then((module) => ({ default: module.OrganizeView })));
const SpeakingPracticeView = lazy(() => import("./components/SpeakingPracticeView")
  .then((module) => ({ default: module.SpeakingPracticeView })));

export default function App() {
  const initialRoute = parseDashboardRoute(window.location.href);
  const [showQuiz, setShowQuiz] = useState(() => initialRoute.kind === "quiz");
  const [showSpeaking, setShowSpeaking] = useState(() => initialRoute.kind === "speaking");
  const [showLog, setShowLog] = useState(() => initialRoute.kind === "log");
  const [organize, setOrganize] = useState<{ tab: OrganizeTab; questionId: number | null } | null>(() => (
    initialRoute.kind === "organize" ? { tab: initialRoute.tab, questionId: initialRoute.questionId } : null
  ));
  const [quizMode, setQuizMode] = useState<"daily" | "custom">(() => (
    initialRoute.kind === "quiz" ? initialRoute.mode : "custom"
  ));
  const {
    knowledge, archivedKnowledge, quizLog, loading, error, mutating,
    reload, createKnowledge, updateKnowledge,
  } = useKnowledgeData();
  const dailyReview = useDailyReview();
  const reviewQueue = useReviewQueueStatus();
  const [logUnconfirmedOnly, setLogUnconfirmedOnly] = useState(false);
  const insightStore = useInsights();
  const insightGroupStore = useInsightGroups();
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

  // 画面を切り替えても同じdocumentのままなので、直前の画面のスクロール位置が残る。
  const view = showQuiz ? "quiz" : showSpeaking ? "speaking" : showLog ? "log" : organize ? "organize" : "dashboard";
  const previousView = useRef(view);
  useLayoutEffect(() => {
    if (previousView.current === view) return;
    previousView.current = view;
    window.scrollTo(0, 0);
  }, [view]);

  const filtered = useFilteredKnowledge(knowledge, filters, sort);
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
      setShowLog(false);
      setOrganize(null);
      setShowQuiz(true);
      return;
    }

    if (route.kind === "speaking" || route.kind === "log" || route.kind === "organize") {
      setSelected(null);
      setArchiveOpen(false);
      setShowQuiz(false);
      setShowSpeaking(route.kind === "speaking");
      setShowLog(route.kind === "log");
      setOrganize(route.kind === "organize" ? { tab: route.tab, questionId: route.questionId } : null);
      return;
    }

    setShowQuiz(false);
    setShowSpeaking(false);
    setShowLog(false);
    setOrganize(null);
    if (loading || error) return;

    if (route.kind === "knowledge") {
      const active = knowledge.find((item) => item.id === route.knowledgeId);
      if (active) {
        setArchiveOpen(false);
        setSelected(active);
        return;
      }
      const archived = archivedKnowledge.find((item) => item.id === route.knowledgeId);
      if (archived) {
        setArchiveOpen(false);
        setSelected(archived);
      } else {
        setSelected(null);
        replaceRoute({ kind: "dashboard" });
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
    setShowLog(false);
    setOrganize(null);
    setShowQuiz(open);
    void reviewQueue.refresh();
  };

  const setSpeakingOpen = (open: boolean) => {
    replaceRoute(open ? { kind: "speaking" } : { kind: "dashboard" });
    setSelected(null);
    setShowQuiz(false);
    setShowLog(false);
    setOrganize(null);
    setShowSpeaking(open);
  };

  const setLogOpen = (open: boolean, unconfirmedOnly = false) => {
    replaceRoute(open ? { kind: "log" } : { kind: "dashboard" });
    setLogUnconfirmedOnly(open && unconfirmedOnly);
    if (!open) void reviewQueue.refresh();
    setSelected(null);
    setShowQuiz(false);
    setShowSpeaking(false);
    setOrganize(null);
    setShowLog(open);
  };

  const setOrganizeOpen = (tab: OrganizeTab | null) => {
    replaceRoute(tab ? { kind: "organize", tab, questionId: null } : { kind: "dashboard" });
    setSelected(null);
    setShowQuiz(false);
    setShowSpeaking(false);
    setShowLog(false);
    setOrganize(tab ? { tab, questionId: null } : null);
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
    await Promise.all([reload(), dailyReview.refresh(), reviewQueue.refresh()]);
  };

  const openNew = () => {
    setActionError(null);
    setFormTarget(null);
  };

  const openEdit = (item: Knowledge) => {
    replaceRoute({ kind: "dashboard" });
    setOrganize(null);
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
      setOrganize(null);
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
        <ReviewView
          knowledge={registrationKnowledge}
          queueStatus={reviewQueue.status}
          onExit={() => setQuizOpen(false)}
          autoStartDaily={quizMode === "daily"}
          onRecorded={reloadAfterReview}
          onOpenResults={() => setLogOpen(true, true)}
          onOpenLog={() => setLogOpen(true)}
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

  if (organize) {
    return (
      <Suspense fallback={<div className="msg">読み込み中...</div>}>
        <OrganizeView
          tab={organize.tab}
          questionId={organize.questionId}
          allKnowledge={registrationKnowledge}
          activeKnowledge={knowledge}
          insightStore={insightStore}
          groupStore={insightGroupStore}
          loading={loading}
          error={error}
          onTabChange={(tab) => setOrganizeOpen(tab)}
          onOpenKnowledge={openKnowledge}
          onExit={() => setOrganizeOpen(null)}
        />
        {selected && (
          <KnowledgeDetailModal
            knowledge={selected}
            quizLog={quizLog}
            mutating={mutating}
            onClose={closeKnowledge}
            onEdit={() => openEdit(selected)}
            onArchive={() => void archiveKnowledge(selected)}
            insightStore={insightStore}
            insightGroupStore={insightGroupStore}
          />
        )}
      </Suspense>
    );
  }

  if (showLog) {
    return (
      <Suspense fallback={<div className="msg">読み込み中...</div>}>
        <LearningLogView
          knowledge={registrationKnowledge}
          quizLog={quizLog}
          loading={loading}
          error={error}
          onExit={() => setLogOpen(false)}
          initialUnconfirmedOnly={logUnconfirmedOnly}
          onKnowledgeUpdate={updateKnowledge}
          onReload={reloadAfterReview}
          insightStore={insightStore}
          insightGroupStore={insightGroupStore}
          onOpenKnowledge={(id) => {
            const item = knowledge.find((entry) => entry.id === id);
            if (item) openKnowledge(item);
          }}
        />
        {/* 問題を作れなかったカードを直せるよう、採点結果の出典（読み取り専用）とは別に編集できる詳細で開く。 */}
        {selected && (
          <KnowledgeDetailModal
            knowledge={selected}
            quizLog={quizLog}
            mutating={mutating}
            onClose={closeKnowledge}
            onEdit={() => { setLogOpen(false); openEdit(selected); }}
            onArchive={() => void archiveKnowledge(selected)}
            insightStore={insightStore}
            insightGroupStore={insightGroupStore}
          />
        )}
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
              <div className="dashboard-switcher-menu">
                <nav aria-label="ダッシュボードを切り替え">
                  <a href="https://personal-dashboard-7md.pages.dev/compass/">Idea</a>
                  <a href="https://personal-dashboard-7md.pages.dev/writing/">Writing</a>
                  <a href="https://personal-dashboard-7md.pages.dev/habits/">Habits</a>
                  <a href="https://personal-dashboard-7md.pages.dev/go/financial">Finance</a>
                  <span aria-current="page">Knowledge</span>
                  <a href="https://personal-dashboard-7md.pages.dev/status/">接続状態</a>
                </nav>
                <ThemeSelect />
              </div>
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
        <button className="page-tool-link" onClick={() => setLogOpen(true)}>学習ログ</button>
        <button className="page-tool-link" onClick={() => setOrganizeOpen("questions")}>
          問い・示唆・タグ（示唆 {insightStore.insights.length}件）
        </button>
        <a className="page-tool-link" href="api/export">JSON書き出し</a>
        <a className="page-tool-link" href="https://personal-dashboard-7md.pages.dev/status/">接続状態</a>
        <button
          className="archive-button"
          onClick={() => { setActionError(null); setArchiveOpen(true); }}
          disabled={loading || mutating}
        >
          アーカイブ {archivedKnowledge.length}件
        </button>
      </div>

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
          <DailyReviewPanel
            status={dailyReview.status}
            loading={dailyReview.loading}
            error={dailyReview.error}
            onStart={() => setQuizOpen(true, "daily")}
            queueStatus={reviewQueue.status}
            onOpenResults={() => setLogOpen(true, true)}
            onOpenLog={() => setLogOpen(true)}
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
          onEdit={selected.archived ? undefined : () => openEdit(selected)}
          onArchive={selected.archived ? undefined : () => void archiveKnowledge(selected)}
          insightStore={insightStore}
          insightGroupStore={insightGroupStore}
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
