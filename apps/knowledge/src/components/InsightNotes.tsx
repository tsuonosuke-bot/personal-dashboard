import { useState } from "react";
import type { InsightGroupStore } from "../hooks/useInsightGroups";
import type { InsightStore } from "../hooks/useInsights";
import type { KnowledgeInsight } from "../types";
import { QuestionChips, QuestionPicker } from "./InsightQuestions";

const MAX_INSIGHT_CHARS = 1_000;

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric" });
}

function errorMessage(caught: unknown, fallback: string): string {
  return caught instanceof Error ? caught.message : fallback;
}

function InsightNote({
  insight, store, groupStore,
}: {
  insight: KnowledgeInsight;
  store: InsightStore;
  groupStore?: InsightGroupStore;
}) {
  const [editing, setEditing] = useState(false);
  const [choosingQuestion, setChoosingQuestion] = useState(false);
  const [draft, setDraft] = useState(insight.body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (busy || !draft.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await store.update(insight, draft);
      setEditing(false);
    } catch (caught) {
      setError(errorMessage(caught, "示唆を保存できませんでした。"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (busy || !window.confirm("この示唆を削除しますか？")) return;
    setBusy(true);
    setError(null);
    try {
      await store.remove(insight.id);
    } catch (caught) {
      setError(errorMessage(caught, "示唆を削除できませんでした。"));
      setBusy(false);
    }
  };

  return (
    <li className="insight-note">
      {editing ? (
        <>
          <textarea
            rows={3}
            value={draft}
            maxLength={MAX_INSIGHT_CHARS}
            aria-label="示唆を編集"
            autoFocus
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="insight-note-actions">
            <button onClick={() => { setEditing(false); setDraft(insight.body); setError(null); }} disabled={busy}>やめる</button>
            <button className="primary-button" onClick={() => void save()} disabled={busy || !draft.trim()}>
              {busy ? "保存中…" : "保存"}
            </button>
          </div>
        </>
      ) : (
        <>
          <p>{insight.body}</p>
          {groupStore && <QuestionChips store={groupStore} insightId={insight.id} />}
          <div className="insight-note-meta">
            <span>{formatDate(insight.created_at)}</span>
            <button className="text-button" onClick={() => setEditing(true)} disabled={busy}>編集</button>
            <button className="text-button" onClick={() => void remove()} disabled={busy}>削除</button>
            {groupStore && !choosingQuestion && (
              <button className="text-button" onClick={() => setChoosingQuestion(true)}
                disabled={busy || groupStore.loading || Boolean(groupStore.error)}>問いに入れる</button>
            )}
          </div>
          {groupStore && choosingQuestion && (
            <QuestionPicker store={groupStore} insightId={insight.id} onDone={() => setChoosingQuestion(false)} />
          )}
        </>
      )}
      {error && <p className="quiz-edit-error" role="alert">{error}</p>}
    </li>
  );
}

/**
 * ナレッジ1件に付ける示唆（付箋）の一覧と追加欄。出題・採点には使わない。
 * groupStore を渡すと、書くときや後から示唆を問いに入れられ、入っている問いも表示する。
 */
export function InsightNotes({
  knowledgeId, store, groupStore, compact = false,
}: {
  knowledgeId: string;
  store: InsightStore;
  groupStore?: InsightGroupStore;
  compact?: boolean;
}) {
  const notes = store.byKnowledge.get(knowledgeId) ?? [];
  const [adding, setAdding] = useState(!compact && notes.length === 0);
  const [draft, setDraft] = useState("");
  const [questionId, setQuestionId] = useState<number | "">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const questionOptions = groupStore && !groupStore.error ? groupStore.groups : [];

  const add = async () => {
    if (busy || !draft.trim()) return;
    setBusy(true);
    setError(null);
    let saved = false;
    try {
      const created = await store.create(knowledgeId, draft);
      saved = true;
      if (groupStore && questionId !== "") await groupStore.addMember(questionId, created.id);
      setDraft("");
      setQuestionId("");
      setAdding(false);
    } catch (caught) {
      // 示唆だけ保存できた場合は、二重登録を防ぐため入力を閉じて、問いへは後から入れてもらう。
      if (saved) {
        setDraft("");
        setQuestionId("");
        setAdding(false);
        setError(`示唆は保存しましたが、問いに入れられませんでした。「問いに入れる」からやり直してください。（${errorMessage(caught, "")}）`);
      } else {
        setError(errorMessage(caught, "示唆を保存できませんでした。"));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`insight-notes${compact ? " compact" : ""}`}>
      <div className="insight-notes-head">
        <h3>示唆 <span>{notes.length}件</span></h3>
        {!adding && (
          <button className="text-button" onClick={() => setAdding(true)} disabled={store.loading}>＋ 示唆を書く</button>
        )}
      </div>
      {store.error && <p className="quiz-edit-error" role="alert">{store.error}</p>}
      {error && !adding && <p className="quiz-edit-error" role="alert">{error}</p>}
      {notes.length > 0 && (
        <ul className="insight-note-list">
          {notes.map((insight) => <InsightNote key={insight.id} insight={insight} store={store} groupStore={groupStore} />)}
        </ul>
      )}
      {adding && (
        <div className="insight-add">
          <textarea
            rows={3}
            value={draft}
            maxLength={MAX_INSIGHT_CHARS}
            placeholder="これを自分はどう役立てられるか（例: 依頼メールの書き出しに使う）"
            aria-label="示唆を書く"
            autoFocus={compact}
            onChange={(event) => setDraft(event.target.value)}
          />
          {questionOptions.length > 0 && (
            <label className="insight-add-question">
              <span>問いに入れる（任意）</span>
              <select value={questionId} onChange={(event) => setQuestionId(event.target.value === "" ? "" : Number(event.target.value))}>
                <option value="">入れない</option>
                {questionOptions.map((group) => <option key={group.id} value={group.id}>{group.title}</option>)}
              </select>
            </label>
          )}
          <small className="muted">自分用のメモです。出題や採点には使いません。</small>
          {error && <p className="quiz-edit-error" role="alert">{error}</p>}
          <div className="insight-note-actions">
            {(compact || notes.length > 0) && (
              <button onClick={() => { setAdding(false); setDraft(""); setError(null); }} disabled={busy}>やめる</button>
            )}
            <button className="primary-button" onClick={() => void add()} disabled={busy || !draft.trim()}>
              {busy ? "保存中…" : "示唆を残す"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
