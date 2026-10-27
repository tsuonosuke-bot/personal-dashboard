// Small, DOM-free helpers shared by capture, portfolio and review rendering.
export function createCaptureRequest(project, content, requestId) {
  return {
    operation: "capture",
    requestId,
    projectId: project.id,
    projectUpdatedAt: project.updatedAt,
    content: content.trim(),
  };
}

export function mergeReviewActions(previous, current) {
  return [
    ...new Map(
      [...(previous?.reviewActions || previous?.actions || []), ...current.actions].map(
        (action) => [action.id, action],
      ),
    ).values(),
  ];
}

export function reviewReasons(project, data) {
  const reasons = [];
  if (data.targetOverdue.some((entry) => entry.id === project.id)) reasons.push("目標期限超過");
  const overdue = data.overdue.filter((entry) => entry.project.id === project.id).length;
  if (overdue) reasons.push(`タスク期限超過 ${overdue}件`);
  if (project.needsAttention) reasons.push("要確認");
  if (project.stale) reasons.push("更新なし");
  return reasons;
}

export function goalProgress(project, goal, weekStart) {
  if (goal) return { nextMilestone: goal.nextMilestone, weekDone: goal.weekDone };
  // A partial list/history cannot establish a zero count. Use only a server
  // projection; missing data remains unknown instead of masquerading as zero.
  return { nextMilestone: null, weekDone: null, weekStart };
}

export function readCaptureDraft(storage, projectId) {
  try {
    const draft = JSON.parse(storage.getItem(`project-capture:${projectId}`) || "null");
    if (!draft || typeof draft.content !== "string" || draft.content.length > 500) return null;
    if (
      draft.pending &&
      (draft.pending.projectId !== projectId ||
        draft.pending.operation !== "capture" ||
        typeof draft.pending.requestId !== "string" ||
        draft.pending.content !== draft.content.trim())
    )
      return null;
    return draft;
  } catch {
    return null;
  }
}

export function saveCaptureDraft(storage, projectId, draft) {
  try {
    if (draft) storage.setItem(`project-capture:${projectId}`, JSON.stringify(draft));
    else storage.removeItem(`project-capture:${projectId}`);
  } catch {
    /* A storage failure never prevents an in-memory capture. */
  }
}
