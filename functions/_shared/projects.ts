import { DashboardError, type DashboardEnv } from "./dashboard.ts";

const PAGE_SIZE = 1_000;
const MAX_REQUEST_CHARS = 20_000;
const MAX_TITLE_CHARS = 240;
const MAX_OUTCOME_CHARS = 2_000;
const MAX_THEME_CHARS = 120;
const MAX_ACTION_CHARS = 500;
const MAX_WAITING_FOR_CHARS = 240;

const PROJECT_SELECT = "id,title,outcome,theme,status,target_on,review_on,waiting_for,completed_at,created_at,updated_at";
const ACTION_SELECT = "id,project_id,project_item_id,content,status,due_on,waiting_for,completed_at,created_at,updated_at";
const ITEM_SELECT = "id,project_id,source_type,source_id,source_content,treatment,created_at,updated_at";

export const PROJECT_STATUSES = ["active", "waiting", "on_hold", "completed", "dropped"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export const PROJECT_ACTION_STATUSES = ["next", "queued", "waiting", "done", "cancelled"] as const;
export type ProjectActionStatus = (typeof PROJECT_ACTION_STATUSES)[number];
export const PROJECT_ITEM_TREATMENTS = ["unprocessed", "reference", "action_source", "rejected"] as const;
export type ProjectItemTreatment = (typeof PROJECT_ITEM_TREATMENTS)[number];
export type ProjectSourceType = "inbox" | "want";

interface ProjectRow {
  id?: unknown;
  title?: unknown;
  outcome?: unknown;
  theme?: unknown;
  status?: unknown;
  target_on?: unknown;
  review_on?: unknown;
  waiting_for?: unknown;
  completed_at?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
}

interface ProjectActionRow {
  id?: unknown;
  project_id?: unknown;
  project_item_id?: unknown;
  content?: unknown;
  status?: unknown;
  due_on?: unknown;
  waiting_for?: unknown;
  completed_at?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
}

interface ProjectItemRow {
  id?: unknown;
  project_id?: unknown;
  source_type?: unknown;
  source_id?: unknown;
  source_content?: unknown;
  treatment?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
}

export interface ProjectAction {
  id: number;
  projectId: number;
  projectItemId: number | null;
  content: string;
  status: ProjectActionStatus;
  dueOn: string | null;
  waitingFor: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectItem {
  id: number;
  projectId: number;
  sourceType: ProjectSourceType;
  sourceId: number;
  sourceContent: string;
  treatment: ProjectItemTreatment;
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: number;
  title: string;
  outcome: string;
  theme: string | null;
  status: ProjectStatus;
  targetOn: string | null;
  reviewOn: string | null;
  waitingFor: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  nextAction: ProjectAction | null;
  actions: ProjectAction[];
  items: ProjectItem[];
  needsAttention: boolean;
}

export interface ProjectCreateInput {
  title: string;
  outcome: string;
  theme: string | null;
  targetOn: string | null;
  nextAction: string;
}

export interface ProjectSourceSnapshot {
  type: ProjectSourceType;
  id: number;
  content: string;
  status: "pending" | "active";
  result: string | null;
}

export type ProjectSourceRouteInput =
  | {
    operation: "create";
    source: ProjectSourceSnapshot;
    title: string;
    outcome: string;
    theme: string | null;
    targetOn: string | null;
    nextAction: string;
  }
  | {
    operation: "link";
    source: ProjectSourceSnapshot;
    projectId: number;
    originalProjectUpdatedAt: string;
  };

export interface ProjectItemProcessInput {
  itemId: number;
  originalItemUpdatedAt: string;
  originalProjectUpdatedAt: string;
  treatment: "action_source" | "reference" | "rejected";
  actionContent: string | null;
}

export interface ProjectUpdateInput {
  id: number;
  title: string;
  outcome: string;
  theme: string | null;
  targetOn: string | null;
  originalUpdatedAt: string;
}

export type ProjectActionCreateInput =
  | { operation: "addQueued"; projectId: number; content: string; originalProjectUpdatedAt: string }
  | { operation: "resume"; projectId: number; content: string; originalProjectUpdatedAt: string };

export interface ProjectActionResolveInput {
  actionId: number;
  originalUpdatedAt: string;
  resolution: "continue" | "complete" | "waiting" | "on_hold";
  nextActionId: number | null;
  nextActionContent: string | null;
  waitingFor: string | null;
  reviewOn: string | null;
}

type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; error: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function timestamp(value: unknown): string | null {
  if (typeof value !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    || Number.isNaN(Date.parse(value))) return null;
  // Preserve PostgreSQL microseconds for optimistic concurrency predicates.
  return value;
}

function calendarDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? value
    : null;
}

function optionalDate(value: unknown): string | null | undefined {
  if (value === null) return null;
  const parsed = calendarDate(value);
  return parsed || undefined;
}

function optionalText(value: unknown, max: number): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length > max) return undefined;
  return trimmed || null;
}

function requiredText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= max ? trimmed : null;
}

function isProjectStatus(value: unknown): value is ProjectStatus {
  return typeof value === "string" && (PROJECT_STATUSES as readonly string[]).includes(value);
}

function isActionStatus(value: unknown): value is ProjectActionStatus {
  return typeof value === "string" && (PROJECT_ACTION_STATUSES as readonly string[]).includes(value);
}

function isTreatment(value: unknown): value is ProjectItemTreatment {
  return typeof value === "string" && (PROJECT_ITEM_TREATMENTS as readonly string[]).includes(value);
}

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
    return await fetch(endpoint, {
      ...init,
      headers: { Accept: "application/json", apikey: connectionInfo.key, ...(init.headers || {}) },
    });
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
  table: "projects" | "project_actions" | "project_items",
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

function normalizeProjectRow(row: ProjectRow) {
  const id = positiveInteger(row.id);
  const title = requiredText(row.title, MAX_TITLE_CHARS);
  const outcome = requiredText(row.outcome, MAX_OUTCOME_CHARS);
  const theme = optionalText(row.theme, MAX_THEME_CHARS);
  const targetOn = optionalDate(row.target_on);
  const reviewOn = optionalDate(row.review_on);
  const waitingFor = optionalText(row.waiting_for, MAX_WAITING_FOR_CHARS);
  const completedAt = row.completed_at === null ? null : timestamp(row.completed_at);
  const createdAt = timestamp(row.created_at);
  const updatedAt = timestamp(row.updated_at);
  if (!id || !title || !outcome || theme === undefined || targetOn === undefined || reviewOn === undefined
    || waitingFor === undefined || !isProjectStatus(row.status) || !createdAt || !updatedAt
    || (row.completed_at !== null && !completedAt)) {
    throw new DashboardError("SUPABASE_RESPONSE_INVALID", "projects returned invalid data.");
  }
  if ((row.status === "waiting" && (!waitingFor || !reviewOn))
    || (row.status === "on_hold" && !reviewOn)
    || (row.status === "completed" && !completedAt)) {
    throw new DashboardError("SUPABASE_RESPONSE_INVALID", "projects returned inconsistent state.");
  }
  return { id, title, outcome, theme, status: row.status, targetOn, reviewOn, waitingFor, completedAt, createdAt, updatedAt };
}

function normalizeActionRow(row: ProjectActionRow): ProjectAction {
  const id = positiveInteger(row.id);
  const projectId = positiveInteger(row.project_id);
  const projectItemId = row.project_item_id === null ? null : positiveInteger(row.project_item_id);
  const content = requiredText(row.content, MAX_ACTION_CHARS);
  const dueOn = optionalDate(row.due_on);
  const waitingFor = optionalText(row.waiting_for, MAX_WAITING_FOR_CHARS);
  const completedAt = row.completed_at === null ? null : timestamp(row.completed_at);
  const createdAt = timestamp(row.created_at);
  const updatedAt = timestamp(row.updated_at);
  if (!id || !projectId || (row.project_item_id !== null && !projectItemId) || !content
    || dueOn === undefined || waitingFor === undefined || !isActionStatus(row.status)
    || (row.completed_at !== null && !completedAt) || !createdAt || !updatedAt) {
    throw new DashboardError("SUPABASE_RESPONSE_INVALID", "project_actions returned invalid data.");
  }
  if ((row.status === "waiting" && !waitingFor) || (row.status === "done" && !completedAt)) {
    throw new DashboardError("SUPABASE_RESPONSE_INVALID", "project_actions returned inconsistent state.");
  }
  return { id, projectId, projectItemId, content, status: row.status, dueOn, waitingFor, completedAt, createdAt, updatedAt };
}

function normalizeItemRow(row: ProjectItemRow): ProjectItem {
  const id = positiveInteger(row.id);
  const projectId = positiveInteger(row.project_id);
  const sourceId = positiveInteger(row.source_id);
  const sourceContent = requiredText(row.source_content, MAX_OUTCOME_CHARS);
  const createdAt = timestamp(row.created_at);
  const updatedAt = timestamp(row.updated_at);
  if (!id || !projectId || !sourceId || !sourceContent || !createdAt || !updatedAt
    || (row.source_type !== "inbox" && row.source_type !== "want") || !isTreatment(row.treatment)) {
    throw new DashboardError("SUPABASE_RESPONSE_INVALID", "project_items returned invalid data.");
  }
  return {
    id,
    projectId,
    sourceType: row.source_type,
    sourceId,
    sourceContent,
    treatment: row.treatment,
    createdAt,
    updatedAt,
  };
}

const actionOrder: Record<ProjectActionStatus, number> = { next: 0, queued: 1, waiting: 2, done: 3, cancelled: 4 };

export function normalizeProjects(
  projectRows: ProjectRow[],
  actionRows: ProjectActionRow[],
  itemRows: ProjectItemRow[],
) {
  const actions = actionRows.map(normalizeActionRow);
  const items = itemRows.map(normalizeItemRow);
  const actionsByProject = new Map<number, ProjectAction[]>();
  const itemsByProject = new Map<number, ProjectItem[]>();
  for (const action of actions) {
    const current = actionsByProject.get(action.projectId) || [];
    current.push(action);
    actionsByProject.set(action.projectId, current);
  }
  for (const item of items) {
    const current = itemsByProject.get(item.projectId) || [];
    current.push(item);
    itemsByProject.set(item.projectId, current);
  }

  const baseProjects = projectRows.map(normalizeProjectRow);
  const knownIds = new Set(baseProjects.map((project) => project.id));
  if (actions.some((action) => !knownIds.has(action.projectId)) || items.some((item) => !knownIds.has(item.projectId))) {
    throw new DashboardError("SUPABASE_RESPONSE_INVALID", "Project data contains orphan rows.");
  }

  const projects: Project[] = baseProjects.map((project) => {
    const projectActions = (actionsByProject.get(project.id) || []).sort((left, right) =>
      actionOrder[left.status] - actionOrder[right.status]
      || right.updatedAt.localeCompare(left.updatedAt)
      || right.id - left.id);
    const projectItems = (itemsByProject.get(project.id) || []).sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt) || right.id - left.id);
    const nextActions = projectActions.filter((action) => action.status === "next");
    if (nextActions.length > 1) throw new DashboardError("SUPABASE_RESPONSE_INVALID", "Project has multiple next actions.");
    const nextAction = nextActions[0] || null;
    const needsAttention = (project.status === "active" && !nextAction)
      || projectItems.some((item) => item.treatment === "unprocessed");
    return { ...project, nextAction, actions: projectActions, items: projectItems, needsAttention };
  }).sort((left, right) => {
    if (left.needsAttention !== right.needsAttention) return left.needsAttention ? -1 : 1;
    if (left.targetOn && right.targetOn && left.targetOn !== right.targetOn) return left.targetOn.localeCompare(right.targetOn);
    if (left.targetOn !== right.targetOn) return left.targetOn ? -1 : 1;
    return right.updatedAt.localeCompare(left.updatedAt) || right.id - left.id;
  });

  return {
    projects,
    summary: {
      active: projects.filter((project) => project.status === "active").length,
      needsAttention: projects.filter((project) => project.needsAttention).length,
      waiting: projects.filter((project) => project.status === "waiting" || project.status === "on_hold").length,
      completed: projects.filter((project) => project.status === "completed").length,
      openActions: actions.filter((action) => ["next", "queued", "waiting"].includes(action.status)).length,
      unprocessedItems: items.filter((item) => item.treatment === "unprocessed").length,
    },
  };
}

export async function loadProjects(env: DashboardEnv) {
  const [projects, actions, items] = await Promise.all([
    fetchRows(env, "projects", PROJECT_SELECT, "updated_at.desc,id.desc") as Promise<ProjectRow[]>,
    fetchRows(env, "project_actions", ACTION_SELECT, "updated_at.desc,id.desc") as Promise<ProjectActionRow[]>,
    fetchRows(env, "project_items", ITEM_SELECT, "updated_at.desc,id.desc") as Promise<ProjectItemRow[]>,
  ]);
  return normalizeProjects(projects, actions, items);
}

export function validateProjectMutationRequest(
  request: Request,
  expectedHeader: "project-create" | "project-update" | "project-action-create" | "project-action-resolve" | "project-source-route" | "project-item-process",
): { status: number; error: string } | null {
  let expectedOrigin: string;
  try {
    expectedOrigin = new URL(request.url).origin;
  } catch {
    return { status: 400, error: "リクエストURLが正しくありません。" };
  }
  if (request.headers.get("Origin") !== expectedOrigin) return { status: 403, error: "許可されていない送信元です。" };
  if (request.headers.get("X-Dashboard-Action") !== expectedHeader) return { status: 403, error: "更新用ヘッダーがありません。" };
  if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
    return { status: 415, error: "JSON形式で送信してください。" };
  }
  const declaredLength = Number(request.headers.get("Content-Length") || "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_CHARS) {
    return { status: 413, error: "リクエストが大きすぎます。" };
  }
  return null;
}

async function readJson(request: Request): Promise<ValidationResult<Record<string, unknown>>> {
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return { ok: false, status: 400, error: "入力内容を読み取れませんでした。" };
  }
  if (raw.length > MAX_REQUEST_CHARS) return { ok: false, status: 413, error: "リクエストが大きすぎます。" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return { ok: false, status: 400, error: "JSONの形式が正しくありません。" };
  }
  return isPlainObject(parsed)
    ? { ok: true, value: parsed }
    : { ok: false, status: 400, error: "入力内容の形式が正しくありません。" };
}

export async function readProjectCreateInput(request: Request): Promise<ValidationResult<ProjectCreateInput>> {
  const parsed = await readJson(request);
  if (!parsed.ok) return parsed;
  if (!hasExactKeys(parsed.value, ["title", "outcome", "theme", "targetOn", "nextAction"])) {
    return { ok: false, status: 400, error: "入力内容の形式が正しくありません。" };
  }
  const title = requiredText(parsed.value.title, MAX_TITLE_CHARS);
  const outcome = requiredText(parsed.value.outcome, MAX_OUTCOME_CHARS);
  const theme = optionalText(parsed.value.theme, MAX_THEME_CHARS);
  const targetOn = optionalDate(parsed.value.targetOn);
  const nextAction = requiredText(parsed.value.nextAction, MAX_ACTION_CHARS);
  if (!title) return { ok: false, status: 400, error: `Project名は1〜${MAX_TITLE_CHARS}文字で入力してください。` };
  if (!outcome) return { ok: false, status: 400, error: `完了条件は1〜${MAX_OUTCOME_CHARS}文字で入力してください。` };
  if (theme === undefined) return { ok: false, status: 400, error: `テーマは${MAX_THEME_CHARS}文字以内で入力してください。` };
  if (targetOn === undefined) return { ok: false, status: 400, error: "目標日はYYYY-MM-DD形式で入力してください。" };
  if (!nextAction) return { ok: false, status: 400, error: `Next Actionは1〜${MAX_ACTION_CHARS}文字で入力してください。` };
  return { ok: true, value: { title, outcome, theme, targetOn, nextAction } };
}

function projectSourceSnapshot(value: unknown): ProjectSourceSnapshot | null {
  if (!isPlainObject(value) || !hasExactKeys(value, ["type", "id", "content", "status", "result"])) return null;
  const id = positiveInteger(value.id);
  if (!id || typeof value.content !== "string" || !value.content.trim() || value.content.length > MAX_OUTCOME_CHARS) return null;
  if (value.result !== null && (typeof value.result !== "string" || value.result.length > MAX_OUTCOME_CHARS)) return null;
  if (value.type === "inbox" && value.status === "pending") {
    return { type: "inbox", id, content: value.content, status: "pending", result: value.result as string | null };
  }
  if (value.type === "want" && value.status === "active" && value.result === null) {
    return { type: "want", id, content: value.content, status: "active", result: null };
  }
  return null;
}

export async function readProjectSourceRouteInput(request: Request): Promise<ValidationResult<ProjectSourceRouteInput>> {
  const parsed = await readJson(request);
  if (!parsed.ok) return parsed;
  const source = projectSourceSnapshot(parsed.value.source);
  if (!source) return { ok: false, status: 400, error: "元のInboxまたはWantの情報が正しくありません。" };

  if (parsed.value.operation === "create") {
    if (!hasExactKeys(parsed.value, ["operation", "source", "title", "outcome", "theme", "targetOn", "nextAction"])) {
      return { ok: false, status: 400, error: "入力内容の形式が正しくありません。" };
    }
    const title = requiredText(parsed.value.title, MAX_TITLE_CHARS);
    const outcome = requiredText(parsed.value.outcome, MAX_OUTCOME_CHARS);
    const theme = optionalText(parsed.value.theme, MAX_THEME_CHARS);
    const targetOn = optionalDate(parsed.value.targetOn);
    const nextAction = requiredText(parsed.value.nextAction, MAX_ACTION_CHARS);
    if (!title || !outcome || theme === undefined || targetOn === undefined || !nextAction) {
      return { ok: false, status: 400, error: "Project名・完了条件・最初のNext Actionを確認してください。" };
    }
    return { ok: true, value: { operation: "create", source, title, outcome, theme, targetOn, nextAction } };
  }

  if (parsed.value.operation === "link") {
    if (!hasExactKeys(parsed.value, ["operation", "source", "projectId", "originalProjectUpdatedAt"])) {
      return { ok: false, status: 400, error: "入力内容の形式が正しくありません。" };
    }
    const projectId = positiveInteger(parsed.value.projectId);
    const originalProjectUpdatedAt = timestamp(parsed.value.originalProjectUpdatedAt);
    if (!projectId || !originalProjectUpdatedAt) {
      return { ok: false, status: 400, error: "紐づけ先のProjectが正しくありません。" };
    }
    return { ok: true, value: { operation: "link", source, projectId, originalProjectUpdatedAt } };
  }

  return { ok: false, status: 400, error: "Projectへの整理方法が正しくありません。" };
}

export async function readProjectItemProcessInput(request: Request): Promise<ValidationResult<ProjectItemProcessInput>> {
  const parsed = await readJson(request);
  if (!parsed.ok) return parsed;
  if (!hasExactKeys(parsed.value, ["itemId", "originalItemUpdatedAt", "originalProjectUpdatedAt", "treatment", "actionContent"])) {
    return { ok: false, status: 400, error: "入力内容の形式が正しくありません。" };
  }
  const itemId = positiveInteger(parsed.value.itemId);
  const originalItemUpdatedAt = timestamp(parsed.value.originalItemUpdatedAt);
  const originalProjectUpdatedAt = timestamp(parsed.value.originalProjectUpdatedAt);
  const actionContent = optionalText(parsed.value.actionContent, MAX_ACTION_CHARS);
  const treatment = parsed.value.treatment;
  if (!itemId || !originalItemUpdatedAt || !originalProjectUpdatedAt || actionContent === undefined
    || (treatment !== "action_source" && treatment !== "reference" && treatment !== "rejected")) {
    return { ok: false, status: 400, error: "関連アイテムの整理内容が正しくありません。" };
  }
  if ((treatment === "action_source" && !actionContent) || (treatment !== "action_source" && actionContent !== null)) {
    return { ok: false, status: 400, error: "Action化する場合だけ、具体的なActionを入力してください。" };
  }
  return {
    ok: true,
    value: { itemId, originalItemUpdatedAt, originalProjectUpdatedAt, treatment, actionContent },
  };
}

export async function readProjectUpdateInput(request: Request): Promise<ValidationResult<ProjectUpdateInput>> {
  const parsed = await readJson(request);
  if (!parsed.ok) return parsed;
  if (!hasExactKeys(parsed.value, ["id", "title", "outcome", "theme", "targetOn", "originalUpdatedAt"])) {
    return { ok: false, status: 400, error: "入力内容の形式が正しくありません。" };
  }
  const id = positiveInteger(parsed.value.id);
  const title = requiredText(parsed.value.title, MAX_TITLE_CHARS);
  const outcome = requiredText(parsed.value.outcome, MAX_OUTCOME_CHARS);
  const theme = optionalText(parsed.value.theme, MAX_THEME_CHARS);
  const targetOn = optionalDate(parsed.value.targetOn);
  const originalUpdatedAt = timestamp(parsed.value.originalUpdatedAt);
  if (!id) return { ok: false, status: 400, error: "Project IDが正しくありません。" };
  if (!title || !outcome || theme === undefined || targetOn === undefined || !originalUpdatedAt) {
    return { ok: false, status: 400, error: "Projectの編集内容が正しくありません。" };
  }
  return { ok: true, value: { id, title, outcome, theme, targetOn, originalUpdatedAt } };
}

export async function readProjectActionCreateInput(request: Request): Promise<ValidationResult<ProjectActionCreateInput>> {
  const parsed = await readJson(request);
  if (!parsed.ok) return parsed;
  if (!hasExactKeys(parsed.value, ["operation", "projectId", "content", "originalProjectUpdatedAt"])) {
    return { ok: false, status: 400, error: "入力内容の形式が正しくありません。" };
  }
  const projectId = positiveInteger(parsed.value.projectId);
  const content = requiredText(parsed.value.content, MAX_ACTION_CHARS);
  const originalProjectUpdatedAt = timestamp(parsed.value.originalProjectUpdatedAt);
  if ((parsed.value.operation !== "addQueued" && parsed.value.operation !== "resume")
    || !projectId || !content || !originalProjectUpdatedAt) {
    return { ok: false, status: 400, error: "Actionの入力内容が正しくありません。" };
  }
  return {
    ok: true,
    value: { operation: parsed.value.operation, projectId, content, originalProjectUpdatedAt },
  };
}

export async function readProjectActionResolveInput(request: Request): Promise<ValidationResult<ProjectActionResolveInput>> {
  const parsed = await readJson(request);
  if (!parsed.ok) return parsed;
  const keys = ["actionId", "originalUpdatedAt", "resolution", "nextActionId", "nextActionContent", "waitingFor", "reviewOn"];
  if (!hasExactKeys(parsed.value, keys)) return { ok: false, status: 400, error: "入力内容の形式が正しくありません。" };
  const actionId = positiveInteger(parsed.value.actionId);
  const originalUpdatedAt = timestamp(parsed.value.originalUpdatedAt);
  const nextActionId = parsed.value.nextActionId === null ? null : positiveInteger(parsed.value.nextActionId);
  const nextActionContent = optionalText(parsed.value.nextActionContent, MAX_ACTION_CHARS);
  const waitingFor = optionalText(parsed.value.waitingFor, MAX_WAITING_FOR_CHARS);
  const reviewOn = optionalDate(parsed.value.reviewOn);
  const resolution = parsed.value.resolution;
  if (!actionId || !originalUpdatedAt || (resolution !== "continue" && resolution !== "complete"
    && resolution !== "waiting" && resolution !== "on_hold") || nextActionContent === undefined
    || waitingFor === undefined || reviewOn === undefined || (parsed.value.nextActionId !== null && !nextActionId)) {
    return { ok: false, status: 400, error: "Next Actionの完了内容が正しくありません。" };
  }
  if (resolution === "continue" && ((nextActionId === null) === (nextActionContent === null))) {
    return { ok: false, status: 400, error: "次のActionを1件選ぶか入力してください。" };
  }
  if (resolution === "waiting" && (!waitingFor || !reviewOn)) {
    return { ok: false, status: 400, error: "待っている相手・内容と再確認日を入力してください。" };
  }
  if (resolution === "on_hold" && !reviewOn) {
    return { ok: false, status: 400, error: "見直し日を入力してください。" };
  }
  return {
    ok: true,
    value: { actionId, originalUpdatedAt, resolution, nextActionId, nextActionContent, waitingFor, reviewOn },
  };
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
  const functionName = input.operation === "resume" ? "resume_project_with_next_action" : "add_project_queued_action";
  const endpoint = new URL(`/rest/v1/rpc/${functionName}`, connectionInfo.url);
  const response = await supabaseFetch(connectionInfo, endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      p_project_id: input.projectId,
      p_project_updated_at: input.originalProjectUpdatedAt,
      ...(input.operation === "resume" ? { p_next_action: input.content } : { p_content: input.content }),
    }),
  });
  if (!response.ok) throw await projectResponseError(response, functionName);
}

export async function resolveProjectAction(env: DashboardEnv, input: ProjectActionResolveInput): Promise<void> {
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

export function publicProjectError(error: unknown) {
  const code = error instanceof DashboardError ? error.code : "PROJECT_REQUEST_FAILED";
  const status = error instanceof DashboardError ? error.status : 502;
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
    PROJECT_SOURCE_CONFLICT: "元のInboxまたはWantは別の画面で変更されています。再読み込みしてからやり直してください。",
    PROJECT_SOURCE_ALREADY_LINKED: "このInboxまたはWantは、すでに別のProjectへ紐づいています。",
    PROJECT_SOURCE_INVALID: "Projectへ紐づけられない種類のデータです。",
    PROJECT_NOT_OPEN: "完了・見送り済みのProjectには紐づけられません。",
    PROJECT_ITEM_CONFLICT: "この関連アイテムは別の画面で整理されています。再読み込みしてからやり直してください。",
    PROJECT_ITEM_INVALID: "関連アイテムの整理に必要な情報が不足しています。",
    PROJECT_REQUEST_FAILED: "Projectを処理できませんでした。",
  };
  return { code, status, message: messages[code] || messages.PROJECT_REQUEST_FAILED };
}
