import type { DailyReviewStatus, ReviewQueueStatus } from "../types";
import { ReviewCategoryCounts } from "./ReviewCategoryCounts";
import { ReviewQueueSummary } from "./ReviewQueueSummary";

interface Props {
  status: DailyReviewStatus | null;
  loading: boolean;
  error: string | null;
  onStart: () => void;
  /** 問題キューの件数。出題ボタンは期限が来た出題待ちの問題数で決める。 */
  queueStatus: ReviewQueueStatus | null;
  onOpenResults: () => void;
  onOpenLog: () => void;
}

function retryTime(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleTimeString("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function DailyReviewPanel({
  status, loading, error, onStart, queueStatus, onOpenResults, onOpenLog,
}: Props) {
  const progress = status && status.total > 0 ? Math.round((status.completed / status.total) * 100) : 0;
  const readyDue = queueStatus?.ready_due ?? 0;
  const nextRetry = retryTime(status?.next_retry_at ?? null);
  const buttonLabel = readyDue > 0
    ? `復習を始める（${readyDue}問）`
    : status && status.remaining > 0
      ? "問題を準備中"
      : status?.retry_waiting
        ? "再復習待ち"
        : "今すぐの復習は完了";

  return (
    <section className="daily-review card" aria-labelledby="daily-review-heading">
      <div className="daily-review-head">
        <div>
          <span className="eyebrow">Daily review</span>
          <h2 id="daily-review-heading">今日の復習キュー</h2>
        </div>
        <div className="daily-review-actions">
          <button
            className="primary-button"
            disabled={loading || readyDue === 0}
            onClick={onStart}
          >
            {buttonLabel}
          </button>
        </div>
      </div>

      {loading && <p className="muted">キューを確認中...</p>}
      {error && <div className="err compact" role="alert">{error}</div>}
      {status && (
        <>
          <div className="daily-review-metrics">
            <div><span>今日の回答</span><strong>{status.completed}</strong><small>{status.completed_unique}問を復習</small></div>
            <div><span>今すぐ</span><strong>{status.remaining}</strong><small>期限が来たナレッジ</small></div>
            <div><span>再学習</span><strong>{status.retry_ready}</strong><small>{status.retry_waiting}件が時刻待ち</small></div>
            <div><span>期限超過</span><strong>{status.overdue_total}</strong><small>要消化</small></div>
            <div><span>新規の保留</span><strong>{status.new_held}</strong><small>新規は1日{status.new_limit}件まで</small></div>
          </div>
          <div className="daily-progress" aria-label={`今日の復習作業 ${progress}%`}>
            <span style={{ width: `${progress}%` }} />
          </div>
          <ReviewQueueSummary status={queueStatus} onOpenResults={onOpenResults} onOpenLog={onOpenLog} />
          <ReviewCategoryCounts items={status.remaining_by_category} total={status.remaining} />
          <div className="daily-review-note">
            <p>
              復習はキューの上から順に、問題がある限り解き続けられます。答えた分はその都度記録されるので、
              途中で終えても大丈夫です。問題は30分ごとに、期限が来たナレッジの分をまとめて作ります。回答は15分ごとに自動で採点され、
              結果と講評は学習ログで確認できます。
            </p>
            <p>
              基準間隔: q0=10分、q1=30分、q2=6時間、q3=12時間、q4=2日以上、q5=4日以上。
              q4・q5は保持できた期間に応じて伸び（q4は2倍、q5は2.8倍）、q0〜q3は段階別の時刻に戻ります。
              q4・q5の間隔には優先度の倍率（最高0.5・高1・中1.5・低2・最低3倍）がかかります。
              未出題の新規は1日{status.new_limit}件までキューに入り、超えた分は「今すぐ」に数えず翌日以降に回します。
              15件中、通常の期限到来が5件以上あれば再学習は最大10件です。
              {status.retry_waiting > 0 && (
                <> 現在{status.retry_waiting}件が待機中{nextRetry ? `（最短 ${nextRetry}頃）` : ""}です。</>
              )}
            </p>
          </div>
        </>
      )}
    </section>
  );
}
