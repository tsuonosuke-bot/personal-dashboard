import type { SpeakingPracticeMode, SpeakingPracticePrompt, SpeakingPracticeType } from "../types";

/** 作れた例文は保持し、不足分の応答だけを追加する。順序は最初に選んだカードにそろえる。 */
export function mergeSpeakingPrompts(
  selectedIds: readonly string[],
  prepared: readonly SpeakingPracticePrompt[],
  additions: readonly SpeakingPracticePrompt[],
): SpeakingPracticePrompt[] {
  const byId = new Map(prepared.map((item) => [item.knowledge_id, item]));
  for (const item of additions) {
    if (!selectedIds.includes(item.knowledge_id)) throw new Error("AI例文と元のナレッジを対応できませんでした。");
    if (!byId.has(item.knowledge_id)) byId.set(item.knowledge_id, item);
  }
  return selectedIds.flatMap((id) => byId.get(id) ?? []);
}

export function missingSpeakingIds(selectedIds: readonly string[], prepared: readonly SpeakingPracticePrompt[]): string[] {
  const ready = new Set(prepared.map((item) => item.knowledge_id));
  return selectedIds.filter((id) => !ready.has(id));
}

export function speakingRetryTypes(selectedIds: readonly string[], missingIds: readonly string[], mode: SpeakingPracticeMode): Record<string, SpeakingPracticeType> {
  return Object.fromEntries(selectedIds.flatMap((id, index) => missingIds.includes(id)
    ? [[id, mode === "mixed" ? (index % 2 === 0 ? "instant_composition" : "read_aloud") : mode]] : []));
}
