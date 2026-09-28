import { useState, type FormEvent } from "react";
import type { InsightGroupStore } from "../hooks/useInsightGroups";
import { dashboardRoutePath } from "../lib/dashboardRoute";
import type { InsightGroup } from "../types";

function errorMessage(caught: unknown): string {
  return caught instanceof Error ? caught.message : "問いを更新できませんでした。";
}

/** 示唆が入っている問いの一覧。押すとその問いを整理ページで開く。 */
export function groupsForInsight(store: InsightGroupStore, insightId: number): InsightGroup[] {
  const ids = new Set(store.members.filter((member) => member.insight_id === insightId).map((member) => member.group_id));
  return store.groups.filter((group) => ids.has(group.id));
}

export function questionHref(groupId: number): string {
  return dashboardRoutePath(window.location.href, { kind: "organize", tab: "questions", questionId: groupId });
}

export function QuestionChips({ store, insightId }: { store: InsightGroupStore; insightId: number }) {
  const groups = groupsForInsight(store, insightId);
  if (groups.length === 0) return null;
  return (
    <span className="question-chips" aria-label="この示唆が入っている問い">
      {groups.map((group) => (
        <a key={group.id} className="question-chip" href={questionHref(group.id)} title={group.guiding_question}>
          問い: {group.title}
        </a>
      ))}
    </span>
  );
}

/** 示唆を既存の問いへ入れる、またはその場で新しい問いを作って入れる。 */
export function QuestionPicker({
  store, insightId, onDone,
}: {
  store: InsightGroupStore;
  insightId: number;
  onDone: () => void;
}) {
  const joined = new Set(groupsForInsight(store, insightId).map((group) => group.id));
  const available = store.groups.filter((group) => !joined.has(group.id));
  const [creating, setCreating] = useState(available.length === 0);
  const [groupId, setGroupId] = useState<number | "">(available[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (creating) {
        if (!title.trim() || !question.trim()) return;
        const created = await store.create(title, question);
        await store.addMember(created.id, insightId);
      } else {
        if (groupId === "") return;
        await store.addMember(groupId, insightId);
      }
      onDone();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="question-picker" onSubmit={(event) => void submit(event)}>
      {creating ? (
        <>
          <label>
            <span>テーマ名</span>
            <input type="text" required maxLength={120} value={title} placeholder="例：失敗から改善を生む"
              onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label>
            <span>思い出すための問い</span>
            <input type="text" required maxLength={300} value={question} placeholder="例：失敗を改善につなげるには？"
              onChange={(event) => setQuestion(event.target.value)} />
          </label>
        </>
      ) : (
        <label>
          <span>入れる問い</span>
          <select value={groupId} onChange={(event) => setGroupId(event.target.value === "" ? "" : Number(event.target.value))}>
            {available.map((group) => <option key={group.id} value={group.id}>{group.title}</option>)}
          </select>
        </label>
      )}
      <div className="question-picker-actions">
        {available.length > 0 && (
          <button type="button" className="text-button" onClick={() => { setCreating(!creating); setError(null); }} disabled={busy}>
            {creating ? "既存の問いから選ぶ" : "＋ 新しい問いを作る"}
          </button>
        )}
        <span className="action-spacer" />
        <button type="button" onClick={onDone} disabled={busy}>やめる</button>
        <button className="primary-button" type="submit"
          disabled={busy || (creating ? !title.trim() || !question.trim() : groupId === "")}>
          {busy ? "保存中…" : creating ? "作って入れる" : "問いに入れる"}
        </button>
      </div>
      {error && <p className="quiz-edit-error" role="alert">{error}</p>}
    </form>
  );
}

/**
 * AIがまとめたテーマを、そのまま問いとして保存する。テーマ名と問い文の下書きは保存前に直せる。
 * 根拠の示唆は、画面で確認できたものだけをまとめて問いに入れる。
 */
export function ThemeToQuestion({
  store, title: draftTitle, guidingQuestion, insightIds,
}: {
  store: InsightGroupStore;
  title: string;
  guidingQuestion: string;
  insightIds: readonly number[];
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(draftTitle.slice(0, 120));
  const [question, setQuestion] = useState(guidingQuestion.slice(0, 300));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ group: InsightGroup; added: number; failed: number } | null>(null);
  const sameTitle = store.groups.some((group) => group.title.trim() === title.trim());

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !title.trim() || !question.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const group = await store.create(title, question);
      // 問いを作った後の失敗は、作成済みの問いを示して後から追加してもらう。
      const failed = await store.addMembers(group.id, insightIds);
      setSaved({ group, added: insightIds.length - failed.length, failed: failed.length });
      setOpen(false);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  if (saved) {
    return (
      <p className="theme-question-saved" role="status">
        問い「{saved.group.title}」として保存しました（示唆{saved.added}件）。
        {saved.failed > 0 && <> {saved.failed}件は入れられませんでした。問いのページから追加してください。</>}
        {" "}<a href={questionHref(saved.group.id)}>問いを開く</a>
      </p>
    );
  }

  if (!open) {
    return (
      <button type="button" className="theme-question-open" onClick={() => setOpen(true)}
        disabled={insightIds.length === 0 || store.loading || Boolean(store.error)}>
        この問いとして保存
      </button>
    );
  }

  return (
    <form className="question-picker" onSubmit={(event) => void save(event)}>
      <label>
        <span>テーマ名</span>
        <input type="text" required maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} />
      </label>
      <label>
        <span>思い出すための問い</span>
        <input type="text" required maxLength={300} value={question} placeholder="例：失敗を改善につなげるには？"
          onChange={(event) => setQuestion(event.target.value)} />
      </label>
      <small className="muted">
        根拠の示唆{insightIds.length}件をこの問いに入れます。
        {sameTitle && " 同じ名前の問いがすでにあります。別の問いとして作られます。"}
      </small>
      <div className="question-picker-actions">
        <span className="action-spacer" />
        <button type="button" onClick={() => { setOpen(false); setError(null); }} disabled={busy}>やめる</button>
        <button className="primary-button" type="submit" disabled={busy || !title.trim() || !question.trim()}>
          {busy ? "保存中…" : "問いとして保存"}
        </button>
      </div>
      {error && <p className="quiz-edit-error" role="alert">{error}</p>}
    </form>
  );
}
