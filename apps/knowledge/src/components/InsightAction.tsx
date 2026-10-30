import { useId, useRef, useState } from "react";
import { useInsightAction } from "../hooks/useInsightAction";
import type { ActionReference } from "../lib/api";

/** 示唆・日記から、自分で決めた次の行動を出典つきでInboxへ送る。 */
export function InsightAction({ sourceType, sourceId }: ActionReference) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const { status, error, inboxId, save } = useInsightAction({ sourceType, sourceId });
  const toggle = useRef<HTMLButtonElement>(null);
  const fieldId = useId();
  const saving = status === "saving";
  if (status === "saved") return (
    <p className="insight-action-saved" role="status">Inboxに登録しました。<a href={`/compass/?view=inbox&id=${inboxId}`}>登録した行動を開く</a></p>
  );
  return (
    <div className="insight-action">
      <button ref={toggle} type="button" className="text-button" aria-expanded={open} aria-controls={fieldId}
        onClick={() => setOpen((value) => !value)} disabled={saving}>行動をInboxへ</button>
      {open && (
        <form id={fieldId} className="insight-action-form" onSubmit={(event) => { event.preventDefault(); void save(note); }}>
          <label>
            <span>次にする行動</span>
            <textarea rows={3} maxLength={500} value={note} autoFocus disabled={saving}
              placeholder="例: 明日の打ち合わせ前に、判断の基準を3つ書く"
              onChange={(event) => setNote(event.target.value)} />
          </label>
          <small>元の{sourceType === "insight" ? "示唆" : "日記"}と出典を添えて、未整理のInboxに登録します。</small>
          {error && <p className="quiz-edit-error" role="alert">{error}</p>}
          <div className="insight-action-buttons">
            <button type="button" disabled={saving} onClick={() => { setOpen(false); toggle.current?.focus(); }}>やめる</button>
            <button type="submit" className="primary-button" disabled={saving || !note.trim()}>{saving ? "登録中…" : "Inboxに登録"}</button>
          </div>
        </form>
      )}
    </div>
  );
}
