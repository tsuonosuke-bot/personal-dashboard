import type { Knowledge, QuizLog } from "../types";
import { getReviewCounts } from "../lib/knowledge";

interface Props {
  knowledge: Knowledge[];
  quizLog: QuizLog[];
}

export function StatsCards({ knowledge, quizLog }: Props) {
  const review = getReviewCounts(knowledge);
  const stats: [string, number][] = [
    ["総カード数", knowledge.length],
    ["定着済み", knowledge.filter((k) => k.mastery === "定着").length],
    ["本日までの復習対象", review.due],
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
