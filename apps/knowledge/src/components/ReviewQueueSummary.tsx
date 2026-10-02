import type { ReviewQueueStatus } from "../types";

function formatTime(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** 出題待ち・採点待ち・未確認・上限到達・直近の生成を短く示す。 */
export function ReviewQueueSummary({
  status, onOpenResults,
}: {
  status: ReviewQueueStatus | null;
  onOpenResults: () => void;
}) {
  if (!status) return null;
  const lastGenerated = formatTime(status.last_generate?.at ?? null);
  return (
    <div className="review-queue-summary">
      {status.queue_full && (
        <p className="review-queue-full" role="status">
          出題待ちの問題が上限の{status.queue_limit}件に達しているため、新しい問題の追加を止めています。
          問題を解いて件数が減ると、追加を再開します。
        </p>
      )}
      <ul>
        <li>出題待ち 全{status.ready_total}問（うち期限前 {Math.max(0, status.ready_total - status.ready_due)}問）</li>
        <li>採点待ち {status.waiting_grading}件{status.grading_errors > 0 && `・採点エラー ${status.grading_errors}件`}</li>
        <li>
          未確認の採点結果 {status.unconfirmed_results}件
          {status.unconfirmed_results > 0 && <button className="text-button" onClick={onOpenResults}>学習ログで見る</button>}
        </li>
        {lastGenerated && (
          <li className="muted">
            最後の問題生成: {lastGenerated}
            {status.last_generate?.added != null && `（${status.last_generate.added}問追加）`}
          </li>
        )}
      </ul>
    </div>
  );
}
