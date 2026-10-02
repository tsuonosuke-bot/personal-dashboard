import { useState } from "react";
import { addDeepDiveToInbox } from "../lib/api";

const MAX_DEEP_DIVE_CHARS = 1_000;

/** 採点結果から「あとで深掘りしたい点」を、出典つきで未整理のInboxへ登録する。 */
export function DeepDiveInbox({ knowledgeId, title }: { knowledgeId: string; title: string }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  const save = async () => {
    if (status === "saving" || !note.trim()) return;
    setStatus("saving");
    setMessage(null);
    try {
      await addDeepDiveToInbox(knowledgeId, note);
      setStatus("saved");
      setOpen(false);
    } catch (caught) {
      setStatus("error");
      setMessage(caught instanceof Error ? caught.message : "Inboxに登録できませんでした。");
    }
  };

  if (status === "saved") {
    return <p className="quiz-deep-dive-saved" role="status">深掘りしたい点をInboxに登録しました。Ideaの未整理Inboxから整理できます。</p>;
  }
  if (!open) {
    return (
      <button className="text-button quiz-deep-dive-toggle" onClick={() => setOpen(true)}>
        あとで深掘りする（Inboxへ登録）
      </button>
    );
  }
  return (
    <div className="quiz-deep-dive">
      <label>
        <span>深掘りしたい点</span>
        <textarea
          rows={3}
          value={note}
          maxLength={MAX_DEEP_DIVE_CHARS}
          placeholder="例: なぜ for ではなく of になるのか調べる"
          aria-label={`${title}について深掘りしたい点`}
          autoFocus
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      <small className="muted">「深掘り元: 復習「{title}」」を添えて未整理のInboxに入ります。採点結果や復習予定は変わりません。</small>
      {message && <p className="quiz-edit-error" role="alert">{message}</p>}
      <div className="quiz-deep-dive-actions">
        <button onClick={() => { setOpen(false); setMessage(null); }} disabled={status === "saving"}>やめる</button>
        <button className="primary-button" onClick={() => void save()} disabled={status === "saving" || !note.trim()}>
          {status === "saving" ? "登録中…" : "Inboxに登録"}
        </button>
      </div>
    </div>
  );
}
