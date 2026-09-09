import type { ReactNode } from "react";

interface Props {
  title: string;
  full?: boolean;
  children: ReactNode;
}

export function ChartCard({ title, full = false, children }: Props) {
  return (
    <div className={full ? "card full" : "card"}>
      <div className="chart-title">{title}</div>
      <div className="chart-box">{children}</div>
    </div>
  );
}
