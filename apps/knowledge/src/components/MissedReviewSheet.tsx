import { useEffect, useId, useRef, useState } from "react";
import { useModalDialog } from "../hooks/useModalDialog";
import { getLearningLogPage, snapshotReviewResultIds } from "../lib/learningReadApi";
import type { Knowledge, QuizLog } from "../types";

interface Props {
  onLoadSources: (ids: readonly string[]) => Promise<void>;
  knowledgeById: Map<string, Knowledge>;
  onConfirm: (quizLogId: number) => Promise<void>;
  onOpenKnowledge: (knowledge: Knowledge) => void;
  onClose: () => void;
}

/**
 * 外した問題の講評を1件ずつ見直す。「確認した」でその採点結果を確認済みにして次へ進む。
 * 正解の講評は記録時に確認済みになるので、ここには出ない。
 */
export function MissedReviewSheet({ knowledgeById, onConfirm, onOpenKnowledge, onClose, onLoadSources }: Props) {
  const titleId = useId();
  const [queue, setQueue] = useState<QuizLog[]>([]);
  const [ids, setIds] = useState<number[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useModalDialog(onClose, busy);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const current = queue[index] ?? null;
  const card = current ? knowledgeById.get(current.knowledge_id) ?? null : null;

  useEffect(() => {
    primaryRef.current?.focus();
  }, [index]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null); setQueue([]); setIndex(0); setIds(null);
    snapshotReviewResultIds(new URLSearchParams({ misses: "true" })).then(async (snapshot) => {
      const page = snapshot.length ? await getLearningLogPage(new URLSearchParams({ misses: "true", result_ids: snapshot.slice(0, 30).join(",") }), 30, 0) : null;
      if (page && page.items.length !== Math.min(30, snapshot.length)) throw new Error("講評が更新されています。再読み込みしてください。");
      if (page) await onLoadSources(page.items.map((item) => item.knowledge_id));
      if (!cancelled) { setIds(snapshot); setQueue(page?.items ?? []); }
    }).catch((caught: unknown) => { if (!cancelled) setError(caught instanceof Error ? caught.message : "講評を取得できませんでした。"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [version, onLoadSources]);

  const confirm = async () => {
    if (!current || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(current.id);
      if (index + 1 >= queue.length && ids && queue.length < ids.length) {
        const page = await getLearningLogPage(new URLSearchParams({ misses: "true", result_ids: ids.slice(queue.length, queue.length + 30).join(",") }), 30, 0);
        if (page.items.length !== Math.min(30, ids.length - queue.length)) throw new Error("講評が更新されています。再読み込みしてください。");
        await onLoadSources(page.items.map((item) => item.knowledge_id));
        setQueue((current) => [...current, ...page.items]);
      }
      setIndex((value) => value + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "確認済みにできませんでした。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}>
      <section ref={dialogRef} className="modal missed-review" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <div className="missed-review-top">
          <span id={titleId}>
            {current ? `外した問題の講評 ${index + 1} / ${ids?.length ?? 0}` : "外した問題の講評"}
          </span>
          <button className="icon-button" onClick={onClose} disabled={busy} aria-label="閉じる">×</button>
        </div>
        <div className="missed-review-bar" aria-hidden="true"><b style={{ width: `${ids?.length ? (index / ids.length) * 100 : 100}%` }} /></div>

        {loading ? <p className="msg">読み込み中...</p> : !current && error ? <div role="alert">{error}<button onClick={() => setVersion((value) => value + 1)}>再試行</button></div> : current ? (
          <div className="missed-review-body">
            <p className="missed-review-kicker">
              <span className={`badge verdict-badge ${current.verdict === "部分正解" ? "partial" : "wrong"}`}>{current.verdict}</span>
              {card?.category ?? "削除されたナレッジ"}・{current.format}
            </p>
            {current.question && <p className="missed-review-question">{current.question}</p>}
            <div className="missed-review-answers">
              <div className="mine"><span>あなたの回答</span><p>{current.user_answer?.trim() || "（無回答）"}</p></div>
              <div className="right"><span>正解</span><p>{current.correct_answer || "—"}</p></div>
            </div>
            {current.explanation && <div className="missed-review-explanation">{current.explanation}</div>}
            <p className="missed-review-card">
              カード: {card?.title ?? "削除されたナレッジ"}
              {card && <button className="text-button" onClick={() => onOpenKnowledge(card)}>カードを開く</button>}
            </p>
            {error && <div className="err compact" role="alert">{error}<button onClick={() => setVersion((value) => value + 1)}>再読み込み</button></div>}
            <div className="missed-review-actions">
              <button onClick={onClose} disabled={busy}>あとで</button>
              <button ref={primaryRef} className="primary-button" onClick={() => void confirm()} disabled={busy}>
                {busy ? "記録中…" : index + 1 < (ids?.length ?? 0) ? "確認した（次へ）" : "確認した（終わる）"}
              </button>
            </div>
          </div>
        ) : (
          <div className="missed-review-done">
            <strong>外した問題の講評をすべて確認しました</strong>
            <p>{ids?.length ?? 0}件を確認済みにしました。</p>
            <button ref={primaryRef} className="primary-button" onClick={onClose}>閉じる</button>
          </div>
        )}
      </section>
    </div>
  );
}
