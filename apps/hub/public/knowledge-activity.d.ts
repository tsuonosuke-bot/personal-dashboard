export interface KnowledgeActivitySummary {
  reviewReadyDue?: unknown;
  knowledgeAnsweredOn?: unknown;
  knowledgeAnsweredToday?: unknown;
}
export function jstToday(now?: Date): string;
export function knowledgeActivity(summary: KnowledgeActivitySummary, now?: Date): {
  label: string;
  startReview: boolean;
  detail: string;
};
