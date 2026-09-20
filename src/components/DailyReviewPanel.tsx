import type { DailyReviewStatus, RecoveryPreview } from "../types";

interface Props {
  status: DailyReviewStatus | null;
  preview: RecoveryPreview | null;
  loading: boolean;
  mutating: boolean;
  error: string | null;
  onStart: () => void;
  onPreview: () => void;
  onApply: () => Promise<number>;
  onCancelPreview: () => void;
  onApplied: (updated: number) => void;
}

export function DailyReviewPanel({
  status, preview, loading, mutating, error,
  onStart, onPreview, onApply, onCancelPreview, onApplied,
}: Props) {
  const progress = status && status.total > 0 ? Math.round((status.completed / status.total) * 100) : 0;
  const confirmApply = async () => {
    if (!preview?.total) return;
    const message = `${preview.total}件の次回復習日を${preview.from}〜${preview.through}へ再配分します。実行しますか？`;
    if (!window.confirm(message)) return;
    const updated = await onApply();
    if (updated > 0) onApplied(updated);
  };

  return (
    <section className="daily-review card" aria-labelledby="daily-review-heading">
      <div className="daily-review-head">
        <div>
          <span className="eyebrow">Daily review</span>
          <h2 id="daily-review-heading">今日の復習キュー</h2>
        </div>
        <button
          className="primary-button"
          disabled={loading || !status || status.remaining === 0}
          onClick={onStart}
        >
          {status?.remaining ? `残り${status.remaining}件を開始` : "本日分は完了"}
        </button>
      </div>

      {loading && <p className="muted">キューを確認中...</p>}
      {error && <div className="err compact" role="alert">{error}</div>}
      {status && (
        <>
          <div className="daily-review-metrics">
            <div><span>今日</span><strong>{status.completed} / {status.total}</strong><small>完了</small></div>
            <div><span>残り</span><strong>{status.remaining}</strong><small>上限 {status.limit}件</small></div>
            <div><span>本日まで</span><strong>{status.due_total}</strong><small>参考</small></div>
            <div><span>期限超過</span><strong>{status.overdue_total}</strong><small>参考</small></div>
          </div>
          <div className="daily-progress" aria-label={`今日の復習 ${progress}%完了`}>
            <span style={{ width: `${progress}%` }} />
          </div>
          <div className="recovery-actions">
            <p>期限超過は今日の上限に含めて順次消化します。残りは複数日に安全に再配分できます。</p>
            <button disabled={mutating || status.overdue_total === 0} onClick={onPreview}>
              {mutating ? "計算中..." : "回復プランをプレビュー"}
            </button>
          </div>
        </>
      )}

      {preview && (
        <div className="recovery-preview" role="region" aria-label="期限超過の回復プレビュー">
          {preview.total === 0 ? (
            <p>再配分が必要な期限超過カードはありません。</p>
          ) : (
            <>
              <h3>{preview.total}件を{preview.days.length}日へ再配分</h3>
              <p>{preview.from}〜{preview.through}、1日最大{preview.daily_limit}件です。</p>
              <div className="recovery-days">
                {preview.days.map((day) => <span key={day.date}>{day.date}: {day.count}件</span>)}
              </div>
              <ul className="recovery-sample">
                {preview.sample.map((item) => (
                  <li key={item.id}>
                    <strong>{item.title}</strong>
                    <span>{item.current_next_review_on} → {item.scheduled_on}（{item.overdue_days}日超過）</span>
                  </li>
                ))}
              </ul>
              {preview.total > preview.sample.length && <p className="muted">ほか {preview.total - preview.sample.length}件</p>}
            </>
          )}
          <div className="recovery-preview-actions">
            <button onClick={onCancelPreview} disabled={mutating}>閉じる</button>
            {preview.total > 0 && (
              <button className="primary-button" onClick={() => void confirmApply()} disabled={mutating}>
                この配分で更新
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
