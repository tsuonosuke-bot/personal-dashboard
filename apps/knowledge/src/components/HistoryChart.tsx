import {
  CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { DailyHistoryPoint } from "../lib/learningSummary";

const shortDate = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;

export function HistoryChart({ data }: { data: DailyHistoryPoint[] }) {

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 18, left: -20 }}>
        <CartesianGrid stroke="#e9e9e7" vertical={false} />
        <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 10 }} angle={-45} textAnchor="end" height={50} />
        <YAxis yAxisId="left" allowDecimals={false} tick={{ fontSize: 11 }} />
        <YAxis
          yAxisId="right"
          orientation="right"
          domain={[0, 100]}
          tick={{ fontSize: 11 }}
          width={40}
        />
        <Tooltip labelFormatter={(label) => shortDate(String(label))} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line
          yAxisId="left" type="monotone" dataKey="total" name="出題数"
          stroke="#66558c" dot={{ r: 2 }} strokeWidth={2}
        />
        <Line
          yAxisId="right" type="monotone" dataKey="accuracy" name="正答率(%)"
          stroke="#448361" dot={{ r: 2 }} strokeWidth={2} connectNulls
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
