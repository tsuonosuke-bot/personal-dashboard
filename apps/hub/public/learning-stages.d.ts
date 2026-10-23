export interface LearningStage {
  id: "strategy" | "input" | "structure" | "stock";
  title: string;
  status: string;
  links: Array<{ label: string; url: string }>;
}
export function learningStages(summary?: Record<string, unknown>, availability?: Record<string, boolean>): LearningStage[];
export function renderLearningStages(summary?: Record<string, unknown>, availability?: Record<string, boolean>): string;
