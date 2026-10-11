import type { QuizLog } from "../types";

/**
 * 答え合わせ画面に出す、そのカードの過去の回答（新しい順）。
 * いま答えた問題の記録（四択・無回答はその場で記録される）は、過去の回答に含めない。
 */
export function pastAnswers(quizLog: QuizLog[], knowledgeId: string, currentQueueId: number): QuizLog[] {
  return quizLog
    .filter((entry) => entry.knowledge_id === knowledgeId && entry.review_queue_id !== currentQueueId)
    .sort((a, b) => (b.answered_at ?? b.created_at).localeCompare(a.answered_at ?? a.created_at) || b.id - a.id);
}
