/** Classify each queued action once, preserving the existing input order. */
export function groupMilestoneActions(actions, milestones) {
  const positions = new Map(milestones.map((milestone, index) => [milestone.id, index]));
  const groups = new Map();
  const loose = [];
  for (const action of actions) {
    const id = action.milestoneId;
    if (!id || !positions.has(id)) {
      loose.push(action);
      continue;
    }
    const group = groups.get(id) || [];
    group.push(action);
    groups.set(id, group);
  }
  return { groups, loose, positions };
}
