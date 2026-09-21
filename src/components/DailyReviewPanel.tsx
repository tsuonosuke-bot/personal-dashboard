import type { DailyReviewStatus } from "../types";
import { ReviewCategoryCounts } from "./ReviewCategoryCounts";

interface Props {
  status: DailyReviewStatus | null;
  loading: boolean;
  error: string | null;
  onStart: () => void;
  onCustomStart: () => void;
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

export function DailyReviewPanel({ status, loading, error, onStart, onCustomStart }: Props) {
  const progress = status && status.total > 0 ? Math.round((status.completed / status.total) * 100) : 0;
  const nextBatch = status ? Math.min(status.limit, status.remaining) : 0;
  const nextRetry = retryTime(status?.next_retry_at ?? null);
  const buttonLabel = nextBatch > 0
    ? `次の${nextBatch}件を開始`
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
          <button onClick={onCustomStart}>カテゴリ・問題数を選ぶ</button>
          <button
            className="primary-button"
            disabled={loading || !status || status.remaining === 0}
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
            <div><span>今すぐ</span><strong>{status.remaining}</strong><small>1回最大 {status.limit}件</small></div>
            <div><span>再学習</span><strong>{status.retry_ready}</strong><small>{status.retry_waiting}件が時刻待ち</small></div>
            <div><span>期限超過</span><strong>{status.overdue_total}</strong><small>要消化</small></div>
          </div>
          <div className="daily-progress" aria-label={`今日の復習作業 ${progress}%`}>
            <span style={{ width: `${progress}%` }} />
          </div>
          <ReviewCategoryCounts items={status.remaining_by_category} total={status.remaining} />
          <div className="daily-review-note">
            <p>
              {status.limit}件は1日の上限ではなく、1回の出題数です。
              完了後も、復習対象がある限り次のバッチへ進めます。
            </p>
            <p>
              基準間隔: q0=10分、q1=30分、q2=6時間、q3=12時間、q4=1日以上、q5=3日以上。
              q4・q5は保持できた期間に応じて伸び、q0〜q3は段階別の時刻に戻ります。
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
