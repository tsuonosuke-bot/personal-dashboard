import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArchivedKnowledgeModal } from "./components/ArchivedKnowledgeModal";
import { FilterBar } from "./components/FilterBar";
import { KnowledgeTable } from "./components/KnowledgeTable";
import { KnowledgeDetailModal } from "./components/KnowledgeDetailModal";
import { KnowledgeFormModal } from "./components/KnowledgeFormModal";
import { Pagination } from "./components/Pagination";
import { MissedReviewSheet } from "./components/MissedReviewSheet";
import { TodayLearningPanel } from "./components/TodayLearningPanel";
import { ThemeSelect } from "./components/ThemeSelect";
import { SpeakingPracticePanel } from "./components/SpeakingPracticePanel";
import { useFilteredKnowledge } from "./hooks/useFilteredKnowledge";
import { useDailyReview } from "./hooks/useDailyReview";
import { useKnowledgeData } from "./hooks/useKnowledgeData";
import { useInsights } from "./hooks/useInsights";
import { useInsightGroups } from "./hooks/useInsightGroups";
import { useReviewQueueStatus } from "./hooks/useReviewQueueStatus";
import { confirmReviewResults } from "./lib/api";
import { dashboardRoutePath, parseDashboardRoute, type OrganizeTab } from "./lib/dashboardRoute";
import { DEFAULT_FILTERS, listStatePath, parseListState, sameListState, type ListState } from "./lib/listState";
import { missesToReview } from "./lib/learningSummary";
import type { NoteSelection } from "./components/NotesPanel";
import type { ReviewScope } from "./components/ReviewView";
import type {
  Filters, Knowledge, KnowledgeDraft, SortKey, SortState,
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
const SemanticSearchView = lazy(() => import("./components/SemanticSearchView")
  .then((module) => ({ default: module.SemanticSearchView })));

/** 整理ページのタブと、ノートタブで開いている問い・テーマ。 */
type OrganizeState = { tab: OrganizeTab; questionId: number | null; theme: string | null };

export default function App() {
  const initialRoute = parseDashboardRoute(window.location.href);
  const [showQuiz, setShowQuiz] = useState(() => initialRoute.kind === "quiz");
  const [showSpeaking, setShowSpeaking] = useState(() => initialRoute.kind === "speaking");
  const [showLog, setShowLog] = useState(() => initialRoute.kind === "log");
  const [showSearch, setShowSearch] = useState(() => initialRoute.kind === "search");
  const [organize, setOrganize] = useState<OrganizeState | null>(() => (
    initialRoute.kind === "organize"
      ? { tab: initialRoute.tab, questionId: initialRoute.questionId, theme: initialRoute.theme ?? null }
      : null
  ));
  /** ノートから始めた復習（#96）。終えたらそのノートへ戻る。 */
  const [reviewScope, setReviewScope] = useState<(ReviewScope & { returnTo: NoteSelection }) | null>(null);
  const [quizMode, setQuizMode] = useState<"daily" | "custom">(() => (
    initialRoute.kind === "quiz" ? initialRoute.mode : "custom"
  ));
  const {
    knowledge, archivedKnowledge, quizLog, loading, error, mutating,
    reload, createKnowledge, updateKnowledge, removeAutoTag, restoreAutoTag, markConfirmed,
  } = useKnowledgeData();
  const dailyReview = useDailyReview();
  const reviewQueue = useReviewQueueStatus();
  const [logUnconfirmedOnly, setLogUnconfirmedOnly] = useState(false);
  const insightStore = useInsights();
  const insightGroupStore = useInsightGroups();
  // 一覧の状態はURLが正本（#137）。初期表示・戻る・再読込・共有URLのどれでも同じ一覧を開く。
  const [initialList] = useState(() => parseListState(window.location.href));
  const [filters, setFilters] = useState<Filters>(initialList.filters);
  const [sort, setSort] = useState<SortState>(initialList.sort);
  const [page, setPage] = useState(initialList.page);
  const [pageSize, setPageSize] = useState(initialList.pageSize);
  const [selected, setSelected] = useState<Knowledge | null>(null);
  const [formTarget, setFormTarget] = useState<Knowledge | null | undefined>(undefined);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [undoArchived, setUndoArchived] = useState<Knowledge | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [missesOpen, setMissesOpen] = useState(false);

  // 画面を切り替えても同じdocumentのままなので、直前の画面のスクロール位置が残る。
  const view = showQuiz ? "quiz" : showSpeaking ? "speaking" : showLog ? "log" : showSearch ? "search" : organize ? "organize" : "dashboard";

  // クイズ中は下部タブバーを隠す（回答・模範解答の画面を広く使う）
  useEffect(() => {
    document.body.classList.toggle("quiz-open", showQuiz);
    return () => document.body.classList.remove("quiz-open");
  }, [showQuiz]);
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
  const knowledgeById = useMemo(
    () => new Map(registrationKnowledge.map((item) => [item.id, item])),
    [registrationKnowledge],
  );
  const misses = useMemo(() => missesToReview(quizLog), [quizLog]);

  const listState = useMemo<ListState>(() => ({ filters, sort, page, pageSize }), [filters, sort, page, pageSize]);
  const listStateRef = useRef(listState);
  useEffect(() => { listStateRef.current = listState; }, [listState]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const rows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const replaceRoute = useCallback((route: Parameters<typeof dashboardRoutePath>[1]) => {
    window.history.replaceState(null, "", dashboardRoutePath(window.location.href, route));
  }, []);

  const applyListState = useCallback((next: ListState) => {
    setFilters(next.filters);
    setSort(next.sort);
    setPage(next.page);
    setPageSize(next.pageSize);
  }, []);

  const applyDashboardRoute = useCallback((notify = true) => {
    const route = parseDashboardRoute(window.location.href);
    // 戻る・進むでは、その時点のURLにある一覧条件へ戻す。
    const urlList = parseListState(window.location.href);
    if (!sameListState(urlList, listStateRef.current)) applyListState(urlList);
    if (route.kind === "quiz") {
      setSelected(null);
      setArchiveOpen(false);
      setQuizMode(route.mode);
      setShowSpeaking(false);
      setShowLog(false);
      setShowSearch(false);
      setOrganize(null);
      setShowQuiz(true);
      return;
    }

    if (route.kind === "speaking" || route.kind === "log" || route.kind === "search" || route.kind === "organize") {
      setSelected(null);
      setArchiveOpen(false);
      setShowQuiz(false);
      setShowSpeaking(route.kind === "speaking");
      setShowLog(route.kind === "log");
      setShowSearch(route.kind === "search");
      setOrganize(route.kind === "organize" ? { tab: route.tab, questionId: route.questionId, theme: route.theme ?? null } : null);
      return;
    }

    setShowQuiz(false);
    setShowSpeaking(false);
    setShowLog(false);
    setShowSearch(false);
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
  }, [applyListState, archivedKnowledge, error, knowledge, loading, replaceRoute]);

  useEffect(() => {
    applyDashboardRoute();
    const handlePopState = () => applyDashboardRoute();
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [applyDashboardRoute]);

  // 一覧の操作ごとに履歴を増やさないよう、URLは置き換える。画面やナレッジのパラメータはそのまま残る。
  useEffect(() => {
    const path = listStatePath(window.location.href, listState);
    if (path !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      window.history.replaceState(window.history.state, "", path);
    }
  }, [listState]);

  const clearFilters = () => {
    setFilters(DEFAULT_FILTERS);
    setPage(1);
  };

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

  const confirmMiss = async (quizLogId: number) => {
    await confirmReviewResults([quizLogId]);
    markConfirmed([quizLogId]);
    void reviewQueue.refresh();
  };

  const setQuizOpen = (open: boolean, mode: "daily" | "custom" = "custom") => {
    replaceRoute(open ? { kind: "quiz", mode } : { kind: "dashboard" });
    setReviewScope(null);
    setSelected(null);
    setQuizMode(mode);
    setShowSpeaking(false);
    setShowLog(false);
    setShowSearch(false);
    setOrganize(null);
    setShowQuiz(open);
    void reviewQueue.refresh();
  };

  const setSpeakingOpen = (open: boolean) => {
    replaceRoute(open ? { kind: "speaking" } : { kind: "dashboard" });
    setSelected(null);
    setShowQuiz(false);
    setShowLog(false);
    setShowSearch(false);
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
    setShowSearch(false);
    setOrganize(null);
    setShowLog(open);
  };

  const setSearchOpen = (open: boolean) => {
    replaceRoute(open ? { kind: "search" } : { kind: "dashboard" });
    setSelected(null);
    setShowQuiz(false);
    setShowSpeaking(false);
    setShowLog(false);
    setOrganize(null);
    setShowSearch(open);
  };

  const setOrganizeOpen = (tab: OrganizeTab | null) => {
    replaceRoute(tab ? { kind: "organize", tab, questionId: null } : { kind: "dashboard" });
    setSelected(null);
    setShowQuiz(false);
    setShowSpeaking(false);
    setShowLog(false);
    setShowSearch(false);
    setOrganize(tab ? { tab, questionId: null, theme: null } : null);
  };

  const noteSelection: NoteSelection | null = organize?.tab !== "notes" ? null
    : organize.questionId !== null ? { kind: "question", id: organize.questionId }
      : organize.theme ? { kind: "theme", tag: organize.theme } : null;

  const selectNote = (note: NoteSelection | null) => {
    const next: OrganizeState = {
      tab: "notes",
      questionId: note?.kind === "question" ? note.id : null,
      theme: note?.kind === "theme" ? note.tag : null,
    };
    replaceRoute({ kind: "organize", ...next });
    setSelected(null);
    setShowQuiz(false);
    setShowSpeaking(false);
    setShowLog(false);
    setShowSearch(false);
    setOrganize(next);
  };

  /** ノートのナレッジのうち期限が来たものだけを復習する。終えたらノートへ戻る。 */
  const reviewNote = (scope: ReviewScope) => {
    if (!noteSelection) return;
    setQuizOpen(true, "custom");
    setReviewScope({ ...scope, returnTo: noteSelection });
  };

  const exitReview = () => {
    if (reviewScope) {
      void reviewQueue.refresh();
      selectNote(reviewScope.returnTo);
      setReviewScope(null);
      return;
    }
    setQuizOpen(false);
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

  // 自動タグを外したら、開いている詳細にもすぐ反映する。
  const removeAutoTagFrom = async (item: Knowledge, tag: string) => {
    setActionError(null);
    try {
      await removeAutoTag(item.id, tag);
      setSelected((current) => (current && current.id === item.id
        ? { ...current, auto_tags: current.auto_tags.filter((name) => name !== tag) }
        : current));
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "自動タグを外せませんでした。");
    }
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
    setShowSearch(false);
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
      setShowSearch(false);
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
          quizLog={quizLog}
          queueStatus={reviewQueue.status}
          onExit={exitReview}
          autoStartDaily={quizMode === "daily"}
          scope={reviewScope}
          onRecorded={reloadAfterReview}
          onKnowledgeUpdate={updateKnowledge}
          insightStore={insightStore}
          insightGroupStore={insightGroupStore}
          onOpenResults={() => setLogOpen(true, true)}
          onOpenLog={() => setLogOpen(true)}
          missCount={misses.length}
          onOpenMisses={() => { setQuizOpen(false); setMissesOpen(true); }}
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
          noteSelection={noteSelection}
          onNoteSelect={selectNote}
          onReviewNote={reviewNote}
          onRemoveAutoTag={removeAutoTag}
          onRestoreAutoTag={restoreAutoTag}
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
            onRemoveAutoTag={(tag) => void removeAutoTagFrom(selected, tag)}
          />
        )}
      </Suspense>
    );
  }

  if (showSearch) {
    return (
      <Suspense fallback={<div className="msg">読み込み中...</div>}>
        <SemanticSearchView
          knowledge={registrationKnowledge}
          onOpenKnowledge={openKnowledge}
          onExit={() => setSearchOpen(false)}
        />
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
            onRemoveAutoTag={(tag) => void removeAutoTagFrom(selected, tag)}
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
                  <a href="https://personal-dashboard-7md.pages.dev/projects/">Projects</a>
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
