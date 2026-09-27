import type { DailyReviewCategoryCount } from "../types";

interface Props {
  items: DailyReviewCategoryCount[];
  total: number;
}

export function ReviewCategoryCounts({ items, total }: Props) {
  return (
    <div className="review-category-breakdown">
      <div className="review-category-heading">
        <h3>カテゴリ別の残り</h3>
        <span>今すぐ {total}件</span>
      </div>
      {items.length > 0 ? (
        <ul className="review-category-list">
          {items.map((item) => (
            <li className={item.count === 0 ? "empty" : undefined} key={item.category}>
              <span>{item.category}</span>
              <strong>{item.count}件</strong>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">登録済みのカテゴリはありません。</p>
      )}
    </div>
  );
}
