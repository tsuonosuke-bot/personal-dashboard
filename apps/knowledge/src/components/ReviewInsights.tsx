import { getReviewCounts, getWeakCategories } from "../lib/knowledge";
import type { Knowledge, ReviewFilter } from "../types";

interface Props {
  knowledge: Knowledge[];
  onReviewSelect: (review: ReviewFilter) => void;
  onCategorySelect: (category: string) => void;
}

export function ReviewInsights({ knowledge, onReviewSelect, onCategorySelect }: Props) {
  const counts = getReviewCounts(knowledge);
  const weak = getWeakCategories(knowledge);
  return (
    <section className="review-panel" aria-labelledby="review-heading">
      <div className="section-heading">
        <div>
          <h2 id="review-heading">復習フォーカス</h2>
          <p>クリックすると一覧を絞り込みます。</p>
        </div>
      </div>
      <div className="review-grid">
        <button className="review-card today" onClick={() => onReviewSelect("today")}>
          <span>今日の復習</span><strong>{counts.today}</strong><small>件</small>
        </button>
        <button className="review-card overdue" onClick={() => onReviewSelect("overdue")}>
          <span>期限超過</span><strong>{counts.overdue}</strong><small>件</small>
        </button>
        <div className="review-card weak">
          <span>苦手カテゴリ</span>
          {weak.length === 0 ? <p className="muted">回答履歴なし</p> : (
            <div className="weak-list">
              {weak.map((item) => (
                <button key={item.category} onClick={() => onCategorySelect(item.category)}>
                  <span>{item.category}</span>
                  <strong>{Math.round(item.accuracy * 100)}%</strong>
                  <small>{item.attempts}問</small>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
