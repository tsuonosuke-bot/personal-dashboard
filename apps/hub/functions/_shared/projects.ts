/** Project data acquisition and atomic mutations. Public model/validation exports stay compatible. */
import { ACTION_TODO_SELECT, actionTodoId, projectTodoRpc, publicProjectTodoError } from "./projectActionTodos.ts";
import { type DashboardEnv, DashboardError } from "./dashboard.ts";
import { fetchSupabase } from "@personal-dashboards/auth";
import {
  type ProjectRow,
  type ProjectActionRow,
  type ProjectItemRow,
  type ProjectMilestoneRow,
  normalizeProjects,
  positiveInteger,
  type ProjectCreateInput,
  type ProjectSourceRouteInput,
  type ProjectItemProcessInput,
  type ProjectUpdateInput,
  type ProjectActionCreateInput,
  type ProjectActionResolveInput,
  type ProjectActionUpdateInput,
  type ProjectMilestoneUpdateInput,
} from "./projectModel.ts";
import { listScheduledActions } from "./scheduledActions.ts";

const PAGE_SIZE = 1_000;

const PROJECT_SELECT = "id,title,outcome,theme,status,target_on,review_on,waiting_for,completed_at,created_at,updated_at";

const ACTION_SELECT = `id,project_id,project_item_id,milestone_id,content,status,due_on,start_on,sort_order,waiting_for,completed_at,created_at,updated_at,${ACTION_TODO_SELECT}`;

const MILESTONE_SELECT = "id,project_id,title,due_on,sort_order,status,completed_at,created_at,updated_at";

const ITEM_SELECT = "id,project_id,source_type,source_id,source_content,treatment,created_at,updated_at";

function connection(env: DashboardEnv): { url: URL; key: string } {
  const rawUrl = env.SUPABASE_URL?.trim();
  const key = env.SUPABASE_SECRET_KEY?.trim();
  if (!rawUrl || !key) throw new DashboardError("SUPABASE_NOT_CONFIGURED", "Supabase is not configured.", 503);
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new DashboardError("SUPABASE_CONFIG_INVALID", "SUPABASE_URL is invalid.", 503);
  }
  if (url.protocol !== "https:") throw new DashboardError("SUPABASE_CONFIG_INVALID", "SUPABASE_URL must use HTTPS.", 503);
  return { url, key };
}

async function supabaseFetch(
  connectionInfo: { url: URL; key: string },
  endpoint: URL,
  init: RequestInit = {},
): Promise<Response> {
  try {
    return await fetchSupabase(endpoint, {
      ...init,
      headers: { Accept: "application/json", apikey: connectionInfo.key, ...(init.headers || {}) },
    }, { retryTransientAuth: (init.method ?? "GET").toUpperCase() === "GET" });
  } catch {
    throw new DashboardError("SUPABASE_UNAVAILABLE", "Could not reach project data.");
  }
}

async function projectResponseError(response: Response, source: string): Promise<DashboardError> {
  let detail = "";
  try {
    detail = await response.text();
  } catch {
    // The public error never exposes database detail.
  }
  const markers: Array<[string, string, number]> = [
    ["TODO_SNAPSHOT_REQUIRED", "TODO_SNAPSHOT_REQUIRED", 409],
    ["TODO_LINK_CONFLICT", "TODO_LINK_CONFLICT", 409],
    ["TODO_CONFLICT", "TODO_CONFLICT", 409],
    ["TODO_DATES_OWNED", "TODO_DATES_OWNED", 409],
    ["PROJECT_SOURCE_ALREADY_LINKED", "PROJECT_SOURCE_ALREADY_LINKED", 409],
    ["project_items_one_project_per_source_idx", "PROJECT_SOURCE_ALREADY_LINKED", 409],
    ["PROJECT_SOURCE_CONFLICT", "PROJECT_SOURCE_CONFLICT", 409],
    ["PROJECT_SOURCE_INVALID", "PROJECT_SOURCE_INVALID", 400],
    ["PROJECT_NOT_OPEN", "PROJECT_NOT_OPEN", 409],
    ["PROJECT_ITEM_CONFLICT", "PROJECT_ITEM_CONFLICT", 409],
    ["PROJECT_ITEM_ACTION_REQUIRED", "PROJECT_ITEM_INVALID", 400],
    ["PROJECT_ITEM_ACTION_UNEXPECTED", "PROJECT_ITEM_INVALID", 400],
    ["PROJECT_ITEM_TREATMENT_INVALID", "PROJECT_ITEM_INVALID", 400],
    ["PROJECT_CONFLICT", "PROJECT_UPDATE_CONFLICT", 409],
    ["ACTION_CONFLICT", "PROJECT_ACTION_CONFLICT", 409],
    ["PROJECT_NOT_ACTIVE", "PROJECT_NOT_ACTIVE", 409],
    ["PROJECT_NOT_RESUMABLE", "PROJECT_NOT_RESUMABLE", 409],
    ["ACTION_DATES_INVALID", "PROJECT_ACTION_DATES_INVALID", 400],
    ["project_actions_start_before_due", "PROJECT_ACTION_DATES_INVALID", 400],
    ["ACTION_CONTENT_REQUIRED", "PROJECT_ACTION_INVALID", 400],
    ["ACTION_OPERATION_INVALID", "PROJECT_ACTION_INVALID", 400],
    ["ACTION_MOVE_OUT_OF_RANGE", "PROJECT_ACTION_CONFLICT", 409],
    ["ACTION_MILESTONE_INVALID", "PROJECT_ACTION_MILESTONE_INVALID", 400],
    ["project_actions_milestone_same_project_fkey", "PROJECT_ACTION_MILESTONE_INVALID", 400],
    ["ACTIONS_COUNT_INVALID", "PROJECT_ACTION_INVALID", 400],
    ["MILESTONE_CONFLICT", "PROJECT_MILESTONE_CONFLICT", 409],
    ["MILESTONE_MOVE_OUT_OF_RANGE", "PROJECT_MILESTONE_CONFLICT", 409],
    ["MILESTONE_TITLE_REQUIRED", "PROJECT_MILESTONE_INVALID", 400],
    ["MILESTONE_OPERATION_INVALID", "PROJECT_MILESTONE_INVALID", 400],
    ["QUEUED_ACTION_NOT_FOUND", "PROJECT_ACTION_CONFLICT", 409],
    ["NEXT_ACTION_REQUIRED", "PROJECT_ACTION_INVALID", 400],
    ["WAITING_DETAILS_REQUIRED", "PROJECT_ACTION_INVALID", 400],
    ["REVIEW_DATE_REQUIRED", "PROJECT_ACTION_INVALID", 400],
    ["RESOLUTION_INVALID", "PROJECT_ACTION_INVALID", 400],
  ];
  const marker = markers.find(([needle]) => detail.includes(needle));
  if (marker) return new DashboardError(marker[1], `${source} mutation was rejected.`, marker[2]);
  const code = response.status === 401 || response.status === 403
    ? "SUPABASE_ACCESS_DENIED"
    : "SUPABASE_REQUEST_FAILED";
  return new DashboardError(code, `${source} returned ${response.status}.`);
}

async function fetchRows(
  env: DashboardEnv,
  table: "projects" | "project_actions" | "project_items" | "project_milestones",
  select: string,
  order: string,
): Promise<unknown[]> {
  const connectionInfo = connection(env);
  const allRows: unknown[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const endpoint = new URL(`/rest/v1/${table}`, connectionInfo.url);
    endpoint.searchParams.set("select", select);
    endpoint.searchParams.set("order", order);
    endpoint.searchParams.set("limit", String(PAGE_SIZE));
    endpoint.searchParams.set("offset", String(offset));
    const response = await supabaseFetch(connectionInfo, endpoint);
    if (!response.ok) throw await projectResponseError(response, table);
    const rows: unknown = await response.json();
    if (!Array.isArray(rows)) throw new DashboardError("SUPABASE_RESPONSE_INVALID", `${table} returned invalid data.`);
    allRows.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return allRows;
}

export async function loadProjects(env: DashboardEnv, now = new Date()) {
  const [projects, actions, items, milestones] = await Promise.all([
    fetchRows(env, "projects", PROJECT_SELECT, "updated_at.desc,id.desc") as Promise<ProjectRow[]>,
    fetchRows(env, "project_actions", ACTION_SELECT, "updated_at.desc,id.desc") as Promise<ProjectActionRow[]>,
    fetchRows(env, "project_items", ITEM_SELECT, "updated_at.desc,id.desc") as Promise<ProjectItemRow[]>,
    fetchRows(env, "project_milestones", MILESTONE_SELECT, "sort_order.asc,id.asc") as Promise<ProjectMilestoneRow[]>,
  ]);
  const normalized = normalizeProjects(projects, actions, items, milestones, now);
  const linkedIds = new Map(actions.flatMap((row) => {
    const todoId = actionTodoId(row);
    return todoId ? [[positiveInteger(row.id)!, todoId] as const] : [];
  }));
  if (linkedIds.size) {
    const todos = new Map((await listScheduledActions(env)).items.map((todo) => [todo.id, todo]));
    for (const project of normalized.projects) for (const action of project.actions) {
      const todoId = linkedIds.get(action.id);
      if (!todoId) continue;
      const todo = todos.get(todoId);
      if (!todo) throw new DashboardError("SUPABASE_RESPONSE_INVALID", "Linked ToDo is missing.");
      action.storedStartOn = action.startOn;
      action.storedDueOn = action.dueOn;
      action.startOn = todo.schedule.date;
      action.dueOn = todo.schedule.date;
      action.linkedTodo = todo;
    }
  }
  return normalized;
}

export async function createProject(env: DashboardEnv, input: ProjectCreateInput): Promise<void> {
  const connectionInfo = connection(env);
  const endpoint = new URL("/rest/v1/rpc/create_project_with_next_action", connectionInfo.url);
  const response = await supabaseFetch(connectionInfo, endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      p_title: input.title,
      p_outcome: input.outcome,
      p_theme: input.theme,
      p_target_on: input.targetOn,
      p_next_action: input.nextAction,
    }),
  });
  if (!response.ok) throw await projectResponseError(response, "create_project_with_next_action");
}

export async function routeProjectSource(env: DashboardEnv, input: ProjectSourceRouteInput): Promise<number> {
  const connectionInfo = connection(env);
  const functionName = input.operation === "create" ? "create_project_from_source" : "link_project_source";
  const endpoint = new URL(`/rest/v1/rpc/${functionName}`, connectionInfo.url);
  const sourceParameters = {
    p_source_type: input.source.type,
    p_source_id: input.source.id,
    p_source_content: input.source.content,
    p_source_status: input.source.status,
    p_source_result: input.source.result,
  };
  const body = input.operation === "create"
    ? {
      ...sourceParameters,
      p_title: input.title,
      p_outcome: input.outcome,
      p_theme: input.theme,
      p_target_on: input.targetOn,
      p_next_action: input.nextAction,
    }
    : {
      p_project_id: input.projectId,
      p_project_updated_at: input.originalProjectUpdatedAt,
      ...sourceParameters,
    };
  const response = await supabaseFetch(connectionInfo, endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await projectResponseError(response, functionName);
  const projectId = positiveInteger(await response.json());
  if (!projectId) throw new DashboardError("SUPABASE_RESPONSE_INVALID", `${functionName} returned invalid data.`);
  return projectId;
}

export async function processProjectItem(env: DashboardEnv, input: ProjectItemProcessInput): Promise<void> {
  const connectionInfo = connection(env);
  const endpoint = new URL("/rest/v1/rpc/process_project_item", connectionInfo.url);
  const response = await supabaseFetch(connectionInfo, endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      p_project_item_id: input.itemId,
      p_project_item_updated_at: input.originalItemUpdatedAt,
      p_project_updated_at: input.originalProjectUpdatedAt,
      p_treatment: input.treatment,
      p_action_content: input.actionContent,
    }),
  });
  if (!response.ok) throw await projectResponseError(response, "process_project_item");
}

export async function updateProject(env: DashboardEnv, input: ProjectUpdateInput): Promise<void> {
  const connectionInfo = connection(env);
  const endpoint = new URL("/rest/v1/projects", connectionInfo.url);
  endpoint.searchParams.set("id", `eq.${input.id}`);
  endpoint.searchParams.set("updated_at", `eq.${input.originalUpdatedAt}`);
  endpoint.searchParams.set("select", "id");
  const response = await supabaseFetch(connectionInfo, endpoint, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({
      title: input.title,
      outcome: input.outcome,
      theme: input.theme,
      target_on: input.targetOn,
      updated_at: new Date().toISOString(),
    }),
  });
  if (!response.ok) throw await projectResponseError(response, "projects");
  const rows: unknown = await response.json();
  if (!Array.isArray(rows)) throw new DashboardError("SUPABASE_RESPONSE_INVALID", "projects returned invalid data.");
  if (rows.length === 0) throw new DashboardError("PROJECT_UPDATE_CONFLICT", "Project changed before update.", 409);
  if (rows.length !== 1) throw new DashboardError("SUPABASE_RESPONSE_INVALID", "projects updated an unexpected number of rows.");
}

export async function createProjectAction(env: DashboardEnv, input: ProjectActionCreateInput): Promise<void> {
  const connectionInfo = connection(env);
  const functionName = input.operation === "resume"
    ? "resume_project_with_next_action"
    : input.operation === "addBulk" ? "add_project_queued_actions" : "add_project_queued_action";
  const endpoint = new URL(`/rest/v1/rpc/${functionName}`, connectionInfo.url);
  const body = input.operation === "addBulk"
    ? { p_contents: input.contents, p_milestone_id: input.milestoneId }
    : input.operation === "resume" ? { p_next_action: input.content } : { p_content: input.content };
  const response = await supabaseFetch(connectionInfo, endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      p_project_id: input.projectId,
      p_project_updated_at: input.originalProjectUpdatedAt,
      ...body,
    }),
  });
  if (!response.ok) throw await projectResponseError(response, functionName);
}

export async function resolveProjectAction(env: DashboardEnv, input: ProjectActionResolveInput): Promise<void> {
  if (input.todo || input.terminal === "cancelled") {
    await projectTodoRpc(env, "resolve_project_next_action_with_todo", {
      p_action_id: input.actionId, p_action_updated_at: input.originalUpdatedAt, p_resolution: input.resolution,
      p_next_action_id: input.nextActionId, p_next_action_content: input.nextActionContent, p_waiting_for: input.waitingFor, p_review_on: input.reviewOn,
      p_todo_id: input.todo?.id ?? null, p_todo_updated_at: input.todo?.updatedAt ?? null, p_todo_status: input.todo?.status ?? null,
      p_terminal: input.terminal ?? "done",
    });
    return;
  }
  const connectionInfo = connection(env);
  const endpoint = new URL("/rest/v1/rpc/resolve_project_next_action", connectionInfo.url);
  const response = await supabaseFetch(connectionInfo, endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      p_action_id: input.actionId,
      p_action_updated_at: input.originalUpdatedAt,
      p_resolution: input.resolution,
      p_next_action_id: input.nextActionId,
      p_next_action_content: input.nextActionContent,
      p_waiting_for: input.waitingFor,
      p_review_on: input.reviewOn,
    }),
  });
  if (!response.ok) throw await projectResponseError(response, "resolve_project_next_action");
}

export async function updateProjectAction(env: DashboardEnv, input: ProjectActionUpdateInput): Promise<void> {
  if (input.todo) {
    await projectTodoRpc(env, "update_project_action_with_todo", {
      p_action_id: input.actionId, p_action_updated_at: input.originalUpdatedAt, p_operation: input.operation,
      p_content: input.content, p_due_on: input.dueOn, p_start_on: input.startOn, p_milestone_id: input.milestoneId,
      p_todo_id: input.todo.id, p_todo_updated_at: input.todo.updatedAt, p_todo_status: input.todo.status,
    });
    return;
  }
  const connectionInfo = connection(env);
  const endpoint = new URL("/rest/v1/rpc/update_project_action", connectionInfo.url);
  const response = await supabaseFetch(connectionInfo, endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      p_action_id: input.actionId,
      p_action_updated_at: input.originalUpdatedAt,
      p_operation: input.operation,
      p_content: input.content,
      p_due_on: input.dueOn,
      p_start_on: input.startOn,
      p_milestone_id: input.milestoneId,
    }),
  });
  if (!response.ok) throw await projectResponseError(response, "update_project_action");
}

export async function updateProjectMilestone(env: DashboardEnv, input: ProjectMilestoneUpdateInput): Promise<void> {
  const connectionInfo = connection(env);
  const endpoint = new URL("/rest/v1/rpc/update_project_milestone", connectionInfo.url);
  const response = await supabaseFetch(connectionInfo, endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      p_project_id: input.projectId,
      p_project_updated_at: input.originalProjectUpdatedAt,
      p_milestone_id: input.milestoneId,
      p_milestone_updated_at: input.originalUpdatedAt,
      p_operation: input.operation,
      p_title: input.title,
      p_due_on: input.dueOn,
    }),
  });
  if (!response.ok) throw await projectResponseError(response, "update_project_milestone");
}

export function publicProjectError(error: unknown) {
  const code = error instanceof DashboardError ? error.code : "PROJECT_REQUEST_FAILED";
  const status = error instanceof DashboardError ? error.status : 502;
  if (code.startsWith("TODO_")) return publicProjectTodoError(error);
  const messages: Record<string, string> = {
    SUPABASE_NOT_CONFIGURED: "サーバーのSupabase接続設定が未完了です。",
    SUPABASE_CONFIG_INVALID: "サーバーのSupabase接続設定が正しくありません。",
    SUPABASE_ACCESS_DENIED: "Projectデータへの権限がありません。",
    SUPABASE_UNAVAILABLE: "Projectデータへ接続できませんでした。",
    SUPABASE_REQUEST_FAILED: "Projectデータを取得・更新できませんでした。",
    SUPABASE_RESPONSE_INVALID: "Projectデータから想定外の応答を受信しました。",
    PROJECT_UPDATE_CONFLICT: "このProjectは別の画面で更新されています。再読み込みしてからやり直してください。",
    PROJECT_ACTION_CONFLICT: "このActionは別の画面で更新されています。再読み込みしてからやり直してください。",
    PROJECT_NOT_ACTIVE: "このProjectは進行中ではありません。最新状態を確認してください。",
    PROJECT_NOT_RESUMABLE: "このProjectは再開できる状態ではありません。",
    PROJECT_ACTION_INVALID: "Actionの状態変更に必要な情報が不足しています。",
    PROJECT_ACTION_DATES_INVALID: "着手日は期日より前の日付にしてください。",
    PROJECT_ACTION_MILESTONE_INVALID: "このProjectのマイルストンを選んでください。",
    PROJECT_MILESTONE_CONFLICT: "このマイルストンは別の画面で更新されています。再読み込みしてからやり直してください。",
    PROJECT_MILESTONE_INVALID: "マイルストンの変更に必要な情報が不足しています。",
    PROJECT_SOURCE_CONFLICT: "元のInboxまたはWantは別の画面で変更されています。再読み込みしてからやり直してください。",
    PROJECT_SOURCE_ALREADY_LINKED: "このInboxまたはWantは、すでに別のProjectへ紐づいています。",
    PROJECT_SOURCE_INVALID: "Projectへ紐づけられない種類のデータです。",
    PROJECT_NOT_OPEN: "完了・見送り済みのProjectには追加・変更できません。",
    PROJECT_ITEM_CONFLICT: "この関連アイテムは別の画面で整理されています。再読み込みしてからやり直してください。",
    PROJECT_ITEM_INVALID: "関連アイテムの整理に必要な情報が不足しています。",
    PROJECT_REQUEST_FAILED: "Projectを処理できませんでした。",
  };
  return { code, status, message: messages[code] || messages.PROJECT_REQUEST_FAILED };
}

export {
  STALE_DAYS,
  MAX_BULK_ACTIONS,
  PROJECT_STATUSES,
  type ProjectStatus,
  PROJECT_ACTION_STATUSES,
  type ProjectActionStatus,
  PROJECT_ITEM_TREATMENTS,
  type ProjectItemTreatment,
  type ProjectSourceType,
  type ProjectAction,
  type ProjectMilestone,
  type ProjectItem,
  type Project,
  type ProjectCreateInput,
  type ProjectSourceSnapshot,
  type ProjectSourceRouteInput,
  type ProjectItemProcessInput,
  type ProjectUpdateInput,
  type ProjectActionCreateInput,
  PROJECT_MILESTONE_OPERATIONS,
  type ProjectMilestoneOperation,
  type ProjectMilestoneUpdateInput,
  type ProjectActionResolveInput,
  PROJECT_ACTION_OPERATIONS,
  type ProjectActionOperation,
  type ProjectActionUpdateInput,
  normalizeProjects,
} from "./projectModel.ts";

export {
  validateProjectMutationRequest,
  readProjectCreateInput,
  readProjectSourceRouteInput,
  readProjectItemProcessInput,
  readProjectUpdateInput,
  readProjectActionCreateInput,
  readProjectMilestoneUpdateInput,
  readProjectActionResolveInput,
  readProjectActionUpdateInput,
} from "./projectValidation.ts";
