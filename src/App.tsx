import { useMemo, useState } from "react";
import { CategoryChart } from "./components/CategoryChart";
import { ChartCard } from "./components/ChartCard";
import { FilterBar } from "./components/FilterBar";
import { HistoryChart } from "./components/HistoryChart";
import { KnowledgeTable } from "./components/KnowledgeTable";
import { MasteryChart } from "./components/MasteryChart";
import { Pagination } from "./components/Pagination";
import { StatsCards } from "./components/StatsCards";
import { ALL, PAGE_SIZE } from "./constants";
import { useFilteredKnowledge } from "./hooks/useFilteredKnowledge";
import { useKnowledgeData } from "./hooks/useKnowledgeData";
import type { Filters } from "./types";

export default function App() {
  const { knowledge, quizLog, loading, error, reload } = useKnowledgeData();
  const [filters, setFilters] = useState<Filters>({
    search: "",
    category: ALL,
    mastery: ALL,
  });
  const [page, setPage] = useState(1);

  const filtered = useFilteredKnowledge(knowledge, filters);
  const categories = useMemo(
    () => [...new Set(knowledge.map((k) => k.category))].sort(),
    [knowledge],
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const rows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const updateFilters = (patch: Partial<Filters>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
    setPage(1);
  };

  const handleReload = () => {
    setPage(1);
    void reload();
  };

  return (
    <div className="wrap">
      <div className="head">
        <h1>ナレッジDB ダッシュボード</h1>
        <button onClick={handleReload} disabled={loading}>🔄 更新</button>
      </div>

      {loading && <div className="msg">読み込み中...</div>}
      {!loading && error && <div className="err">エラー: {error}</div>}

      {!loading && !error && (
        <>
          <StatsCards knowledge={knowledge} quizLog={quizLog} />

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
          <KnowledgeTable rows={rows} />
          <Pagination page={currentPage} totalPages={totalPages} onChange={setPage} />
        </>
      )}
    </div>
  );
}
