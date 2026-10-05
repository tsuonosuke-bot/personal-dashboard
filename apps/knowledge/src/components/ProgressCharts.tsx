import { useState, type CSSProperties, type MouseEvent } from "react";
import { memoryHold, weeklyReviewAccuracy } from "../lib/learningSummary";
import type { Knowledge, QuizLog } from "../types";

interface Tip { x: number; y: number; text: string }

/** マウスを重ねたときの小さな説明。値は棒の横に常に出しているので、割合と件数を補う。 */
function useTip() {
  const [tip, setTip] = useState<Tip | null>(null);
  const bind = (text: string) => ({
    onMouseMove: (event: MouseEvent) => setTip({ x: event.clientX, y: event.clientY, text }),
    onMouseLeave: () => setTip(null),
  });
  const node = tip ? <div className="progress-tip" style={{ left: tip.x + 12, top: tip.y + 12 }} role="presentation">{tip.text}</div> : null;
  return { bind, node };
}

function percent(value: number, total: number): number {
  return total > 0 ? Math.round((value / total) * 100) : 0;
}

/** 記憶のもち: 次に忘れるまでの見込み期間ごとのカード数。件数の多さではなく、どれだけ覚えていられるかで見る。 */
export function MemoryHoldChart({ knowledge, quizLog }: { knowledge: Knowledge[]; quizLog: QuizLog[] }) {
  const { buckets, unasked, total, atLeastWeek } = memoryHold(knowledge, quizLog);
  const max = Math.max(1, unasked, ...buckets.map((bucket) => bucket.count));
  const { bind, node } = useTip();
  const summary = total === 0
    ? "登録中のナレッジはありません。"
    : `7日以上もつカードは${atLeastWeek}枚（全${total}枚の${percent(atLeastWeek, total)}%）。`
      + (unasked > 0 ? `未出題の${unasked}枚は、出題されると上のどれかに入ります。` : "");
  return (
    <section className="card progress-card" aria-labelledby="memory-hold-title">
      <h3 id="memory-hold-title">記憶のもち</h3>
      <p className="progress-sub">次に忘れるまでの見込み期間ごとのカード数（全{total}枚）</p>
      <div className="hold-bars" role="img" aria-describedby="memory-hold-summary">
        {buckets.map((bucket) => (
          <div className="hold-bar" key={bucket.key} {...bind(`${bucket.label}: ${bucket.count}枚（${percent(bucket.count, total)}%）`)}>
            <span>{bucket.label}</span>
            <i style={{ width: `${(bucket.count / max) * 100}%` }} />
            <b>{bucket.count}</b>
          </div>
        ))}
        <div className="hold-sep" />
        <div className="hold-bar unasked" {...bind(`未出題: ${unasked}枚（${percent(unasked, total)}%）`)}>
          <span>未出題</span>
          <i style={{ width: `${(unasked / max) * 100}%` }} />
          <b>{unasked}</b>
        </div>
      </div>
      <p className="chart-summary" id="memory-hold-summary">{summary}</p>
      {node}
    </section>
  );
}

function weekLabel(start: string, partial: boolean): string {
  if (partial) return "今週";
  const [, month, day] = start.split("-").map(Number);
  return `${month}/${day}週`;
}

/** 復習の正答率（週別）: 2回目以降の出題だけ。今週は集計途中として斜線で示す。 */
export function WeeklyAccuracyChart({ quizLog }: { quizLog: QuizLog[] }) {
  const weeks = weeklyReviewAccuracy(quizLog);
  const { bind, node } = useTip();
  const finished = weeks.filter((week) => !week.partial && week.accuracy !== null).slice(-4);
  const current = weeks[weeks.length - 1];
  const rates = finished.map((week) => Math.round((week.accuracy ?? 0) * 100));
  const summary = finished.length === 0
    ? "復習の記録がまだありません。"
    : `直近${finished.length}週は${Math.min(...rates)}〜${Math.max(...rates)}%。`
      + (current.answered > 0 ? `今週は集計途中（${current.answered}問・${Math.round((current.accuracy ?? 0) * 100)}%）です。` : "今週はまだ復習していません。");
  return (
    <section className="card progress-card" aria-labelledby="weekly-accuracy-title">
      <h3 id="weekly-accuracy-title">復習の正答率（週別）</h3>
      <p className="progress-sub">2回目以降の出題だけ。新しく覚える分は含めない</p>
      <div className="accuracy-bars" role="img" aria-describedby="weekly-accuracy-summary">
        <div className="accuracy-axis" aria-hidden="true">
          <div style={{ bottom: "100%" }}><span>100%</span></div>
          <div style={{ bottom: "50%" }}><span>50%</span></div>
          <div style={{ bottom: 0 }}><span>0%</span></div>
        </div>
        {weeks.map((week) => {
          const value = week.accuracy === null ? null : Math.round(week.accuracy * 100);
          return (
            <div
              className={`accuracy-col${week.partial ? " partial" : ""}`}
              key={week.weekStart}
              {...bind(`${weekLabel(week.weekStart, week.partial)}: ${value === null ? "記録なし" : `正答率 ${value}%・${week.answered}問`}${week.partial ? "（集計途中）" : ""}`)}
            >
              <div className="accuracy-plot" style={{ "--h": `${value ?? 0}%` } as CSSProperties}>
                {value !== null && <b>{value}%</b>}
                <i style={{ height: `${value ?? 0}%` }} />
              </div>
              <span>{weekLabel(week.weekStart, week.partial)}</span>
            </div>
          );
        })}
      </div>
      <p className="chart-summary" id="weekly-accuracy-summary">{summary}</p>
      {node}
    </section>
  );
}
