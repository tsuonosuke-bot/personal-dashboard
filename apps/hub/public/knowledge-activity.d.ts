export interface KnowledgeActivitySummary {
  reviewReadyDue?: unknown;
  reviewWaitingGrading?: unknown;
  reviewUnconfirmed?: unknown;
  knowledgeAnsweredOn?: unknown;
  knowledgeAnsweredToday?: unknown;
}
export function jstToday(now?: Date): string;
export function knowledgeActivity(summary: KnowledgeActivitySummary, now?: Date): {
  label: string;
  startReview: boolean;
  detail: string;
};
export function reviewPanel(summary: KnowledgeActivitySummary, now?: Date): {
  state: "ready" | "done" | "idle" | "unknown";
  message: string | null;
  startReview: boolean;
  stats: Array<{ key: "ready" | "answered" | "waiting" | "unconfirmed"; label: string; value: string }>;
  showLog: boolean;
};
