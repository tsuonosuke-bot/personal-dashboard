import { CategoryChart } from "./CategoryChart";
import { ChartCard } from "./ChartCard";
import { HistoryChart } from "./HistoryChart";
import { MasteryChart } from "./MasteryChart";
import { RegistrationTrendChart } from "./RegistrationTrendChart";
import type { Knowledge, QuizLog } from "../types";

interface Props {
  knowledge: Knowledge[];
  registrationKnowledge: Knowledge[];
  quizLog: QuizLog[];
}

function categorySummary(knowledge: Knowledge[]): string {
  if (knowledge.length === 0) return "登録中のナレッジはありません。";
  const counts = new Map<string, number>();
  knowledge.forEach((item) => counts.set(item.category, (counts.get(item.category) ?? 0) + 1));
  const [category, count] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return `全${knowledge.length}件のうち、最も多いカテゴリは「${category}」の${count}件です。`;
}

function masterySummary(knowledge: Knowledge[]): string {
  if (knowledge.length === 0) return "習熟度を集計できるナレッジはありません。";
  const counts = new Map<string, number>();
  knowledge.forEach((item) => counts.set(item.mastery, (counts.get(item.mastery) ?? 0) + 1));
  const [mastery, count] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return `全${knowledge.length}件のうち、最も多い習熟度は「${mastery}」の${count}件です。`;
}

function historySummary(quizLog: QuizLog[]): string {
  if (quizLog.length === 0) return "回答履歴はまだありません。";
  const correct = quizLog.filter((item) => item.verdict === "正解").length;
  const latestDate = [...quizLog].sort((a, b) => b.asked_on.localeCompare(a.asked_on))[0].asked_on;
  const latestCount = quizLog.filter((item) => item.asked_on === latestDate).length;
  return `回答履歴は全${quizLog.length}件、正答率は${Math.round((correct / quizLog.length) * 100)}%です。直近の${latestDate}は${latestCount}問でした。`;
}

export function DashboardCharts({ knowledge, registrationKnowledge, quizLog }: Props) {
  return (
    <div className="charts">
      <RegistrationTrendChart knowledge={registrationKnowledge} />
      <ChartCard id="category-chart" title="カテゴリ別分布" summary={categorySummary(knowledge)}>
        <CategoryChart knowledge={knowledge} />
      </ChartCard>
      <ChartCard id="mastery-chart" title="習熟度分布" summary={masterySummary(knowledge)}>
        <MasteryChart knowledge={knowledge} />
      </ChartCard>
      <ChartCard id="history-chart" title="学習履歴（日別出題数・正答率）" summary={historySummary(quizLog)} full>
        <HistoryChart quizLog={quizLog} />
      </ChartCard>
    </div>
  );
}
