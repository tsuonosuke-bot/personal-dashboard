import { useEffect, useId, useState } from "react";
import { useModalDialog } from "../hooks/useModalDialog";
import { Pagination } from "./Pagination";
import type { Knowledge } from "../types";

interface Props {
  knowledge: Knowledge[];
  mutating: boolean;
  error: string | null;
  onClose: () => void;
  onRestore: (knowledge: Knowledge) => Promise<void>;
  onLoadPage: (search: string, offset: number, limit: number) => Promise<{ items: Knowledge[]; total: number }>;
}

export function ArchivedKnowledgeModal({
  knowledge, mutating, error, onClose, onRestore, onLoadPage,
}: Props) {
  const titleId = useId();
  const [search, setSearch] = useState("");
  const dialogRef = useModalDialog(onClose, mutating);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(30);
  const [rows, setRows] = useState<Knowledge[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setLoadError(null); setRows([]);
    onLoadPage(search, (page - 1) * pageSize, pageSize)
      .then((data) => { if (!cancelled) {
        const lastPage = Math.max(1, Math.ceil(data.total / pageSize));
        if (page > lastPage) setPage(lastPage);
        else { setRows(data.items); setTotal(data.total); }
      } })
      .catch((caught: unknown) => { if (!cancelled) setLoadError(caught instanceof Error ? caught.message : "アーカイブを取得できませんでした。"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [search, page, pageSize, version, knowledge, onLoadPage]);

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
              onChange={(event) => { setSearch(event.target.value); setPage(1); }}
            />
          </label>
          <p className="archive-summary">{total}件</p>
          {error && <div className="form-error archive-error" role="alert">{error}</div>}
          {loadError && <div className="form-error archive-error" role="alert">{loadError}<button onClick={() => setVersion((value) => value + 1)}>再試行</button></div>}
          {loading ? <div className="msg">読み込み中...</div> : !loadError && rows.length === 0 ? (
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
          {total > 0 && <Pagination page={page} pageSize={pageSize} totalPages={Math.max(1, Math.ceil(total / pageSize))} totalItems={total} onChange={setPage}
            onPageSizeChange={(size) => { setPageSize(size); setPage(1); }} />}
        </div>
        <div className="modal-actions">
          <button type="button" onClick={onClose} disabled={mutating}>閉じる</button>
        </div>
      </section>
    </div>
  );
}
