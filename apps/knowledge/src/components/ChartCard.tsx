import type { ReactNode } from "react";

interface Props {
  title: string;
  id: string;
  summary: string;
  full?: boolean;
  children: ReactNode;
}

export function ChartCard({ title, id, summary, full = false, children }: Props) {
  return (
    <section className={full ? "card full" : "card"} aria-labelledby={`${id}-title`}>
      <div className="chart-title" id={`${id}-title`}>{title}</div>
      <div className="chart-box" role="img" aria-describedby={`${id}-summary`}>{children}</div>
      <p className="chart-summary" id={`${id}-summary`}>{summary}</p>
    </section>
  );
}
