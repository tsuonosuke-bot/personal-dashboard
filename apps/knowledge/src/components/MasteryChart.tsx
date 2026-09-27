import { useMemo } from "react";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { MASTERY_COLORS, MASTERY_ORDER } from "../constants";
import type { Knowledge } from "../types";

export function MasteryChart({ knowledge }: { knowledge: Knowledge[] }) {
  const data = useMemo(
    () =>
      MASTERY_ORDER.map((mastery) => ({
        mastery,
        count: knowledge.filter((k) => k.mastery === mastery).length,
      })),
    [knowledge],
  );

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
        <XAxis dataKey="mastery" tick={{ fontSize: 12 }} />
        <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
        <Tooltip cursor={{ fill: "#f1f5f9" }} />
        <Bar dataKey="count" name="件数" radius={[4, 4, 0, 0]}>
          {data.map((d) => (
            <Cell key={d.mastery} fill={MASTERY_COLORS[d.mastery]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
