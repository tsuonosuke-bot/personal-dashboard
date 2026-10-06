import { allTagNames } from "../lib/knowledge";
import type { Knowledge, SortKey, SortState } from "../types";

interface Props {
  rows: Knowledge[];
  sort: SortState;
  onSort: (key: SortKey) => void;
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

export function KnowledgeTable({ rows, sort, onSort, onOpen }: Props) {
  const now = Date.now();
  return (
    <div className="card table-card">
      <table>
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
              <td colSpan={7} className="msg">該当データなし</td>
            </tr>
          ) : (
            rows.map((k) => {
              return (
                <tr key={k.id}>
                  <td>
                    <div className="title">{k.title}</div>
                    {k.explanation && <div className="expl">{k.explanation}</div>}
                    {allTagNames(k).length > 0 && <div className="tag-preview">{allTagNames(k).slice(0, 3).map((tag) => `#${tag}`).join(" ")}</div>}
                  </td>
                  <td>{k.category}</td>
                  <td>
                    <span className={`badge mastery-badge mastery-${k.mastery}`}>
                      {k.mastery}
                    </span>
                  </td>
                  <td><span className={`badge priority-${k.priority}`}>{k.priority}</span></td>
                  <td>{k.accuracy != null ? `${Math.round(k.accuracy * 100)}%` : "-"}</td>
                  <td className={Date.parse(k.next_review_at) < now ? "overdue-text" : ""}>
                    {new Date(k.next_review_at).toLocaleString("ja-JP", {
                      timeZone: "Asia/Tokyo", month: "numeric", day: "numeric",
                      hour: "2-digit", minute: "2-digit",
                    })}
                  </td>
                  <td><button className="text-button" onClick={() => onOpen(k)}>詳細</button></td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
