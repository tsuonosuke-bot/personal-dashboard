import { fetchSupabase } from "@personal-dashboards/auth";
import { DashboardError, type DashboardEnv } from "./dashboard.ts";
import { supabaseHeaders } from "./supabaseAuth.ts";

export interface NextActionResolution {
  resolution: "continue" | "complete" | "waiting" | "on_hold";
  nextActionId: number | null;
  nextActionContent: string | null;
  waitingFor: string | null;
  reviewOn: string | null;
}
export interface TodoSnapshot { id: number; updatedAt: string; status: "pending" | "completed" | "skipped" }
export interface LinkedProjectAction {
  id: number; content: string; status: string; updatedAt: string;
  projectId: number; projectTitle: string; projectStatus: string;
  storedStartOn: string | null; storedDueOn: string | null;
}
export interface ProjectTodoLinkInput {
  actionId: number; actionUpdatedAt: string; todoId: number;
  todoUpdatedAt: string; todoStatus: TodoSnapshot["status"];
  resolution?: NextActionResolution | null;
}

export const TODO_LINK_SELECT = "project_action_todos(project_action_id)";
export const ACTION_TODO_SELECT = "project_action_todos(scheduled_action_id)";
export const TODO_PROJECT_SELECT = "project_action_todos(project_action_id,project_actions(id,project_id,content,status,updated_at,start_on,due_on,projects(id,title,status)))";

export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every((key) => key in value);
const positiveId = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
export const validProjectTimestamp = (value: unknown): value is string => typeof value === "string" && value.length <= 80
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && !Number.isNaN(Date.parse(value));
const validDate = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const optionalText = (value: unknown, max: number) => value === null || (typeof value === "string" && value.trim().length > 0 && value.length <= max);

/** Shared by Project and ToDo mutation inputs; no state transition is guessed. */
export function validNextActionResolution(value: unknown): value is NextActionResolution {
  if (!isRecord(value) || !exact(value, ["resolution", "nextActionId", "nextActionContent", "waitingFor", "reviewOn"])) return false;
  if (value.nextActionId !== null && !positiveId(value.nextActionId)) return false;
  if (!optionalText(value.nextActionContent, 500) || !optionalText(value.waitingFor, 240)
    || (value.reviewOn !== null && !validDate(value.reviewOn))) return false;
  if (value.resolution === "continue") return (value.nextActionId === null) !== (value.nextActionContent === null)
    && value.waitingFor === null && value.reviewOn === null;
  if (value.nextActionId !== null || value.nextActionContent !== null) return false;
  if (value.resolution === "complete") return value.waitingFor === null && value.reviewOn === null;
  if (value.resolution === "waiting") return value.waitingFor !== null && value.reviewOn !== null;
  return value.resolution === "on_hold" && value.waitingFor === null && value.reviewOn !== null;
}

export function validTodoSnapshot(value: unknown): value is TodoSnapshot {
  return isRecord(value) && exact(value, ["id", "updatedAt", "status"]) && positiveId(value.id)
    && validProjectTimestamp(value.updatedAt) && ["pending", "completed", "skipped"].includes(String(value.status));
}

/** ToDo is the execution-state authority; ordering/Next stay with Projects. */
export function actionStatusForTodo(todo: TodoSnapshot["status"], action: string): string {
  if (todo === "completed") return "done";
  if (todo === "skipped") return "cancelled";
  return ["next", "queued", "waiting"].includes(action) ? action : "queued";
}

// PostgREST detects our PK/UNIQUE foreign keys as one-to-one and returns an
// object (or null). Accept the array form too for older relation metadata.
function singleLink(value: unknown): Record<string, unknown> | null {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value)) {
    if (value.length > 1) throw new DashboardError("SUPABASE_RESPONSE_INVALID", "Multiple execution links.");
    return value.length ? singleLink(value[0]) : null;
  }
  if (!isRecord(value)) throw new DashboardError("SUPABASE_RESPONSE_INVALID", "Invalid execution link.");
  return value;
}

export function actionTodoId(row: unknown): number | null {
  if (!isRecord(row)) return null;
  const link = singleLink(row.project_action_todos);
  if (!link) return null;
  if (!isRecord(link) || !positiveId(link.scheduled_action_id)) throw new DashboardError("SUPABASE_RESPONSE_INVALID", "Invalid action link.");
  return link.scheduled_action_id;
}

export function linkedProjectAction(row: unknown): LinkedProjectAction | null {
  if (!isRecord(row)) return null;
  const link = singleLink(row.project_action_todos);
  if (!link) return null;
  const action = isRecord(link) ? link.project_actions : null;
  const project = isRecord(action) ? action.projects : null;
  if (!isRecord(action) || !isRecord(project) || !positiveId(action.id) || !positiveId(project.id)
    || typeof action.content !== "string" || typeof project.title !== "string" || !validProjectTimestamp(action.updated_at)
    || !["next", "queued", "waiting", "done", "cancelled"].includes(String(action.status))
    || !["active", "waiting", "on_hold", "completed", "dropped"].includes(String(project.status))) {
    throw new DashboardError("SUPABASE_RESPONSE_INVALID", "Invalid linked Project.");
  }
  return { id: action.id, content: action.content, status: String(action.status), updatedAt: action.updated_at,
    projectId: project.id, projectTitle: project.title, projectStatus: String(project.status),
    storedStartOn: typeof action.start_on === "string" ? action.start_on : null,
    storedDueOn: typeof action.due_on === "string" ? action.due_on : null };
}

export async function readProjectTodoLinkInput(request: Request) {
  let value: unknown;
  try {
    const raw = await request.text();
    if (raw.length > 6000) return { ok: false as const, status: 413, error: "リクエストが大きすぎます。" };
    value = JSON.parse(raw);
  } catch { return { ok: false as const, status: 400, error: "JSONの形式が正しくありません。" }; }
  const keys = ["actionId", "actionUpdatedAt", "todoId", "todoUpdatedAt", "todoStatus"];
  if (!isRecord(value) || !exact(value, "resolution" in value ? [...keys, "resolution"] : keys)
    || !positiveId(value.actionId) || !positiveId(value.todoId) || !validProjectTimestamp(value.actionUpdatedAt)
    || !validProjectTimestamp(value.todoUpdatedAt) || !["pending", "completed", "skipped"].includes(String(value.todoStatus))
    || (value.resolution !== undefined && value.resolution !== null && !validNextActionResolution(value.resolution))) {
    return { ok: false as const, status: 400, error: "紐づけるタスクとToDoの最新情報を確認してください。" };
  }
  if (request.method === "DELETE" && value.resolution != null) return { ok: false as const, status: 400, error: "解除では状態を変更できません。" };
  return { ok: true as const, value: value as unknown as ProjectTodoLinkInput };
}

export async function projectTodoRpc(env: DashboardEnv, name: string, body: Record<string, unknown>): Promise<unknown> {
  if (!env.SUPABASE_URL?.trim() || !env.SUPABASE_SECRET_KEY?.trim()) throw new DashboardError("SUPABASE_NOT_CONFIGURED", "Supabase is not configured.", 503);
  let url: URL;
  try { url = new URL(`/rest/v1/rpc/${name}`, env.SUPABASE_URL.trim()); } catch { throw new DashboardError("SUPABASE_CONFIG_INVALID", "Invalid Supabase URL.", 503); }
  if (url.protocol !== "https:") throw new DashboardError("SUPABASE_CONFIG_INVALID", "Invalid Supabase URL.", 503);
  let response: Response;
  try { response = await fetchSupabase(url, { method: "POST", headers: supabaseHeaders(env.SUPABASE_SECRET_KEY.trim(), { "Content-Type": "application/json" }), body: JSON.stringify(body) }); }
  catch { throw new DashboardError("SUPABASE_UNAVAILABLE", "Could not reach linked actions."); }
  if (!response.ok) {
    const detail = await response.text();
    const marker = ["TODO_ALREADY_LINKED", "TODO_LINK_CONFLICT", "TODO_CONFLICT", "TODO_SNAPSHOT_REQUIRED", "TODO_DATES_OWNED", "TODO_PROJECT_CLOSED",
      "ACTION_CONFLICT", "PROJECT_NOT_OPEN", "PROJECT_NOT_ACTIVE", "RESOLUTION_INVALID", "NEXT_ACTION_REQUIRED", "WAITING_DETAILS_REQUIRED", "REVIEW_DATE_REQUIRED", "QUEUED_ACTION_NOT_FOUND"]
      .find((item) => detail.includes(item));
    if (marker) throw new DashboardError(marker, "Linked action changed or requires more input.", marker.includes("REQUIRED") && marker !== "TODO_SNAPSHOT_REQUIRED" ? 400 : 409);
    throw new DashboardError("SUPABASE_REQUEST_FAILED", "Could not update linked actions.");
  }
  try { return await response.json(); } catch { throw new DashboardError("SUPABASE_RESPONSE_INVALID", "Invalid linked action response."); }
}

export function publicProjectTodoError(error: unknown) {
  const code = error instanceof DashboardError ? error.code : "TODO_LINK_FAILED";
  const messages: Record<string, string> = {
    TODO_ALREADY_LINKED: "どちらかが別のタスクと紐づいています。再読み込みしてください。",
    TODO_PROJECT_CLOSED: "このProjectは終了済みです。紐づけを解除してからToDoを変更してください。",
    TODO_DATES_OWNED: "紐づいているToDoから日程を変更してください。",
    PROJECT_NOT_OPEN: "終了済みのProjectには紐づけられません。進行中・待機・保留のProjectを選んでください。",
    RESOLUTION_INVALID: "Next Action終了後の扱いを選んでください。",
    NEXT_ACTION_REQUIRED: "次のActionを1件選ぶか入力してください。",
    WAITING_DETAILS_REQUIRED: "待っている相手・内容と再確認日を入力してください。",
    REVIEW_DATE_REQUIRED: "見直し日を入力してください。",
  };
  return { code, status: error instanceof DashboardError ? error.status : 502,
    message: messages[code] || "タスクまたはToDoが変更された可能性があります。入力を控え、最新状態を再読み込みしてからやり直してください。" };
}
