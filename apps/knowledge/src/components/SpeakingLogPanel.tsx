import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { getSpeakingPracticeLog } from "../lib/api";
import { getJstToday } from "../lib/knowledge";
import type { LearningLogPeriod } from "../lib/learningLog";
import {
  buildSpeakingLog, SPEAKING_RATING_LABELS, SPEAKING_TYPE_LABELS, speakingDailyCounts, speakingPeriodStart,
  speakingSummary, type SpeakingLogFilters,
} from "../lib/speakingLog";
import type { Knowledge, SpeakingPracticeLog, SpeakingPracticeRating, SpeakingPracticeType } from "../types";
import { Pagination } from "./Pagination";

interface Props {
  knowledge: Knowledge[];
  periodOptions: { value: LearningLogPeriod; label: string }[];
}

/** 練習記録は少量なので、全件を一度だけ取得して画面側で絞り込む。 */
const ALL_TIME = "2000-01-01T00:00:00.000Z";
const RATINGS: SpeakingPracticeRating[] = ["smooth", "almost", "retry"];
const TYPES: SpeakingPracticeType[] = ["instant_composition", "read_aloud"];

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" });
}

function shortDate(value: string): string {
  return `${Number(value.slice(5, 7))}/${Number(value.slice(8, 10))}`;
}

export function SpeakingLogPanel({ knowledge, periodOptions }: Props) {
  const [logs, setLogs] = useState<SpeakingPracticeLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<SpeakingLogFilters>({ period: "30", type: "all", rating: "all" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(30);

  useEffect(() => {
    let active = true;
    getSpeakingPracticeLog(ALL_TIME)
      .then((items) => { if (active) setLogs(items); })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "練習記録を取得できませんでした。"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const today = getJstToday();
  const entries = useMemo(() => buildSpeakingLog(logs, knowledge, filters, today), [filters, knowledge, logs, today]);
  const from = speakingPeriodStart(filters.period, today, logs);
  const daily = useMemo(() => speakingDailyCounts(entries, from, today), [entries, from, today]);
  const summary = speakingSummary(entries);
  const totalPages = Math.max(1, Math.ceil(entries.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const rows = entries.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const shownRatings = filters.rating === "all" ? RATINGS : [filters.rating];

  const updateFilters = (patch: Partial<SpeakingLogFilters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  };

  return (
    <>
      <div className="learning-log-filters card">
        <label>
          期間
          <select value={filters.period} onChange={(event) => updateFilters({ period: event.target.value as LearningLogPeriod })}>
            {periodOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label>
          練習
          <select value={filters.type} onChange={(event) => updateFilters({ type: event.target.value as SpeakingLogFilters["type"] })}>
            <option value="all">すべて</option>
            {TYPES.map((type) => <option key={type} value={type}>{SPEAKING_TYPE_LABELS[type]}</option>)}
          </select>
        </label>
        <label>
          評価
          <select value={filters.rating} onChange={(event) => updateFilters({ rating: event.target.value as SpeakingLogFilters["rating"] })}>
            <option value="all">すべて</option>
            {RATINGS.map((rating) => <option key={rating} value={rating}>{SPEAKING_RATING_LABELS[rating]}</option>)}
          </select>
        </label>
        <p className="learning-log-summary" aria-live="polite">
          {summary.total}回・{summary.days}日練習
          {summary.smoothRate !== null && `・「言えた」${summary.smoothRate}%`}
        </p>
      </div>

      {error && <div className="err compact" role="alert">{error}</div>}
      {loading && <div className="msg">読み込み中...</div>}

      {!loading && !error && (
        <section className="speaking-log-chart card" aria-label="日別の練習回数">
          <div className="speaking-log-chart-head">
            <h2>日別の練習回数</h2>
            <ul className="speaking-log-legend" aria-label="評価の凡例">
              {shownRatings.map((rating) => (
                <li key={rating}><span className={`speaking-swatch speaking-swatch-${rating}`} aria-hidden="true" />{SPEAKING_RATING_LABELS[rating]}</li>
              ))}
            </ul>
          </div>
          <div className="chart-box">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={daily} margin={{ top: 8, right: 8, bottom: 0, left: -20 }} barCategoryGap="20%">
                <CartesianGrid stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 11 }} minTickGap={16} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip
                  labelFormatter={(value) => String(value)}
                  formatter={(value, name) => [`${value}回`, SPEAKING_RATING_LABELS[name as SpeakingPracticeRating] ?? String(name)]}
                />
                {shownRatings.map((rating) => (
                  <Bar key={rating} dataKey={rating} stackId="rating" className={`speaking-bar-${rating}`}
                    fill="currentColor" isAnimationActive={false} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      {!loading && !error && entries.length === 0 && <div className="msg">条件に合う練習記録はありません。</div>}

      {rows.length > 0 && (
        <ol className="learning-log-list">
          {rows.map((entry) => (
            <li key={entry.id} className="learning-log-item card">
              <div className="learning-log-head">
                <time dateTime={entry.practiced_at}>{entry.practiced_on} {formatTime(entry.practiced_at)}</time>
                <span className={`badge speaking-rating-${entry.rating}`}>{SPEAKING_RATING_LABELS[entry.rating]}</span>
                <span className="quiz-result-format">{SPEAKING_TYPE_LABELS[entry.practice_type]}</span>
                {entry.practice_type === "read_aloud" && <span className="learning-log-category">音読{entry.repetitions}回</span>}
              </div>
              <strong className="learning-log-title">{entry.title}</strong>
              {entry.answer_text && <p className="learning-log-note">{entry.answer_text}</p>}
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
    </>
  );
}
