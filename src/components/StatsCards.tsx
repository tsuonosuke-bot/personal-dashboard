import type { Knowledge, QuizLog } from "../types";

interface Props {
  knowledge: Knowledge[];
  quizLog: QuizLog[];
}

export function StatsCards({ knowledge, quizLog }: Props) {
  const today = new Date().toISOString().slice(0, 10);
  const stats: [string, number][] = [
    ["総カード数", knowledge.length],
    ["定着済み", knowledge.filter((k) => k.mastery === "定着").length],
    ["本日復習予定", knowledge.filter((k) => k.next_review_on && k.next_review_on <= today).length],
    ["累計出題数", quizLog.length],
  ];

  return (
    <div className="stats">
      {stats.map(([label, value]) => (
        <div className="card" key={label}>
          <div className="stat-label">{label}</div>
          <div className="stat-value">{value}</div>
        </div>
      ))}
    </div>
  );
}
