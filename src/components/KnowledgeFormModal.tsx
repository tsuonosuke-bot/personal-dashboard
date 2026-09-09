import { useEffect, useId, useState, type FormEvent } from "react";
import { MASTERY_ORDER } from "../constants";
import type { Knowledge, KnowledgeDraft, Mastery } from "../types";

interface Props {
  knowledge: Knowledge | null;
  categories: string[];
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (draft: KnowledgeDraft) => Promise<void>;
}

export function KnowledgeFormModal({
  knowledge, categories, saving, error, onClose, onSave,
}: Props) {
  const titleId = useId();
  const categoryListId = useId();
  const [title, setTitle] = useState(knowledge?.title ?? "");
  const [category, setCategory] = useState(knowledge?.category ?? "");
  const [mastery, setMastery] = useState<Mastery>(knowledge?.mastery ?? "未学習");
  const [explanation, setExplanation] = useState(knowledge?.explanation ?? "");
  const [sourceNote, setSourceNote] = useState(knowledge?.source_note ?? "");
  const [tags, setTags] = useState((knowledge?.tags ?? []).join(", "));
  const [nextReviewOn, setNextReviewOn] = useState(knowledge?.next_review_on ?? "");

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, saving]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const parsedTags = [...new Set(tags.split(/[,\n]/).map((tag) => tag.trim()).filter(Boolean))];
    await onSave({
      title,
      category,
      mastery,
      explanation: explanation.trim() || null,
      source_note: sourceNote.trim() || null,
      tags: parsedTags,
      next_review_on: nextReviewOn || null,
    });
  };

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !saving && onClose()}>
      <section className="modal form-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="modal-head">
          <div>
            <span className="eyebrow">{knowledge ? "EDIT KNOWLEDGE" : "NEW KNOWLEDGE"}</span>
            <h2 id={titleId}>{knowledge ? "ナレッジを編集" : "ナレッジを追加"}</h2>
          </div>
          <button type="button" className="icon-button" aria-label="閉じる" onClick={onClose} disabled={saving}>×</button>
        </div>
        <form onSubmit={(event) => void submit(event)}>
          <div className="form-grid">
            <label className="field full-field">
              <span>タイトル <b>必須</b></span>
              <input autoFocus required maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} />
            </label>
            <label className="field">
              <span>カテゴリ <b>必須</b></span>
              <input required maxLength={100} list={categoryListId} value={category} onChange={(event) => setCategory(event.target.value)} />
              <datalist id={categoryListId}>{categories.map((value) => <option key={value} value={value} />)}</datalist>
            </label>
            <label className="field">
              <span>習熟度</span>
              <select value={mastery} onChange={(event) => setMastery(event.target.value as Mastery)}>
                {MASTERY_ORDER.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <label className="field full-field">
              <span>説明</span>
              <textarea rows={6} maxLength={10_000} value={explanation} onChange={(event) => setExplanation(event.target.value)} />
            </label>
            <label className="field full-field">
              <span>出典メモ</span>
              <textarea rows={3} maxLength={5_000} value={sourceNote} onChange={(event) => setSourceNote(event.target.value)} />
            </label>
            <label className="field">
              <span>タグ</span>
              <input maxLength={1_500} placeholder="カンマ区切り" value={tags} onChange={(event) => setTags(event.target.value)} />
            </label>
            <label className="field">
              <span>次回復習日</span>
              <input type="date" value={nextReviewOn} onChange={(event) => setNextReviewOn(event.target.value)} />
            </label>
          </div>
          {error && <div className="form-error" role="alert">{error}</div>}
          <div className="modal-actions">
            <button type="button" onClick={onClose} disabled={saving}>キャンセル</button>
            <button className="primary-button" type="submit" disabled={saving}>
              {saving ? "保存中..." : knowledge ? "変更を保存" : "登録する"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
