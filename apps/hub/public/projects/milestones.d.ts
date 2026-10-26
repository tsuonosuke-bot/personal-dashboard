export function groupMilestoneActions<
  T extends { milestoneId: number | null },
  M extends { id: number },
>(
  actions: T[],
  milestones: M[],
): {
  groups: Map<number, T[]>;
  loose: T[];
  positions: Map<number, number>;
};
