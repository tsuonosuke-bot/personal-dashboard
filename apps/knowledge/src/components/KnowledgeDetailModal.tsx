import { useId } from "react";
import { PRIORITY_INTERVAL_HINTS } from "../constants";
import { TagChips } from "./TagChips";
import type { InsightGroupStore } from "../hooks/useInsightGroups";
import type { InsightStore } from "../hooks/useInsights";
import { useModalDialog } from "../hooks/useModalDialog";
import { InsightNotes } from "./InsightNotes";
import type { Knowledge, QuizLog } from "../types";

interface Props {
  knowledge: Knowledge;
  quizLog: QuizLog[];
  mutating: boolean;
  onClose: () => void;
  /** 呼び出し元で許可する操作だけを表示できるよう省略可能にする。 */
  onEdit?: () => void;
  onArchive?: () => void;
  /** 渡したときだけ示唆（付箋）の閲覧・追加欄を出す。 */
  insightStore?: InsightStore;
  /** 渡すと、示唆を問いに入れたり、入っている問いを表示したりできる。 */
  insightGroupStore?: InsightGroupStore;
  /** 渡すと、自動タグ（#93）を外せる。外したタグは次の自動処理でも付かない。 */
  onRemoveAutoTag?: (tag: string) => void;
}

function displayDateTime(value: string): string {
  return new Date(value).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
}

function displayStability(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}分`;
  if (hours < 48) return `${Math.round(hours * 10) / 10}時間`;
  return `${Math.round(hours / 2.4) / 10}日`;
}

function displayRelearning(stage: Knowledge["relearning_stage"]): string {
  if (stage === "recognition") return "再認（四択）";
  if (stage === "recall") return "想起（一問一答）";
  return "通常復習";
}

export function KnowledgeDetailModal({
  knowledge, quizLog, mutating, onClose, onEdit, onArchive, insightStore, insightGroupStore, onRemoveAutoTag,
}: Props) {
  const titleId = useId();
  const history = quizLog
    .filter((item) => item.knowledge_id === knowledge.id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const dialogRef = useModalDialog(onClose, mutating);

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !mutating && onClose()}>
      <section ref={dialogRef} className="modal detail-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <div className="modal-head detail-heading">
          <div>
            <span className="eyebrow">{knowledge.category}</span>
            <h2 id={titleId}>{knowledge.title}</h2>
          </div>
          <button className="icon-button" aria-label="閉じる" onClick={onClose} disabled={mutating}>×</button>
        </div>

        <div className="detail-body">
          <div className="detail-status">
            {knowledge.archived && <span className="tag">アーカイブ済み</span>}
            <span className={`mastery-pill mastery-${knowledge.mastery}`}>{knowledge.mastery}</span>
            <span className={`badge priority-${knowledge.priority}`}>優先度 {knowledge.priority}</span>
            <TagChips item={knowledge} onRemoveAuto={onRemoveAutoTag} disabled={mutating} />
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

          {insightStore && <InsightNotes knowledgeId={knowledge.id} store={insightStore} groupStore={insightGroupStore} />}

          <div className="metric-grid">
            <div><span>正答率</span><strong>{knowledge.accuracy == null ? "-" : `${Math.round(knowledge.accuracy * 100)}%`}</strong></div>
            <div><span>回答</span><strong>{knowledge.times_correct} / {knowledge.times_asked}</strong></div>
            <div><span>昇格実績</span><strong>{knowledge.mastery_streak} / 3</strong></div>
            <div><span>反復回数</span><strong>{knowledge.reps}</strong></div>
            <div><span>定着間隔</span><strong>{displayStability(knowledge.stability_hours)}</strong></div>
            <div><span>復習段階</span><strong>{displayRelearning(knowledge.relearning_stage)}</strong></div>
          </div>

          <dl className="detail-list">
            <div className="detail-priority-row">
              <dt>優先度</dt>
              <dd>
                <span className={`badge priority-${knowledge.priority}`}>{knowledge.priority}</span>
                <span className="detail-priority-hint">
                  {PRIORITY_INTERVAL_HINTS[knowledge.priority]}
                </span>
              </dd>
            </div>
            <div><dt>学習開始日</dt><dd>{knowledge.learned_on}</dd></div>
            <div><dt>最終出題日</dt><dd>{knowledge.last_asked_on ?? "-"}</dd></div>
            <div><dt>最終回答時刻</dt><dd>{knowledge.last_reviewed_at ? displayDateTime(knowledge.last_reviewed_at) : "-"}</dd></div>
            <div><dt>次回復習時刻</dt><dd>{displayDateTime(knowledge.next_review_at)}</dd></div>
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
          {onArchive && (
            <button className="danger-button" onClick={onArchive} disabled={mutating}>アーカイブ</button>
          )}
          <span className="action-spacer" />
          <button onClick={onClose} disabled={mutating}>閉じる</button>
          {onEdit && (
            <button className="primary-button" onClick={onEdit} disabled={mutating}>編集する</button>
          )}
        </div>
      </section>
    </div>
  );
}
