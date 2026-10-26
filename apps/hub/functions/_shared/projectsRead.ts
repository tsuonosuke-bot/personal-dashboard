import { fetchSupabase } from "@personal-dashboards/auth";
import { DashboardError, type DashboardEnv } from "./dashboard.ts";
import {
  normalizeProjects,
  type ProjectRow,
  type ProjectActionRow,
  type ProjectItemRow,
  type ProjectMilestoneRow,
} from "./projectModel.ts";
import { actionTodoId } from "./projectActionTodos.ts";
import { listScheduledActions } from "./scheduledActions.ts";
import { mapConcurrent } from "./concurrency.ts";
import { parseCalendarSchedule, type CalendarSchedule } from "./googleCalendar.ts";

export interface ProjectReadQuery {
  view?: "active" | "waiting" | "completed" | "review" | "all" | "today";
  search?: string;
  offset?: number;
  limit?: number;
  projectId?: number;
  historyOffset?: number;
  historyLimit?: number;
  itemOffset?: number;
  attention?: boolean;
  sort?: "recommended" | "updated" | "target" | "review";
}
export function readProjectQuery(url: URL): ProjectReadQuery | null {
  const params = url.searchParams;
  const view = params.get("view") ?? "active";
  const sort = params.get("sort") ?? "recommended";
  const query = {
    view,
    sort,
    search: (params.get("q") ?? "").trim(),
    offset: Number(params.get("offset") ?? 0),
    limit: Number(params.get("limit") ?? 50),
    projectId: params.has("id") ? Number(params.get("id")) : undefined,
    historyOffset: Number(params.get("historyOffset") ?? 0),
    historyLimit: Number(params.get("historyLimit") ?? 10),
    itemOffset: Number(params.get("itemOffset") ?? 0),
    attention: params.get("attention") === "true",
  };
  if (
    !["active", "waiting", "completed", "review", "all"].includes(view) ||
    !["recommended", "updated", "target", "review"].includes(sort) ||
    query.search.length > 500 ||
    [query.offset, query.historyOffset, query.itemOffset].some(
      (n) => !Number.isSafeInteger(n) || n < 0,
    ) ||
    [query.limit, query.historyLimit].some((n) => !Number.isSafeInteger(n) || n < 1 || n > 100) ||
    (query.projectId !== undefined &&
      (!Number.isSafeInteger(query.projectId) || query.projectId <= 0))
  )
    return null;
  return query as ProjectReadQuery;
}

function connection(env: DashboardEnv) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY)
    throw new DashboardError("SUPABASE_NOT_CONFIGURED", "Supabase is not configured.", 503);
  const url = new URL(env.SUPABASE_URL);
  if (url.protocol !== "https:")
    throw new DashboardError("SUPABASE_CONFIG_INVALID", "Supabase URL must use HTTPS.", 503);
  return {
    url,
    headers: {
      Accept: "application/json",
      apikey: env.SUPABASE_SECRET_KEY,
      "Content-Type": "application/json",
    },
  };
}

/** Database summaries plus selected bodies; never fetch all histories to build the list. */
export async function loadProjectReadModel(
  env: DashboardEnv,
  query: ProjectReadQuery = {},
  sharedTodos?: Promise<Awaited<ReturnType<typeof listScheduledActions>>>,
  now = new Date(),
) {
  const info = connection(env);
  const response = await fetchSupabase(
    new URL("/rest/v1/rpc/get_project_read_model", info.url),
    {
      method: "POST",
      headers: info.headers,
      body: JSON.stringify({
        p_view: query.view ?? "active",
        p_search: query.search?.trim() ?? "",
        p_offset: query.offset ?? 0,
        p_limit: query.limit ?? 50,
        p_project_id: query.projectId ?? null,
        p_history_offset: query.historyOffset ?? 0,
        p_history_limit: query.historyLimit ?? 10,
        p_item_offset: query.itemOffset ?? 0,
        p_today: new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10),
        p_attention: query.attention ?? false,
        p_sort: query.sort ?? "recommended",
      }),
    },
    { retryTransientAuth: true },
  );
  if (!response.ok)
    throw new DashboardError(
      response.status === 401 || response.status === 403
        ? "SUPABASE_ACCESS_DENIED"
        : "SUPABASE_REQUEST_FAILED",
      "Project read failed.",
    );
  const data = (await response.json()) as {
    projects: ProjectRow[];
    actions: ProjectActionRow[];
    items: ProjectItemRow[];
    milestones: ProjectMilestoneRow[];
    summary: ReturnType<typeof normalizeProjects>["summary"] & { reviewPending?: number };
    reviewCalendarActions?: Array<{ todoId: number; projectId: number; date: string; schedule?: unknown }>;
    page: Record<string, unknown>;
  };
  if (
    !data ||
    ![data.projects, data.actions, data.items, data.milestones].every(Array.isArray) ||
    !data.summary ||
    !data.page
  )
    throw new DashboardError("SUPABASE_RESPONSE_INVALID", "Invalid Project read model.");
  const model = normalizeProjects(data.projects, data.actions, data.items, data.milestones, now);
  const rawProjects = new Map(
    data.projects.map((row) => [Number(row.id), row as Record<string, unknown>]),
  );
  const progress = new Map(
    data.milestones.map((row) => [Number(row.id), row as Record<string, unknown>]),
  );
  const linked = new Map(
    data.actions.flatMap((row) => {
      const id = actionTodoId(row);
      return id ? [[Number(row.id), id] as const] : [];
    }),
  );
  const reviewCalendar = data.reviewCalendarActions ?? [];
  if (
    !Array.isArray(reviewCalendar) ||
    reviewCalendar.some(
      (row) => !Number.isSafeInteger(row.todoId) || row.todoId <= 0 || typeof row.date !== "string",
    )
  )
    throw new DashboardError("SUPABASE_RESPONSE_INVALID", "Invalid review Calendar projection.");
  const needed = [...new Set([...linked.values(), ...reviewCalendar.map((row) => row.todoId)])];
  const shared = sharedTodos ? await sharedTodos : null;
  const todos = new Map((shared?.items ?? []).map((todo) => [todo.id, todo]));
  const missing = needed.filter((id) => !todos.has(id));
  const fetched = missing.length ? await listScheduledActions(env, { ids: missing }) : null;
  for (const todo of fetched?.items ?? []) todos.set(todo.id, todo);
  const cacheItems: Array<{
    id: number;
    updated_at: string;
    effective_date: string;
    schedule: CalendarSchedule;
    fetched_at: string;
  }> = [];
  const today = new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10);
  for (const row of reviewCalendar) {
    const todo = todos.get(row.todoId);
    if (!todo) throw new DashboardError("SUPABASE_RESPONSE_INVALID", "Review ToDo is missing.");
    if (todo.calendarState !== "confirmed") {
      // Keep the same previously confirmed fallback in the count and selected
      // Action. The unavailable marker still prevents an unsafe reschedule.
      todos.set(todo.id, { ...todo, schedule: parseCalendarSchedule(row.schedule) ?? { ...todo.schedule, date: row.date } });
      continue;
    }
    if (typeof data.summary.reviewPending === "number")
      data.summary.reviewPending += Number(todo.schedule.date < today) - Number(row.date < today);
    const fromShared = shared?.items.some((item) => item.id === todo.id);
    cacheItems.push({
      id: todo.id,
      updated_at: todo.updatedAt,
      effective_date: todo.schedule.date,
      schedule: todo.schedule,
      fetched_at:
        (fromShared ? shared?.source.syncStartedAt : fetched?.source.syncStartedAt) ??
        now.toISOString(),
    });
  }
  const chunks: (typeof cacheItems)[] = [];
  for (let index = 0; index < cacheItems.length; index += 100)
    chunks.push(cacheItems.slice(index, index + 100));
  const saved = await mapConcurrent(chunks, 4, async (items) => {
    const response = await fetchSupabase(
      new URL("/rest/v1/rpc/record_project_todo_read_cache", info.url),
      {
        method: "POST",
        headers: info.headers,
        body: JSON.stringify({ p_items: items }),
      },
    );
    if (!response.ok)
      throw new DashboardError(
        "SUPABASE_REQUEST_FAILED",
        "Could not save confirmed Calendar read cache.",
      );
  });
  for (const result of saved) if (result.status === "rejected") throw result.reason;
  const projects = model.projects.map((project) => {
    const raw = rawProjects.get(project.id)!;
    for (const action of project.actions) {
      const todoId = linked.get(action.id);
      if (!todoId) continue;
      const todo = todos.get(todoId);
      if (!todo) throw new DashboardError("SUPABASE_RESPONSE_INVALID", "Linked ToDo is missing.");
      action.storedStartOn = action.startOn;
      action.storedDueOn = action.dueOn;
      action.startOn = todo.schedule.date;
      action.dueOn = todo.schedule.date;
      action.linkedTodo = todo;
    }
    for (const milestone of project.milestones) {
      const counts = progress.get(milestone.id)!;
      milestone.total = Number(counts.total);
      milestone.done = Number(counts.done);
    }
    return {
      ...project,
      needsAttention: raw.needs_attention === true,
      stale: raw.stale === true,
      lastActivityAt: String(raw.last_activity_at),
      counts: {
        queued: Number(raw.queued_count),
        open: Number(raw.open_count),
        done: Number(raw.done_count),
        history: Number(raw.history_count),
        items: Number(raw.item_count),
        unprocessed: Number(raw.unprocessed),
      },
      detailLoaded: query.projectId !== undefined,
      searchMatched: query.search?.trim() ? raw.context_matches === true : undefined,
      page: query.projectId ? data.page : null,
    };
  });
  return {
    projects,
    summary: data.summary,
    page: data.page,
    partial: query.projectId !== undefined,
    source: {
      state: [shared?.source.state, fetched?.source.state].some(
        (state) => state && state !== "live",
      )
        ? "partial"
        : "live",
    },
  };
}

export async function findMutationProjectId(
  env: DashboardEnv,
  table: "project_actions" | "project_items",
  id: number,
): Promise<number> {
  const info = connection(env);
  const endpoint = new URL(`/rest/v1/${table}`, info.url);
  endpoint.searchParams.set("select", "project_id");
  endpoint.searchParams.set("id", `eq.${id}`);
  endpoint.searchParams.set("limit", "1");
  const response = await fetchSupabase(endpoint, { headers: info.headers });
  if (!response.ok)
    throw new DashboardError("SUPABASE_REQUEST_FAILED", "Could not locate Project.");
  const rows = (await response.json()) as Array<{ project_id: number }>;
  if (!Array.isArray(rows) || !Number.isSafeInteger(rows[0]?.project_id) || rows[0].project_id <= 0)
    throw new DashboardError("PROJECT_ACTION_CONFLICT", "Project no longer exists.", 409);
  return rows[0].project_id;
}

export async function projectMutationResult(
  env: DashboardEnv,
  projectId: number,
  request?: Request,
) {
  const context = request ? readProjectQuery(new URL(request.url)) : {};
  try {
    return await loadProjectReadModel(env, { ...context, projectId });
  } catch {
    return {
      saved: true,
      projectId,
      refreshError:
        "保存は完了しました。Projectの最新状態を取得できませんでした。詳細を再読み込みしてください。",
    };
  }
}
