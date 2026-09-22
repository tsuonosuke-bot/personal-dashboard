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

export function DashboardCharts({ knowledge, registrationKnowledge, quizLog }: Props) {
  return (
    <div className="charts">
      <RegistrationTrendChart knowledge={registrationKnowledge} />
      <ChartCard title="カテゴリ別分布">
        <CategoryChart knowledge={knowledge} />
      </ChartCard>
      <ChartCard title="習熟度分布">
        <MasteryChart knowledge={knowledge} />
      </ChartCard>
      <ChartCard title="学習履歴（日別出題数・正答率）" full>
        <HistoryChart quizLog={quizLog} />
      </ChartCard>
    </div>
  );
}
