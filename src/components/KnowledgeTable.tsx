import { MASTERY_COLORS } from "../constants";
import type { Knowledge } from "../types";

export function KnowledgeTable({ rows }: { rows: Knowledge[] }) {
  return (
    <div className="card table-card">
      <table>
        <thead>
          <tr>
            <th>タイトル</th>
            <th>カテゴリ</th>
            <th>習熟度</th>
            <th>正答率</th>
            <th>次回復習</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={5} className="msg">該当データなし</td>
            </tr>
          ) : (
            rows.map((k) => {
              const color = MASTERY_COLORS[k.mastery] ?? "#94a3b8";
              return (
                <tr key={k.id}>
                  <td>
                    <div className="title">{k.title}</div>
                    {k.explanation && <div className="expl">{k.explanation}</div>}
                  </td>
                  <td>{k.category}</td>
                  <td>
                    <span className="badge" style={{ background: `${color}22`, color }}>
                      {k.mastery}
                    </span>
                  </td>
                  <td>{k.accuracy != null ? `${Math.round(k.accuracy * 100)}%` : "-"}</td>
                  <td>{k.next_review_on ?? "-"}</td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
