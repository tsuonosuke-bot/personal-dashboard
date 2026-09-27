interface Props {
  page: number;
  totalPages: number;
  pageSize: number;
  totalItems: number;
  onChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

function pageNumbers(page: number, totalPages: number): number[] {
  const start = Math.max(1, Math.min(page - 2, totalPages - 4));
  const end = Math.min(totalPages, start + 4);
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

export function Pagination({
  page, totalPages, pageSize, totalItems, onChange, onPageSizeChange,
}: Props) {
  const firstItem = totalItems === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastItem = Math.min(page * pageSize, totalItems);
  return (
    <div className="pager">
      <span className="pager-summary">{firstItem}〜{lastItem} / {totalItems}件</span>
      <label className="page-size">
        表示
        <select value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))}>
          <option value={15}>15件</option>
          <option value={30}>30件</option>
          <option value={60}>60件</option>
        </select>
      </label>
      <div className="page-buttons" aria-label="ページ移動">
        <button aria-label="最初のページ" disabled={page <= 1} onClick={() => onChange(1)}>«</button>
        <button aria-label="前のページ" disabled={page <= 1} onClick={() => onChange(page - 1)}>‹</button>
        {pageNumbers(page, totalPages).map((value) => (
          <button
            key={value}
            aria-current={value === page ? "page" : undefined}
            className={value === page ? "active" : ""}
            onClick={() => onChange(value)}
          >
            {value}
          </button>
        ))}
        <button aria-label="次のページ" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>›</button>
        <button aria-label="最後のページ" disabled={page >= totalPages} onClick={() => onChange(totalPages)}>»</button>
      </div>
    </div>
  );
}
