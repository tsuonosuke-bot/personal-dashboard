import {
  normalizeProjects,
  type ProjectRow,
  type ProjectActionRow,
  type ProjectItemRow,
  type ProjectMilestoneRow,
} from "../functions/_shared/projectModel.ts";

export function projectReadFixture(
  projects: ProjectRow[],
  actions: ProjectActionRow[] = [],
  items: ProjectItemRow[] = [],
  milestones: ProjectMilestoneRow[] = [],
) {
  const normalized = normalizeProjects(projects, actions, items, milestones);
  const byId = new Map(normalized.projects.map((project) => [project.id, project]));
  return {
    projects: projects.map((row) => {
      const p = byId.get(Number(row.id))!;
      return {
        ...row,
        open_count: p.actions.filter((a) => ["next", "queued", "waiting"].includes(a.status))
          .length,
        queued_count: p.actions.filter((a) => a.status === "queued").length,
        done_count: p.actions.filter((a) => a.status === "done").length,
        history_count: p.actions.filter((a) => ["done", "cancelled"].includes(a.status)).length,
        item_count: p.items.length,
        unprocessed: p.items.filter((i) => i.treatment === "unprocessed").length,
        needs_attention: p.needsAttention,
        stale: p.stale,
        last_activity_at: p.lastActivityAt,
        context_matches: true,
      };
    }),
    actions,
    items,
    milestones: milestones.map((row) => ({
      ...row,
      ...byId.get(Number(row.project_id))!.milestones.find((m) => m.id === Number(row.id)),
    })),
    summary: normalized.summary,
    reviewCalendarActions: [],
    page: {
      view: "active",
      offset: 0,
      total: projects.length,
      hasMore: false,
      historyOffset: 0,
      historyHasMore: false,
      itemOffset: 0,
      itemsHasMore: false,
    },
  };
}

export function hubReadFixture(
  input: RequestInfo | URL,
  init?: RequestInit,
  overrides: Record<string, unknown> = {},
) {
  const url = new URL(String(input));
  if (url.pathname.endsWith("/get_hub_local_summary")) {
    const source = JSON.parse(String(init?.body || "{}")).p_source;
    const local: Record<string, unknown> = {
      inbox: { pendingInbox: 0, items: [] },
      wants: { activeWants: 0, untriagedWants: 0 },
      focus: { items: [] },
      projects: { activeProjects: 0 },
      writing: { writingIdeas: 0 },
      habits: { summary: { active: 0, completedToday: 0, remainingToday: 0 } },
    };
    return Response.json(overrides[source] ?? local[source]);
  }
  if (url.pathname === "/api/hub-summary")
    return Response.json(
      url.hostname.includes("knowledge")
        ? {
            dueCount: 0,
            weakCount: 0,
            items: [],
            reviewStatus: {
              ready_due: 0,
              waiting_grading: 0,
              grading_errors: 0,
              unconfirmed_results: 0,
              generation_held: 0,
            },
            ...(overrides.knowledge as object),
          }
        : {
            currentMonthSpend: 0,
            previousMonthSpend: 0,
            recentExpenses: [],
            ...(overrides.expenses as object),
          },
    );
  if (url.pathname === "/api/status") return Response.json({});
  return Response.json([]);
}

export function ideaReadFixture() {
  return {
    inbox: [],
    wants: [],
    routes: [],
    summary: {
      inboxTotal: 0,
      pendingInbox: 0,
      wantsTotal: 0,
      activeWants: 0,
      completedWants: 0,
      untriagedWants: 0,
      dueForReview: 0,
      knowledgePending: 0,
      githubPending: 0,
    },
    statuses: ["pending", "done"],
    page: { total: 0, offset: 0, hasMore: false },
    routePage: { total: 0, offset: 0, hasMore: false },
  };
}
