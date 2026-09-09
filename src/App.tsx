import { useMemo, useState } from "react";
import { CategoryChart } from "./components/CategoryChart";
import { ChartCard } from "./components/ChartCard";
import { FilterBar } from "./components/FilterBar";
import { HistoryChart } from "./components/HistoryChart";
import { KnowledgeTable } from "./components/KnowledgeTable";
import { KnowledgeDetailModal } from "./components/KnowledgeDetailModal";
import { KnowledgeFormModal } from "./components/KnowledgeFormModal";
import { MasteryChart } from "./components/MasteryChart";
import { Pagination } from "./components/Pagination";
import { ReviewInsights } from "./components/ReviewInsights";
import { StatsCards } from "./components/StatsCards";
import { ALL, DEFAULT_PAGE_SIZE } from "./constants";
import { useFilteredKnowledge } from "./hooks/useFilteredKnowledge";
import { useKnowledgeData } from "./hooks/useKnowledgeData";
import type { Filters, Knowledge, KnowledgeDraft, ReviewFilter, SortKey, SortState } from "./types";

export default function App() {
  const {
    knowledge, quizLog, loading, error, mutating,
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
        await updateKnowledge(formTarget.id, draft);
        setNotice("ナレッジを更新しました。");
      } else {
        await createKnowledge(draft);
        setNotice("ナレッジを追加しました。");
      }
      setFormTarget(undefined);
      setPage(1);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "保存に失敗しました。");
    }
  };

  const archiveKnowledge = async (item: Knowledge) => {
    if (!window.confirm(`「${item.title}」をアーカイブしますか？\n一覧から非表示になります。`)) return;
    setActionError(null);
    try {
      await updateKnowledge(item.id, { archived: true });
      setSelected(null);
      setNotice("ナレッジをアーカイブしました。");
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "アーカイブに失敗しました。");
    }
  };

  return (
    <div className="wrap">
      <div className="head">
        <div>
          <span className="eyebrow">PERSONAL KNOWLEDGE BASE</span>
          <h1>ナレッジDB ダッシュボード</h1>
        </div>
        <div className="head-actions">
          <button onClick={handleReload} disabled={loading}>↻ 更新</button>
          <button className="primary-button" onClick={openNew}>＋ ナレッジを追加</button>
        </div>
      </div>

      {loading && <div className="msg">読み込み中...</div>}
      {!loading && error && <div className="err">エラー: {error}</div>}
      {notice && <div className="notice" role="status">{notice}<button aria-label="閉じる" onClick={() => setNotice(null)}>×</button></div>}
      {formTarget === undefined && actionError && <div className="err compact" role="alert">{actionError}</div>}

      {!loading && !error && (
        <>
          <StatsCards knowledge={knowledge} quizLog={quizLog} />
          <ReviewInsights
            knowledge={knowledge}
            onReviewSelect={selectReview}
            onCategorySelect={selectCategory}
          />

          <div className="charts">
            <ChartCard title="カテゴリ別分布">
              <CategoryChart knowledge={knowledge} />
            </ChartCard>
            <ChartCard title="習熟度分布">
              <MasteryChart knowledge={knowledge} />
            </ChartCard>
            <ChartCard title="学習履歴（日別出題数・正答率）" full>
              <HistoryChart quizLog={quizLog} />
            </ChartCard>
          </div>

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
    </div>
  );
}
