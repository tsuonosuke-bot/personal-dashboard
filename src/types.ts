/** DB の knowledge.mastery が実際に取る値（未学習 / 学習中 / 定着）。 */
export type Mastery = "未学習" | "学習中" | "定着";

export interface Knowledge {
  id: string;
  title: string;
  explanation: string | null;
  category: string;
  mastery: Mastery;
  tags: string[] | null;
  accuracy: number | null;
  next_review_on: string | null;
  archived: boolean;
  created_at: string;
}

export interface QuizLog {
  id: number;
  knowledge_id: string;
  asked_on: string;
  verdict: string;
}

export interface Filters {
  search: string;
  category: string;
  mastery: string;
}
