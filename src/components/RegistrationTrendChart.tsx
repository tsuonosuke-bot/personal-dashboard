import { useMemo, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { buildRegistrationTrend, type RegistrationTrendGranularity } from "../lib/registrationTrend";
import type { Knowledge } from "../types";

export function RegistrationTrendChart({ knowledge }: { knowledge: Knowledge[] }) {
  const [granularity, setGranularity] = useState<RegistrationTrendGranularity>("day");
  const data = useMemo(
    () => buildRegistrationTrend(knowledge, granularity),
    [granularity, knowledge],
  );
  const total = data.reduce((sum, point) => sum + point.count, 0);
  const periodLabel = granularity === "day" ? "直近30日" : "直近12週";
  const peak = data.reduce((current, point) => point.count > current.count ? point : current, data[0] ?? { label: "", count: 0 });
  const summary = total === 0
    ? `${periodLabel}の新規登録はありません。`
    : `${periodLabel}の新規登録は合計${total}件です。最も多い期間は${peak.label}の${peak.count}件です。`;

  return (
    <section className="card full registration-trend-card" aria-labelledby="registration-trend-title">
      <div className="chart-heading">
        <div>
          <div className="chart-title" id="registration-trend-title">新規学習数の推移</div>
          <p>{periodLabel}・登録日時をJSTで集計（アーカイブ済みを含む）</p>
        </div>
        <div className="chart-period-switch" aria-label="集計期間">
          <button
            type="button"
            aria-pressed={granularity === "day"}
            onClick={() => setGranularity("day")}
          >
            30日
          </button>
          <button
            type="button"
            aria-pressed={granularity === "week"}
            onClick={() => setGranularity("week")}
          >
            12週
          </button>
        </div>
      </div>
      {total === 0 ? (
        <div className="chart-empty" role="status">この期間の新規登録はありません。</div>
      ) : (
        <div
          className="chart-box registration-trend-box"
          role="img"
          aria-describedby="registration-trend-summary"
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: -20 }}>
              <CartesianGrid stroke="#f1f5f9" vertical={false} />
              <XAxis
                dataKey="label"
                interval="preserveStartEnd"
                minTickGap={granularity === "day" ? 22 : 12}
                tick={{ fontSize: 10 }}
              />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(value) => [`${value}件`, "新規学習"]} />
              <Bar dataKey="count" name="新規学習" fill="#66558c" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      <p className="chart-summary" id="registration-trend-summary">{summary}</p>
    </section>
  );
}
