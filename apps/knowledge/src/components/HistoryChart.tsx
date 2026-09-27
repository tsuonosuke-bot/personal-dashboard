import { useMemo } from "react";
import {
  CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { QuizLog } from "../types";

export function HistoryChart({ quizLog }: { quizLog: QuizLog[] }) {
  const data = useMemo(() => {
    const byDay = new Map<string, { total: number; correct: number }>();
    for (const q of quizLog) {
      const day = byDay.get(q.asked_on) ?? { total: 0, correct: 0 };
      day.total++;
      if (q.verdict === "正解") day.correct++;
      byDay.set(q.asked_on, day);
    }
    return [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, { total, correct }]) => ({
        date,
        total,
        accuracy: Math.round((correct / total) * 100),
      }));
  }, [quizLog]);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 18, left: -20 }}>
        <CartesianGrid stroke="#f1f5f9" vertical={false} />
        <XAxis dataKey="date" tick={{ fontSize: 10 }} angle={-45} textAnchor="end" height={50} />
        <YAxis yAxisId="left" allowDecimals={false} tick={{ fontSize: 11 }} />
        <YAxis
          yAxisId="right"
          orientation="right"
          domain={[0, 100]}
          tick={{ fontSize: 11 }}
          width={40}
        />
        <Tooltip />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line
          yAxisId="left" type="monotone" dataKey="total" name="出題数"
          stroke="#60a5fa" dot={{ r: 2 }} strokeWidth={2}
        />
        <Line
          yAxisId="right" type="monotone" dataKey="accuracy" name="正答率(%)"
          stroke="#4ade80" dot={{ r: 2 }} strokeWidth={2}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
