import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useFilteredKnowledge } from "./useFilteredKnowledge";
import type { useReviewQueueStatus } from "./useReviewQueueStatus";
import { dashboardRoutePath, parseDashboardRoute, type OrganizeTab } from "../lib/dashboardRoute";
import { DEFAULT_FILTERS, listStatePath, parseListState, sameListState, type ListState } from "../lib/listState";
import type { NoteSelection } from "../components/NotesPanel";
import type { ReviewScope } from "../components/ReviewView";
import type { Filters, Knowledge, SortKey, SortState } from "../types";

/** 整理ページのタブと、ノートタブで開いている問い・テーマ。 */
type OrganizeState = { tab: OrganizeTab; questionId: number | null; theme: string | null };
type Options = {
  knowledge: Knowledge[]; archivedKnowledge: Knowledge[]; loading: boolean; error: string | null;
  reviewQueue: Pick<ReturnType<typeof useReviewQueueStatus>, "refresh">;
  setNotice: Dispatch<SetStateAction<string | null>>;
  setActionError: Dispatch<SetStateAction<string | null>>;
};

/** URL・一覧条件・画面間の往復を一か所で管理する。データ更新の成否は扱わない。 */
export function useKnowledgeNavigation({ knowledge, archivedKnowledge, loading, error, reviewQueue, setNotice, setActionError }: Options) {
  const initialRoute = parseDashboardRoute(window.location.href);
  const [showQuiz, setShowQuiz] = useState(() => initialRoute.kind === "quiz");
  const [showSpeaking, setShowSpeaking] = useState(() => initialRoute.kind === "speaking");
  const [showLog, setShowLog] = useState(() => initialRoute.kind === "log");
  const [showSearch, setShowSearch] = useState(() => initialRoute.kind === "search");
  const [showHelp, setShowHelp] = useState(() => initialRoute.kind === "help");
  /** 整理ページの「使い方」から開いたときは、その節を表示し、戻るときは整理ページへ戻す。 */
  const [helpFrom, setHelpFrom] = useState<OrganizeState | null>(null);
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
  const [logUnconfirmedOnly, setLogUnconfirmedOnly] = useState(false);
  // 一覧の状態はURLが正本（#137）。初期表示・戻る・再読込・共有URLのどれでも同じ一覧を開く。
  const [initialList] = useState(() => parseListState(window.location.href));
  const [filters, setFilters] = useState<Filters>(initialList.filters);
  const [sort, setSort] = useState<SortState>(initialList.sort);
  const [page, setPage] = useState(initialList.page);
  const [pageSize, setPageSize] = useState(initialList.pageSize);
  const [selected, setSelected] = useState<Knowledge | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);

  // 画面を切り替えても同じdocumentのままなので、直前の画面のスクロール位置が残る。
  const view = showQuiz ? "quiz" : showSpeaking ? "speaking" : showLog ? "log" : showSearch ? "search" : showHelp ? "help" : organize ? "organize" : "dashboard";

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
      setShowHelp(false);
      setOrganize(null);
      setShowQuiz(true);
      return;
    }

    if (route.kind === "speaking" || route.kind === "log" || route.kind === "search" || route.kind === "help" || route.kind === "organize") {
      setSelected(null);
      setArchiveOpen(false);
      setShowQuiz(false);
      setShowSpeaking(route.kind === "speaking");
      setShowLog(route.kind === "log");
      setShowSearch(route.kind === "search");
      setShowHelp(route.kind === "help");
      setOrganize(route.kind === "organize" ? { tab: route.tab, questionId: route.questionId, theme: route.theme ?? null } : null);
      return;
    }

    setShowQuiz(false);
    setShowSpeaking(false);
    setShowLog(false);
    setShowSearch(false);
    setShowHelp(false);
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
  }, [applyListState, archivedKnowledge, error, knowledge, loading, replaceRoute, setNotice]);

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

  const handleSort = (key: SortKey) => {
    setSort((current) => current.key === key
      ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
      : { key, direction: key === "title" || key === "category" || key === "mastery" || key === "priority" ? "asc" : "desc" });
    setPage(1);
  };

  const setQuizOpen = (open: boolean, mode: "daily" | "custom" = "custom") => {
    replaceRoute(open ? { kind: "quiz", mode } : { kind: "dashboard" });
    setReviewScope(null);
    setSelected(null);
    setQuizMode(mode);
    setShowSpeaking(false);
    setShowLog(false);
    setShowSearch(false);
    setShowHelp(false);
    setOrganize(null);
    setShowQuiz(open);
    void reviewQueue.refresh();
  };

  const setSpeakingOpen = (open: boolean) => {
    replaceRoute(open ? { kind: "speaking" } : { kind: "dashboard" });
    setSelected(null);
    setShowHelp(false);
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
    setShowHelp(false);
    setShowQuiz(false);
    setShowSpeaking(false);
    setShowSearch(false);
    setOrganize(null);
    setShowLog(open);
  };

  const setSearchOpen = (open: boolean) => {
    replaceRoute(open ? { kind: "search" } : { kind: "dashboard" });
    setSelected(null);
    setShowHelp(false);
    setShowQuiz(false);
    setShowSpeaking(false);
    setShowLog(false);
    setOrganize(null);
    setShowSearch(open);
  };

  const setHelpOpen = (open: boolean) => {
    setHelpFrom(null);
    replaceRoute(open ? { kind: "help" } : { kind: "dashboard" });
    setSelected(null);
    setShowQuiz(false);
    setShowSpeaking(false);
    setShowLog(false);
    setShowSearch(false);
    setOrganize(null);
    setShowHelp(open);
  };

  const setOrganizeOpen = (tab: OrganizeTab | null) => {
    replaceRoute(tab ? { kind: "organize", tab, questionId: null } : { kind: "dashboard" });
    setSelected(null);
    setShowHelp(false);
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
    setShowHelp(false);
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

  return { showQuiz, showSpeaking, showLog, showSearch, showHelp, helpFrom, setHelpFrom,
    organize, setOrganize, reviewScope, quizMode, logUnconfirmedOnly, selected, setSelected,
    archiveOpen, setArchiveOpen, filters, sort, setSort, pageSize, setPageSize, setPage,
    filtered, totalPages, currentPage, rows, view, replaceRoute, clearFilters, updateFilters,
    handleSort, setQuizOpen, setSpeakingOpen, setLogOpen, setSearchOpen, setHelpOpen,
    setOrganizeOpen, noteSelection, selectNote, reviewNote, exitReview, openKnowledge,
    closeKnowledge, setShowHelp, setShowSearch };
}

export type KnowledgeNavigation = ReturnType<typeof useKnowledgeNavigation>;
