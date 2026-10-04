import { useCallback, useEffect, useState } from "react";
import { MASTERY_ORDER, PRIORITY_ORDER } from "../constants";
import type { InsightGroupStore } from "../hooks/useInsightGroups";
import type { InsightStore } from "../hooks/useInsights";
import { getPendingReviewAnswers, getReviewGenerationHolds, retryReviewAnswer, runReviewBatch } from "../lib/api";
import type { Knowledge, KnowledgeDraft, KnowledgePriority, Mastery, PendingReviewAnswer, ReviewGenerationHold } from "../types";
import { DeepDiveInbox } from "./DeepDiveInbox";
import { InsightNotes } from "./InsightNotes";

export type KnowledgeUpdate = (
  id: string,
  expectedVersion: number,
  changes: Partial<KnowledgeDraft> | { archived: boolean },
) => Promise<Knowledge>;

const PENDING_LABEL: Record<PendingReviewAnswer["status"], string> = {
  answered: "採点待ち",
  grading: "採点中",
  error: "採点エラー",
};

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

/** 採点待ち・採点中・採点エラーの回答。手動の採点と、エラーの再採点ができる。 */
export function PendingAnswersPanel({
  titleById, onGraded,
}: {
  titleById: ReadonlyMap<string, string>;
  onGraded: () => void | Promise<void>;
}) {
  const [items, setItems] = useState<PendingReviewAnswer[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await getPendingReviewAnswers());
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "採点待ちの回答を取得できませんでした。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const gradeNow = async () => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const summary = await runReviewBatch("grade");
      setMessage(summary.status === "busy"
        ? "別の採点が実行中です。少し待ってから確認してください。"
        : summary.status === "skipped"
          ? summary.note ?? "採点待ちの回答はありませんでした。"
          : `${summary.succeeded}件を採点しました。${summary.failed > 0 ? `${summary.failed}件は次の採点で再試行します。` : ""}`);
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "採点を実行できませんでした。");
    } finally {
      setBusy(false);
      await load();
      await onGraded();
    }
  };

  const retry = async (id: number) => {
    if (busy) return;
    setBusy(true);
    try {
      await retryReviewAnswer(id);
      await load();
      setMessage("採点待ちに戻しました。「今すぐ採点する」か、次の自動採点で採点されます。");
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "再採点の準備ができませんでした。");
    } finally {
      setBusy(false);
    }
  };

  if (loading && items.length === 0) return null;
  if (!loading && !error && items.length === 0 && !message) return null;

  return (
    <section className="pending-answers card" aria-label="採点待ちの回答">
      <div className="pending-answers-head">
        <h2>採点待ち <span>{items.length}件</span></h2>
        <button className="primary-button" onClick={() => void gradeNow()} disabled={busy || items.length === 0}>
          {busy ? "採点中…" : "今すぐ採点する"}
        </button>
      </div>
      <p className="muted">15分ごとに自動で採点されます。採点が終わると、下の一覧に結果と講評が入ります。</p>
      {message && <p className="review-batch-notice" role="status">{message}</p>}
      {error && <div className="err compact" role="alert">{error}</div>}
      {items.length > 0 && (
        <ul className="pending-answers-list">
          {items.map((item) => (
            <li key={item.id}>
              <div className="learning-log-head">
                <time dateTime={item.answered_at}>{formatDateTime(item.answered_at)}</time>
                <span className={`badge pending-${item.status}`}>{PENDING_LABEL[item.status]}</span>
                <span className="quiz-result-format">{item.format}</span>
              </div>
              <strong className="learning-log-title">{titleById.get(item.knowledge_id) ?? "（削除されたナレッジ）"}</strong>
              <p className="pending-answer-question">{item.question}</p>
              <p className="pending-answer-text"><b>あなたの回答:</b> {item.answer_text || "（空欄）"}</p>
              {item.status === "error" && (
                <div className="pending-answer-error">
                  <span>{item.last_error ?? "採点に失敗しました。"}</span>
                  <button onClick={() => void retry(item.id)} disabled={busy}>再採点する</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * 問題を作り直しても条件を満たさず、生成を保留しているカード。理由とAIが作った問題文を見て、
 * ナレッジを直せるようにする。編集すると待ち時間に関係なく次の生成バッチで作り直される。
 */
export function GenerationHoldsPanel({ onOpenKnowledge }: { onOpenKnowledge: (id: string) => void }) {
  const [items, setItems] = useState<ReviewGenerationHold[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getReviewGenerationHolds()
      .then((holds) => { if (active) { setItems(holds); setError(null); } })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof Error ? caught.message : "問題を作れなかったカードを取得できませんでした。");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  if (loading || (!error && items.length === 0)) return null;
  const now = Date.now();

  return (
    <section className="pending-answers card" aria-label="問題を作れなかったカード">
      <div className="pending-answers-head">
        <h2>問題を作れなかったカード <span>{items.length}件</span></h2>
      </div>
      <p className="muted">
        作り直しても条件を満たす問題にならなかったカードです。時間を置いて自動で作り直します（2時間後、6時間後、以降は24時間ごと）。
        タイトルや説明を直すと、次の生成でまた作り直します。
      </p>
      {error && <div className="err compact" role="alert">{error}</div>}
      {items.length > 0 && (
        <ul className="pending-answers-list">
          {items.map((item) => (
            <li key={item.knowledge_id}>
              <div className="learning-log-head">
                <time dateTime={item.last_failed_at}>{formatDateTime(item.last_failed_at)}</time>
                <span className="badge pending-error">{item.failure_count}回作れず</span>
                <span className="quiz-result-format">{item.category}</span>
              </div>
              <strong className="learning-log-title">{item.title}</strong>
              {item.last_question && <p className="pending-answer-question"><b>AIが作った問題文:</b> {item.last_question}</p>}
              <div className="pending-answer-error">
                <span>{item.last_reason}</span>
                <button onClick={() => onOpenKnowledge(item.knowledge_id)}>ナレッジを開く</button>
              </div>
              <p className="muted">
                {new Date(item.retry_after).getTime() > now
                  ? `${formatDateTime(item.retry_after)}以降の生成で作り直します。`
                  : "次の生成で作り直します。"}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * 採点結果1件に対する操作。習熟度・優先度の変更、アーカイブ（元に戻せる）、
 * 示唆、あとで深掘り、詳細表示をここに置く。学習ログと復習の答え合わせ画面で共通に使う。
 */
export function ReviewResultActions({
  item, onKnowledgeUpdate, insightStore, insightGroupStore, onOpenDetail, archiveWarning,
}: {
  item: Knowledge;
  onKnowledgeUpdate: KnowledgeUpdate;
  insightStore: InsightStore;
  insightGroupStore: InsightGroupStore;
  onOpenDetail: (item: Knowledge) => void;
  /** アーカイブの確認に添える注意。採点前の回答は、アーカイブされたままだと採点バッチが記録せずに破棄する。 */
  archiveWarning?: string;
}) {
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [archived, setArchived] = useState<Knowledge | null>(item.archived ? item : null);

  const save = async (changes: Partial<KnowledgeDraft> | { archived: boolean }, message: string) => {
    if (saving) return;
    setSaving(true);
    setFeedback(null);
    try {
      const target = archived ?? item;
      const updated = await onKnowledgeUpdate(target.id, target.content_version, changes);
      setArchived(updated.archived ? updated : null);
      setFeedback(message);
    } catch (caught) {
      setFeedback(caught instanceof Error ? caught.message : "保存に失敗しました。");
    } finally {
      setSaving(false);
    }
  };

  const archive = () => {
    const warning = archiveWarning ? `\n${archiveWarning}` : "";
    if (!window.confirm(`「${item.title}」をアーカイブしますか？\n今後の復習に出題されなくなります。${warning}`)) return;
    void save({ archived: true }, "アーカイブしました。");
  };

  if (archived) {
    return (
      <div className="quiz-knowledge-panel">
        <p className="muted">このナレッジはアーカイブ済みです。今後の復習には出題されません。</p>
        <div className="quiz-edit-fields">
          <button onClick={() => void save({ archived: false }, "復元しました。")} disabled={saving}>元に戻す</button>
          {feedback && <span className="quiz-edit-feedback">{feedback}</span>}
        </div>
      </div>
    );
  }

  return (
    <div className="review-result-actions">
      <DeepDiveInbox knowledgeId={item.id} title={item.title} />
      <InsightNotes knowledgeId={item.id} store={insightStore} groupStore={insightGroupStore} compact />
      <div className="quiz-knowledge-panel">
        <div className="quiz-edit-fields">
          <label className="quiz-edit-control">
            <span>習熟度</span>
            <select
              aria-label={`${item.title}の習熟度`}
              value={item.mastery}
              disabled={saving}
              onChange={(event) => void save({ mastery: event.target.value as Mastery }, "保存しました。")}
            >
              {MASTERY_ORDER.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label className="quiz-edit-control">
            <span>優先度</span>
            <select
              aria-label={`${item.title}の優先度`}
              value={item.priority}
              disabled={saving}
              onChange={(event) => void save({ priority: event.target.value as KnowledgePriority }, "保存しました。")}
            >
              {PRIORITY_ORDER.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <button className="text-button" onClick={() => onOpenDetail(item)}>詳細を見る</button>
          <button className="danger-button" onClick={archive} disabled={saving}>アーカイブ</button>
          {saving && <span className="quiz-edit-feedback">保存中…</span>}
          {!saving && feedback && <span className="quiz-edit-feedback">{feedback}</span>}
        </div>
        <p className="muted review-priority-note">優先度を変えると、次回の復習時刻も優先度の倍率で計算し直します（再学習中を除く）。</p>
      </div>
    </div>
  );
}
