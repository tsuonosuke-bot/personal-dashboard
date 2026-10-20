import { useState } from "react";
import { reportGrading, type GradingReport as GradingReportInput } from "../lib/api";

const MAX_COMMENT_CHARS = 500;

/** 採点結果がおかしいとき、問題・回答・採点を添えて未整理のInboxへ報告する。採点結果や復習予定は変わらない。 */
export function GradingReport({ report, onClose }: { report: Omit<GradingReportInput, "comment">; onClose?: () => void }) {
  const [open, setOpen] = useState(onClose !== undefined);
  const [comment, setComment] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  const send = async () => {
    if (status === "saving") return;
    setStatus("saving");
    setMessage(null);
    try {
      await reportGrading({ ...report, comment });
      setStatus("saved");
      setOpen(false);
    } catch (caught) {
      setStatus("error");
      setMessage(caught instanceof Error ? caught.message : "報告を登録できませんでした。");
    }
  };

  if (status === "saved") {
    return <p className="quiz-deep-dive-saved" role="status">採点の報告をInboxに登録しました。Ideaの未整理Inboxから見直せます。</p>;
  }
  if (!open) {
    return (
      <button className="text-button quiz-deep-dive-toggle" onClick={() => setOpen(true)}>
        採点がおかしい（報告する）
      </button>
    );
  }
  return (
    <div className="quiz-deep-dive">
      <label>
        <span>どこがおかしいか（任意）</span>
        <textarea
          rows={3}
          value={comment}
          maxLength={MAX_COMMENT_CHARS}
          placeholder="例: 正しく答えているのに不正解になった"
          aria-label="採点がおかしい点"
          autoFocus
          onChange={(event) => setComment(event.target.value)}
        />
      </label>
      <small className="muted">問題・あなたの回答・AIの採点と講評を添えて、未整理のInboxに入ります。採点結果や復習予定は変わりません。</small>
      {message && <p className="quiz-edit-error" role="alert">{message}</p>}
      <div className="quiz-deep-dive-actions">
        <button onClick={() => { setOpen(false); setMessage(null); onClose?.(); }} disabled={status === "saving"}>やめる</button>
        <button className="primary-button" onClick={() => void send()} disabled={status === "saving"}>
          {status === "saving" ? "報告中…" : "Inboxに報告"}
        </button>
      </div>
    </div>
  );
}
