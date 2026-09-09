import { useEffect, useId } from "react";
import type { Knowledge, QuizLog } from "../types";

interface Props {
  knowledge: Knowledge;
  quizLog: QuizLog[];
  mutating: boolean;
  onClose: () => void;
  onEdit: () => void;
  onArchive: () => void;
}

function displayDateTime(value: string): string {
  return new Date(value).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
}

export function KnowledgeDetailModal({
  knowledge, quizLog, mutating, onClose, onEdit, onArchive,
}: Props) {
  const titleId = useId();
  const history = quizLog
    .filter((item) => item.knowledge_id === knowledge.id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal detail-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="modal-head detail-heading">
          <div>
            <span className="eyebrow">{knowledge.category}</span>
            <h2 id={titleId}>{knowledge.title}</h2>
          </div>
          <button className="icon-button" aria-label="閉じる" onClick={onClose}>×</button>
        </div>

        <div className="detail-body">
          <div className="detail-status">
            <span className={`mastery-pill mastery-${knowledge.mastery}`}>{knowledge.mastery}</span>
            {knowledge.tags.map((tag) => <span className="tag" key={tag}>#{tag}</span>)}
          </div>
          <div className="content-block">
            <h3>説明</h3>
            <p>{knowledge.explanation || "説明はありません。"}</p>
          </div>
          {knowledge.source_note && (
            <div className="content-block">
              <h3>出典メモ</h3><p>{knowledge.source_note}</p>
            </div>
          )}

          <div className="metric-grid">
            <div><span>正答率</span><strong>{knowledge.accuracy == null ? "-" : `${Math.round(knowledge.accuracy * 100)}%`}</strong></div>
            <div><span>回答</span><strong>{knowledge.times_correct} / {knowledge.times_asked}</strong></div>
            <div><span>連続定着</span><strong>{knowledge.mastery_streak}</strong></div>
            <div><span>反復回数</span><strong>{knowledge.reps}</strong></div>
            <div><span>間隔</span><strong>{knowledge.interval_days}日</strong></div>
            <div><span>EF</span><strong>{knowledge.ef}</strong></div>
          </div>

          <dl className="detail-list">
            <div><dt>学習開始日</dt><dd>{knowledge.learned_on}</dd></div>
            <div><dt>最終出題日</dt><dd>{knowledge.last_asked_on ?? "-"}</dd></div>
            <div><dt>次回復習日</dt><dd>{knowledge.next_review_on ?? "-"}</dd></div>
            <div><dt>登録日時</dt><dd>{displayDateTime(knowledge.created_at)}</dd></div>
          </dl>

          <div className="history-section">
            <h3>このナレッジの回答履歴 <span>{history.length}件</span></h3>
            {history.length === 0 ? <p className="muted">回答履歴はありません。</p> : (
              <div className="history-table-wrap">
                <table className="history-table">
                  <thead><tr><th>日付</th><th>判定</th><th>品質</th><th>形式</th><th>メモ</th></tr></thead>
                  <tbody>{history.map((item) => (
                    <tr key={item.id}>
                      <td>{item.asked_on}</td><td>{item.verdict}</td><td>{item.quality}</td>
                      <td>{item.format}</td><td>{item.note ?? "-"}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="modal-actions detail-actions">
          <button className="danger-button" onClick={onArchive} disabled={mutating}>アーカイブ</button>
          <span className="action-spacer" />
          <button onClick={onClose}>閉じる</button>
          <button className="primary-button" onClick={onEdit}>編集する</button>
        </div>
      </section>
    </div>
  );
}
