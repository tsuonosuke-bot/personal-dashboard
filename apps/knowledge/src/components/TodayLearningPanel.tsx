import { categoryBreakdown, todayAnswers } from "../lib/learningSummary";
import type { DailyReviewStatus, QuizLog, ReviewQueueStatus } from "../types";

interface Props {
  status: DailyReviewStatus | null;
  loading: boolean;
  error: string | null;
  /** 問題キューの件数。出題ボタンは期限が来た出題待ちの問題数で決める。 */
  queueStatus: ReviewQueueStatus | null;
  quizLog: QuizLog[];
  /** 見直す講評（未確認の不正解・部分正解）の件数。 */
  missCount: number;
  missWrong: number;
  missPartial: number;
  onStart: () => void;
  onOpenMisses: () => void;
  onOpenLog: () => void;
}

function clockTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" });
}

/**
 * 今日の学習: 今すぐ解ける問題・今日の回答・見直す講評の3つに絞って示す。
 * 出題間隔などの仕組みの説明は折りたたみに置く。
 */
export function TodayLearningPanel({
  status, loading, error, queueStatus, quizLog, missCount, missWrong, missPartial, onStart, onOpenMisses, onOpenLog,
}: Props) {
  const readyDue = queueStatus?.ready_due ?? 0;
  const today = todayAnswers(quizLog);
  const buttonLabel = readyDue > 0
    ? `復習を始める（${readyDue}問）`
    : status && status.remaining > 0
      ? "問題を準備中"
      : status?.retry_waiting
        ? "再復習待ち"
        : "今すぐの復習は完了";
  const breakdown = status ? categoryBreakdown(status.remaining_by_category) : [];
  const nextRetry = clockTime(status?.next_retry_at);
  const lastGenerated = clockTime(queueStatus?.last_generate?.at);

  return (
    <section className="card today-learning" aria-labelledby="today-learning-heading">
      <div className="today-learning-head">
        <div>
          <span className="eyebrow">Daily review</span>
          <h2 id="today-learning-heading">今日の学習</h2>
        </div>
        <button className="primary-button today-learning-start" disabled={loading || readyDue === 0} onClick={onStart}>
          {buttonLabel}
        </button>
      </div>

      {loading && <p className="muted">キューを確認中...</p>}
      {error && <div className="err compact" role="alert">{error}</div>}

      <div className="today-learning-metrics">
        <div className="today-metric">
          <span>今すぐ解ける</span>
          <strong>{readyDue}<small>問</small></strong>
          <em>
            {status
              ? <>期限超過 {status.overdue_total}・再学習 {status.retry_ready}{status.retry_waiting > 0 && `（ほか${status.retry_waiting}件が時刻待ち${nextRetry ? `、最短 ${nextRetry}頃` : ""}）`}</>
              : "期限が来た出題待ちの問題"}
          </em>
        </div>
        <div className="today-metric">
          <span>今日の回答</span>
          <strong>
            {today.answered}<small>問{today.accuracy !== null && ` · 正答率 ${Math.round(today.accuracy * 100)}%`}</small>
          </strong>
          <em>{today.answered > 0 ? `${today.cards}枚を復習` : "まだ回答していません"}</em>
        </div>
        <div className={`today-metric${missCount > 0 ? " attention" : ""}`}>
          <span>見直す講評</span>
          <div className="today-metric-value">
            <strong>{missCount}<small>件</small></strong>
            {missCount > 0 && <button className="today-metric-action" onClick={onOpenMisses}>見直す</button>}
          </div>
          <em>{missCount > 0 ? `不正解 ${missWrong}・部分正解 ${missPartial}（正解の講評は確認不要）` : "外した問題の講評はすべて確認済み"}</em>
        </div>
      </div>

      {(status || queueStatus) && (
        <p className="today-learning-line">
          {breakdown.length > 0 && (
            <span>内訳: {breakdown.map((item, index) => (
              <span key={item.label}>{index > 0 && "・"}{index === 0 ? <b>{item.label} {item.count}</b> : `${item.label} ${item.count}`}</span>
            ))}</span>
          )}
          {queueStatus && <span>採点待ち {queueStatus.waiting_grading}件{queueStatus.grading_errors > 0 && `（採点エラー ${queueStatus.grading_errors}件）`}</span>}
          {status && status.new_held > 0 && <span>新規は保留 {status.new_held}件（1日{status.new_limit}件まで）</span>}
          {queueStatus && queueStatus.generation_held > 0 && (
            <span>問題を作れず保留 {queueStatus.generation_held}件 <button className="text-button" onClick={onOpenLog}>学習ログで見る</button></span>
          )}
          {lastGenerated && <span>最後の問題生成 {lastGenerated}{queueStatus?.last_generate?.added != null && `（${queueStatus.last_generate.added}問）`}</span>}
        </p>
      )}
      {queueStatus?.queue_full && (
        <p className="review-queue-full" role="status">
          出題待ちの問題が上限の{queueStatus.queue_limit}件に達しているため、新しい問題の追加を止めています。
          問題を解いて件数が減ると、追加を再開します。
        </p>
      )}

      {status && (
        <details className="today-learning-how">
          <summary>出題の仕組み（間隔・新規の上限）</summary>
          <p>
            復習はキューの上から順に、問題がある限り解き続けられます。答えた分はその都度記録されるので、
            途中で終えても大丈夫です。問題は30分ごとに、期限が来たナレッジの分をまとめて作ります。回答は1時間ごとに自動で採点され、
            外した問題の講評は「見直す講評」から確認できます。
          </p>
          <p>
            基準間隔: q0=10分、q1=30分、q2=6時間、q3=12時間、q4=2日以上、q5=4日以上。
            q4・q5は保持できた期間に応じて伸び（q4は2倍、q5は2.8倍）、q0〜q3は段階別の時刻に戻ります。
            正解・不正解を問わず、次回までの間隔には優先度の倍率（最高0.5・高1・中1.5・低2・最低3倍）がかかります。
            未出題の新規は1日{status.new_limit}件までキューに入り、超えた分は「今すぐ」に数えず翌日以降に回します。
            15件中、通常の期限到来が5件以上あれば再学習は最大10件です。
          </p>
        </details>
      )}
    </section>
  );
}
