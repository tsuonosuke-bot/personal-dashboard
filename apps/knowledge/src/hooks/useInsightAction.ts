import { useRef, useState } from "react";
import { addInsightActionToInbox, type ActionReference } from "../lib/api";

export function useInsightAction(source: ActionReference) {
  const pending = useRef(false);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  const [inboxId, setInboxId] = useState<number | null>(null);
  const save = async (note: string): Promise<boolean> => {
    if (pending.current || !note.trim() || status === "saved") return false;
    pending.current = true;
    setStatus("saving");
    setError(null);
    try {
      const saved = await addInsightActionToInbox(source, note);
      setInboxId(saved.id);
      setStatus("saved");
      return true;
    } catch (caught) {
      setStatus("idle");
      setError(caught instanceof Error ? caught.message : "Inboxに登録できませんでした。");
      return false;
    } finally { pending.current = false; }
  };
  return { status, error, inboxId, save };
}
