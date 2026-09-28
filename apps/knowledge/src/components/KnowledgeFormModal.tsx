import { useId, useState, type FormEvent, type KeyboardEvent } from "react";
import { MASTERY_ORDER, PRIORITY_INTERVAL_HINTS, PRIORITY_ORDER } from "../constants";
import { useModalDialog } from "../hooks/useModalDialog";
import type { Knowledge, KnowledgeDraft, KnowledgePriority, Mastery } from "../types";
import "./KnowledgeFormModal.css";

interface Props {
  knowledge: Knowledge | null;
  categories: string[];
  tagSuggestions?: string[];
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (draft: KnowledgeDraft) => Promise<void>;
}

export function KnowledgeFormModal({
  knowledge, categories, tagSuggestions = [], saving, error, onClose, onSave,
}: Props) {
  const titleId = useId();
  const categoryListId = useId();
  const tagInputId = useId();
  const tagHelpId = useId();
  const [title, setTitle] = useState(knowledge?.title ?? "");
  const [category, setCategory] = useState(knowledge?.category ?? "");
  const [mastery, setMastery] = useState<Mastery>(knowledge?.mastery ?? "未学習");
  const [priority, setPriority] = useState<KnowledgePriority>(knowledge?.priority ?? "中");
  const [explanation, setExplanation] = useState(knowledge?.explanation ?? "");
  const [sourceNote, setSourceNote] = useState(knowledge?.source_note ?? "");
  const [tags, setTags] = useState(() => appendUniqueTags([], knowledge?.tags ?? []));
  const [tagInput, setTagInput] = useState("");
  const [nextReviewOn, setNextReviewOn] = useState(knowledge?.next_review_on ?? "");
  const dialogRef = useModalDialog(onClose, saving);
  const availableSuggestions = appendUniqueTags([], tagSuggestions)
    .filter((tag) => !tags.some((selected) => tagKey(selected) === tagKey(tag)))
    .filter((tag) => tag.toLocaleLowerCase().includes(tagInput.trim().toLocaleLowerCase()));

  const addTags = (entries: string[]) => {
    setTags((current) => appendUniqueTags(current, entries, tagSuggestions));
    setTagInput("");
  };

  const handleTagInput = (value: string) => {
    const entries = value.split(/[,\n]/);
    if (entries.length > 1) {
      setTags((current) => appendUniqueTags(current, entries.slice(0, -1), tagSuggestions));
    }
    setTagInput(entries[entries.length - 1] ?? "");
  };

  const handleTagKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && !event.nativeEvent.isComposing && tagInput.trim()) {
      event.preventDefault();
      addTags([tagInput]);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const parsedTags = appendUniqueTags(tags, tagInput.split(/[,\n]/), tagSuggestions);
    await onSave({
      title,
      category,
      mastery,
      priority,
      explanation: explanation.trim() || null,
      source_note: sourceNote.trim() || null,
      tags: parsedTags,
      next_review_on: nextReviewOn || null,
    });
  };

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !saving && onClose()}>
      <section ref={dialogRef} className="modal form-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
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
              <span>優先度</span>
              <select value={priority} onChange={(event) => setPriority(event.target.value as KnowledgePriority)}>
                {PRIORITY_ORDER.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
              <small className="field-hint">{PRIORITY_INTERVAL_HINTS[priority]}。</small>
            </label>
            <label className="field">
              <span>習熟度</span>
              <select value={mastery} onChange={(event) => setMastery(event.target.value as Mastery)}>
                {MASTERY_ORDER.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <label className="field">
              <span>次回復習日</span>
              <input type="date" value={nextReviewOn} onChange={(event) => setNextReviewOn(event.target.value)} />
            </label>
            <label className="field full-field">
              <span>説明</span>
              <textarea rows={6} maxLength={10_000} value={explanation} onChange={(event) => setExplanation(event.target.value)} />
            </label>
            <label className="field full-field">
              <span>出典メモ</span>
              <textarea rows={3} maxLength={5_000} value={sourceNote} onChange={(event) => setSourceNote(event.target.value)} />
            </label>
            <div className="field full-field tag-picker">
              <label htmlFor={tagInputId}>タグ</label>
              <small id={tagHelpId} className="field-hint">既存のタグから選ぶか、自由に入力できます。1〜2個が目安です。カンマ・Enterで追加できます。</small>
              {tags.length > 0 && (
                <div className="tag-picker-selected" role="group" aria-label="追加済みのタグ">
                  {tags.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      className="tag-picker-chip"
                      aria-label={`タグ「${tag}」を削除`}
                      title={`タグ「${tag}」を削除`}
                      onClick={() => {
                        setTags((current) => current.filter((selected) => selected !== tag));
                        if (tagKey(tagInput) === tagKey(tag)) setTagInput("");
                      }}
                      disabled={saving}
                    >
                      <span>{tag}</span><span aria-hidden="true">×</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="tag-picker-entry">
                <input
                  id={tagInputId}
                  type="text"
                  maxLength={1_500}
                  placeholder="タグを入力（カンマ区切りも可）"
                  aria-describedby={tagHelpId}
                  value={tagInput}
                  onChange={(event) => handleTagInput(event.target.value)}
                  onKeyDown={handleTagKeyDown}
                  disabled={saving}
                />
                <button type="button" onClick={() => addTags([tagInput])} disabled={saving || !tagInput.trim()}>追加</button>
              </div>
              {availableSuggestions.length > 0 && (
                <div className="tag-picker-suggestions" role="group" aria-label="既存のタグ候補">
                  <span>既存のタグから選ぶ</span>
                  <div>
                    {availableSuggestions.map((tag) => (
                      <button key={tag} type="button" aria-label={`タグ「${tag}」を追加`} onClick={() => addTags([tag])} disabled={saving}>{tag} <span aria-hidden="true">＋</span></button>
                    ))}
                  </div>
                </div>
              )}
            </div>
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

function tagKey(tag: string) {
  return tag.trim().toLocaleLowerCase();
}

function appendUniqueTags(current: string[], entries: string[], suggestions: string[] = []) {
  const result = [...current];
  const seen = new Set(current.map(tagKey));
  for (const entry of entries) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const tag = suggestions.find((suggestion) => tagKey(suggestion) === tagKey(trimmed))?.trim() ?? trimmed;
    const key = tagKey(tag);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(tag);
  }
  return result;
}
