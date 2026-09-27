import { useMemo, useState } from "react";
import {
  CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { MASTERY_COLORS } from "../constants";
import { useMasteryHistory } from "../hooks/useMasteryHistory";
import { buildMasteryTrend } from "../lib/masteryTrend";
import type { RegistrationTrendGranularity } from "../lib/registrationTrend";

export function MasteryTrendChart({ reloadKey }: { reloadKey: unknown }) {
  const { events, loading, error } = useMasteryHistory(reloadKey);
  const [granularity, setGranularity] = useState<RegistrationTrendGranularity>("day");
  const { points, trackingSince } = useMemo(
    () => buildMasteryTrend(events, granularity),
    [events, granularity],
  );
  const periodLabel = granularity === "day" ? "直近30日" : "直近12週";
  const last = points[points.length - 1];
  const firstTracked = points.find((point) => point.learning !== null);
  const summary = !last || last.learning === null || last.mastered === null
    ? "習熟度の記録がまだありません。"
    : `現在は習得中${last.learning}件・定着${last.mastered}件です。`
      + (firstTracked && firstTracked !== last && firstTracked.learning !== null && firstTracked.mastered !== null
        ? `${periodLabel}の記録開始時点から習得中${signed(last.learning - firstTracked.learning)}件、定着${signed(last.mastered - firstTracked.mastered)}件です。`
        : "");

  return (
    <section className="card full registration-trend-card" aria-labelledby="mastery-trend-title">
      <div className="chart-heading">
        <div>
          <div className="chart-title" id="mastery-trend-title">習得中・定着の件数推移</div>
          <p>
            {periodLabel}・各期間末の件数（アーカイブ済みを含む）
            {trackingSince && `・${trackingSince}から記録`}
          </p>
        </div>
        <div className="chart-period-switch" aria-label="集計期間">
          <button type="button" aria-pressed={granularity === "day"} onClick={() => setGranularity("day")}>30日</button>
          <button type="button" aria-pressed={granularity === "week"} onClick={() => setGranularity("week")}>12週</button>
        </div>
      </div>
      {error ? (
        <div className="chart-empty" role="alert">{error}</div>
      ) : loading && events.length === 0 ? (
        <div className="chart-empty" role="status">読み込み中...</div>
      ) : !trackingSince ? (
        <div className="chart-empty" role="status">習熟度の記録がまだありません。</div>
      ) : (
        <div className="chart-box registration-trend-box" role="img" aria-describedby="mastery-trend-summary">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={points} margin={{ top: 8, right: 8, bottom: 8, left: -20 }}>
              <CartesianGrid stroke="#f1f5f9" vertical={false} />
              <XAxis
                dataKey="label"
                interval="preserveStartEnd"
                minTickGap={granularity === "day" ? 22 : 12}
                tick={{ fontSize: 10 }}
              />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(value, name) => [`${value}件`, name]} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="linear" dataKey="learning" name="習得中" stroke={MASTERY_COLORS.習得中} strokeWidth={2} dot={false} connectNulls={false} />
              <Line type="linear" dataKey="mastered" name="定着" stroke={MASTERY_COLORS.定着} strokeWidth={2} dot={false} connectNulls={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <p className="chart-summary" id="mastery-trend-summary">{summary}</p>
    </section>
  );
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}
