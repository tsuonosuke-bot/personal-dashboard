import { useState } from "react";
import { CategoryChart } from "./CategoryChart";
import { ChartCard } from "./ChartCard";
import { HistoryChart } from "./HistoryChart";
import { MasteryChart } from "./MasteryChart";
import { MasteryTrendChart } from "./MasteryTrendChart";
import { MemoryHoldChart, WeeklyAccuracyChart } from "./ProgressCharts";
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

/**
 * 学習の進み具合は「どれだけ覚えていられるか」（記憶のもち・復習の正答率）と日別の履歴で見る。
 * 毎日見る必要のない登録数・カテゴリ・習熟度のグラフは折りたたみ、開いたときだけ描く。
 */
export function DashboardCharts({ knowledge, registrationKnowledge, quizLog }: Props) {
  const [othersOpen, setOthersOpen] = useState(false);
  return (
    <>
      <div className="progress-heading">
        <h2>学習の進み具合</h2>
        <p>件数ではなく「どれだけ覚えていられるか」で見る</p>
      </div>
      <div className="charts">
        <MemoryHoldChart knowledge={knowledge} quizLog={quizLog} />
        <WeeklyAccuracyChart quizLog={quizLog} />
        <ChartCard id="history-chart" title="学習履歴（日別出題数・正答率）" summary={historySummary(quizLog)} full>
          <HistoryChart quizLog={quizLog} />
        </ChartCard>
      </div>
      <details className="other-charts" onToggle={(event) => setOthersOpen(event.currentTarget.open)}>
        <summary>その他のグラフ（登録数の推移・習熟度の推移・カテゴリ別分布・習熟度分布）</summary>
        {othersOpen && (
          <div className="charts">
            <RegistrationTrendChart knowledge={registrationKnowledge} />
            <MasteryTrendChart reloadKey={registrationKnowledge} />
            <ChartCard id="category-chart" title="カテゴリ別分布" summary={categorySummary(knowledge)}>
              <CategoryChart knowledge={knowledge} />
            </ChartCard>
            <ChartCard id="mastery-chart" title="習熟度分布" summary={masterySummary(knowledge)}>
              <MasteryChart knowledge={knowledge} />
            </ChartCard>
          </div>
        )}
      </details>
    </>
  );
}
