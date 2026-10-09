import { allTagNames } from "../lib/knowledge";
import type { Knowledge, SortKey, SortState } from "../types";

interface Props {
  rows: Knowledge[];
  sort: SortState;
  onSort: (key: SortKey) => void;
  /** スマホのカード表示では見出しを隠すので、並び順を選択欄で変える */
  onSortChange: (sort: SortState) => void;
  onOpen: (knowledge: Knowledge) => void;
}

const HEADERS: { key: SortKey; label: string }[] = [
  { key: "title", label: "タイトル" },
  { key: "category", label: "カテゴリ" },
  { key: "mastery", label: "習熟度" },
  { key: "priority", label: "優先度" },
  { key: "accuracy", label: "正答率" },
  { key: "next_review_on", label: "次回復習" },
];

const SORT_OPTIONS: { value: string; label: string }[] = [
  { value: "created_at:desc", label: "登録が新しい順" },
  { value: "created_at:asc", label: "登録が古い順" },
  { value: "next_review_on:asc", label: "次回復習が近い順" },
  { value: "next_review_on:desc", label: "次回復習が遠い順" },
  { value: "title:asc", label: "タイトル順" },
  { value: "category:asc", label: "カテゴリ順" },
  { value: "mastery:asc", label: "習熟度（低い順）" },
  { value: "priority:asc", label: "優先度（高い順）" },
  { value: "accuracy:asc", label: "正答率が低い順" },
  { value: "accuracy:desc", label: "正答率が高い順" },
];

export function KnowledgeTable({ rows, sort, onSort, onSortChange, onOpen }: Props) {
  const now = Date.now();
  const sortValue = `${sort.key}:${sort.direction}`;
  const sortOptions = SORT_OPTIONS.some((option) => option.value === sortValue)
    ? SORT_OPTIONS
    : [...SORT_OPTIONS, { value: sortValue, label: `${HEADERS.find((header) => header.key === sort.key)?.label ?? "登録日"}（${sort.direction === "asc" ? "昇順" : "降順"}）` }];
  return (
    <div className="card table-card">
      <label className="table-mobile-sort">
        <span>並び順</span>
        <select
          value={sortValue}
          onChange={(e) => {
            const [key, direction] = e.target.value.split(":") as [SortKey, SortState["direction"]];
            onSortChange({ key, direction });
          }}
        >
          {sortOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
      <table className="knowledge-table">
        <thead>
          <tr>
            {HEADERS.map(({ key, label }) => (
              <th
                key={key}
                aria-sort={sort.key === key ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
              >
                <button className="sort-button" onClick={() => onSort(key)}>
                  {label}<span aria-hidden="true">{sort.key === key ? (sort.direction === "asc" ? " ↑" : " ↓") : " ↕"}</span>
                </button>
              </th>
            ))}
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={7} className="msg">条件に一致するナレッジはありません。「条件をクリア」で全件の一覧に戻せます。</td>
            </tr>
          ) : (
            rows.map((k) => {
              return (
                <tr key={k.id}>
                  <td className="cell-title">
                    <div className="title">{k.title}</div>
                    {k.explanation && <div className="expl">{k.explanation}</div>}
                    {allTagNames(k).length > 0 && <div className="tag-preview">{allTagNames(k).slice(0, 3).map((tag) => `#${tag}`).join(" ")}</div>}
                  </td>
                  <td data-label="カテゴリ">{k.category}</td>
                  <td data-label="習熟度">
                    <span className={`badge mastery-badge mastery-${k.mastery}`}>
                      {k.mastery}
                    </span>
                  </td>
                  <td data-label="優先度"><span className={`badge priority-${k.priority}`}>{k.priority}</span></td>
                  <td data-label="正答率">{k.accuracy != null ? `${Math.round(k.accuracy * 100)}%` : "-"}</td>
                  <td data-label="次回復習" className={`cell-review ${Date.parse(k.next_review_at) < now ? "overdue-text" : ""}`}>
                    {new Date(k.next_review_at).toLocaleString("ja-JP", {
                      timeZone: "Asia/Tokyo", month: "numeric", day: "numeric",
                      hour: "2-digit", minute: "2-digit",
                    })}
                  </td>
                  <td className="cell-action"><button className="text-button" aria-label={`${k.title}の詳細`} onClick={() => onOpen(k)}>詳細</button></td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
