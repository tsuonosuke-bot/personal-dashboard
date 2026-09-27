import { useId, useMemo, useState } from "react";
import { useModalDialog } from "../hooks/useModalDialog";
import type { Knowledge } from "../types";

interface Props {
  knowledge: Knowledge[];
  mutating: boolean;
  error: string | null;
  onClose: () => void;
  onRestore: (knowledge: Knowledge) => Promise<void>;
}

export function ArchivedKnowledgeModal({
  knowledge, mutating, error, onClose, onRestore,
}: Props) {
  const titleId = useId();
  const [search, setSearch] = useState("");
  const dialogRef = useModalDialog(onClose, mutating);
  const rows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("ja");
    if (!query) return knowledge;
    return knowledge.filter((item) => [
      item.title,
      item.category,
      item.explanation ?? "",
      item.tags.join(" "),
    ].join(" ").toLocaleLowerCase("ja").includes(query));
  }, [knowledge, search]);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && !mutating && onClose()}
    >
      <section
        ref={dialogRef}
        className="modal archive-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="modal-head">
          <div>
            <span className="eyebrow">ARCHIVED KNOWLEDGE</span>
            <h2 id={titleId}>アーカイブ済み</h2>
          </div>
          <button type="button" className="icon-button" aria-label="閉じる" onClick={onClose} disabled={mutating}>×</button>
        </div>
        <div className="archive-body">
          <label className="archive-search">
            <span className="sr-only">アーカイブ済みナレッジを検索</span>
            <input
              autoFocus
              type="text"
              placeholder="タイトル・カテゴリ・タグで検索"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <p className="archive-summary">{rows.length} / {knowledge.length}件</p>
          {error && <div className="form-error archive-error" role="alert">{error}</div>}
          {rows.length === 0 ? (
            <div className="msg">該当するアーカイブはありません。</div>
          ) : (
            <ul className="archive-list">
              {rows.map((item) => (
                <li key={item.id}>
                  <div>
                    <strong>{item.title}</strong>
                    <span>{item.category} · {item.created_at.slice(0, 10)}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void onRestore(item)}
                    disabled={mutating}
                  >
                    復元
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="modal-actions">
          <button type="button" onClick={onClose} disabled={mutating}>閉じる</button>
        </div>
      </section>
    </div>
  );
}
