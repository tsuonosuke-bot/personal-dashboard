import { useMemo, useState } from "react";
import { getJstToday } from "../lib/knowledge";
import {
  ALL_CATEGORIES, buildLearningLog, type LearningLogFilters, type LearningLogPeriod,
} from "../lib/learningLog";
import { Pagination } from "./Pagination";
import { SpeakingLogPanel } from "./SpeakingLogPanel";
import type { Knowledge, QuizLog, QuizVerdict } from "../types";

interface Props {
  knowledge: Knowledge[];
  quizLog: QuizLog[];
  loading: boolean;
  error: string | null;
  onExit: () => void;
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

export function LearningLogView({ knowledge, quizLog, loading, error, onExit }: Props) {
  const [tab, setTab] = useState<"review" | "speaking">("review");
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
  const entries = useMemo(
    () => buildLearningLog(quizLog, knowledge, filters, getJstToday()),
    [filters, knowledge, quizLog],
  );
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
          <p className="learning-log-summary" aria-live="polite">
            {entries.length}件・正解{correct}件
            {entries.length > 0 && `（正答率${Math.round((correct / entries.length) * 100)}%）`}
          </p>
        </div>

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
                {entry.note && <p className="learning-log-note">{entry.note}</p>}
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
    </div>
  );
}
