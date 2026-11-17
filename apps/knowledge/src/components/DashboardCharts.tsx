import { useMemo, useState } from "react";
import { CategoryChart } from "./CategoryChart";
import { ChartCard } from "./ChartCard";
import { HistoryChart } from "./HistoryChart";
import { MasteryChart } from "./MasteryChart";
import { MasteryTrendChart } from "./MasteryTrendChart";
import { MemoryHoldChart, WeeklyAccuracyChart } from "./ProgressCharts";
import { RegistrationTrendChart } from "./RegistrationTrendChart";
import type { Knowledge } from "../types";
import { summaryMemory, type LearningSummary } from "../lib/learningReadApi";
import { HISTORY_CHART_DAYS, recentHistory } from "../lib/learningSummary";

interface Props {
  knowledge: Knowledge[];
  registrationKnowledge: Knowledge[];
  summary: LearningSummary;
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

/**
 * 学習の進み具合は「どれだけ覚えていられるか」（記憶のもち・復習の正答率）と日別の履歴で見る。
 * 各グラフの定義の説明はヘルプページに置く。
 * 毎日見る必要のない登録数・カテゴリ・習熟度のグラフは折りたたみ、開いたときだけ描く。
 */
export function DashboardCharts({ knowledge, registrationKnowledge, summary }: Props) {
  const [othersOpen, setOthersOpen] = useState(false);
  const memory = useMemo(() => summaryMemory(summary), [summary]);
  const history = useMemo(() => recentHistory(summary.history, summary.date), [summary]);
  const total = history.reduce((sum, row) => sum + row.total, 0);
  const correct = history.reduce((sum, row) => sum + row.correct, 0);
  const latest = [...history].reverse().find((row) => row.total > 0);
  const historyText = latest
    ? `直近${HISTORY_CHART_DAYS}日の回答は${total}件、正答率は${Math.round(correct / total * 100)}%です。最後に回答した${latest.date}は${latest.total}問でした。`
    : `直近${HISTORY_CHART_DAYS}日の回答はありません。`;
  return (
    <>
      <div className="progress-heading">
        <h2>学習の進み具合</h2>
      </div>
      <div className="charts">
        <MemoryHoldChart data={memory} />
        <WeeklyAccuracyChart data={summary.weekly} />
        <ChartCard id="history-chart" title={`学習履歴（直近${HISTORY_CHART_DAYS}日の出題数・正答率）`} summary={historyText} full>
          <HistoryChart data={history} />
        </ChartCard>
      </div>
      <details className="other-charts" onToggle={(event) => setOthersOpen(event.currentTarget.open)}>
        <summary>その他のグラフ</summary>
        {othersOpen && (
          <div className="charts">
            <RegistrationTrendChart knowledge={registrationKnowledge} registrationDays={summary.registrationDays} />
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
