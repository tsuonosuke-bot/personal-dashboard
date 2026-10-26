/** Project records, validation primitives and pure row-to-dashboard mapping. */
import type { listScheduledActions } from "./scheduledActions.ts";
import { type TodoSnapshot } from "./projectActionTodos.ts";
import { DashboardError } from "./dashboard.ts";

export const MAX_REQUEST_CHARS = 20_000;

export const MAX_TITLE_CHARS = 240;

export const MAX_OUTCOME_CHARS = 2_000;

export const MAX_THEME_CHARS = 120;

export const MAX_ACTION_CHARS = 500;

export const MAX_WAITING_FOR_CHARS = 240;

/** active Projectがこの日数動かないと「停滞」とみなす（#162）。 */
export const STALE_DAYS = 14;

/** 一括追加で一度に入れられるタスクの数（#161）。 */
export const MAX_BULK_ACTIONS = 50;

export const PROJECT_STATUSES = ["active", "waiting", "on_hold", "completed", "dropped"] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_ACTION_STATUSES = ["next", "queued", "waiting", "done", "cancelled"] as const;

export type ProjectActionStatus = (typeof PROJECT_ACTION_STATUSES)[number];

export const PROJECT_ITEM_TREATMENTS = ["unprocessed", "reference", "action_source", "rejected"] as const;

export type ProjectItemTreatment = (typeof PROJECT_ITEM_TREATMENTS)[number];

export type ProjectSourceType = "inbox" | "want";

export interface ProjectRow {
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

export interface ProjectActionRow {
  id?: unknown;
  project_id?: unknown;
  project_item_id?: unknown;
  milestone_id?: unknown;
  content?: unknown;
  status?: unknown;
  due_on?: unknown;
  start_on?: unknown;
  sort_order?: unknown;
  waiting_for?: unknown;
  completed_at?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
}

export interface ProjectMilestoneRow {
  id?: unknown;
  project_id?: unknown;
  title?: unknown;
  due_on?: unknown;
  sort_order?: unknown;
  status?: unknown;
  completed_at?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
}

export interface ProjectItemRow {
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
  milestoneId: number | null;
  content: string;
  status: ProjectActionStatus;
  dueOn: string | null;
  startOn: string | null;
  sortOrder: number | null;
  waitingFor: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  linkedTodo?: Awaited<ReturnType<typeof listScheduledActions>>["items"][number];
  /** Stored independent dates, restored on unlink; dueOn/startOn above are effective dates. */
  storedDueOn?: string | null;
  storedStartOn?: string | null;
}

export interface ProjectMilestone {
  id: number;
  projectId: number;
  title: string;
  dueOn: string | null;
  sortOrder: number;
  status: "open" | "done";
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** 取り消し以外のタスク数と、そのうち完了した数。 */
  total: number;
  done: number;
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
  milestones: ProjectMilestone[];
  items: ProjectItem[];
  needsAttention: boolean;
  /** Project・Action・マイルストンの更新日時のうち最も新しいもの（#162）。 */
  lastActivityAt: string;
  /** activeなのに STALE_DAYS 日以上動きがない（#162）。 */
  stale: boolean;
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
  | { operation: "resume"; projectId: number; content: string; originalProjectUpdatedAt: string }
  | { operation: "addBulk"; projectId: number; contents: string[]; milestoneId: number | null; originalProjectUpdatedAt: string };

export const PROJECT_MILESTONE_OPERATIONS = ["create", "edit", "complete", "reopen", "move_up", "move_down", "delete"] as const;

export type ProjectMilestoneOperation = (typeof PROJECT_MILESTONE_OPERATIONS)[number];

export interface ProjectMilestoneUpdateInput {
  projectId: number;
  originalProjectUpdatedAt: string;
  milestoneId: number | null;
  originalUpdatedAt: string | null;
  operation: ProjectMilestoneOperation;
  title: string | null;
  dueOn: string | null;
}

export interface ProjectActionResolveInput {
  actionId: number;
  originalUpdatedAt: string;
  resolution: "continue" | "complete" | "waiting" | "on_hold";
  nextActionId: number | null;
  nextActionContent: string | null;
  waitingFor: string | null;
  reviewOn: string | null;
  todo?: TodoSnapshot;
  terminal?: "done" | "cancelled";
}

export const PROJECT_ACTION_OPERATIONS = ["edit", "complete", "cancel", "pin", "move_up", "move_down"] as const;

export type ProjectActionOperation = (typeof PROJECT_ACTION_OPERATIONS)[number];

export interface ProjectActionUpdateInput {
  actionId: number;
  originalUpdatedAt: string;
  operation: ProjectActionOperation;
  /** editのときだけ値を持つ。それ以外の操作ではnull。 */
  content: string | null;
  dueOn: string | null;
  startOn: string | null;
  /** editのときのマイルストン（#161）。nullはマイルストンなし。 */
  milestoneId: number | null;
  todo?: TodoSnapshot;
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; error: string };

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

export function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function timestamp(value: unknown): string | null {
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

export function optionalDate(value: unknown): string | null | undefined {
  if (value === null) return null;
  const parsed = calendarDate(value);
  return parsed || undefined;
}

export function optionalText(value: unknown, max: number): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length > max) return undefined;
  return trimmed || null;
}

export function requiredText(value: unknown, max: number): string | null {
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
  // milestone_id はmigration 202610100001 より前の応答には無いので、欠けていればnullとして扱う。
  const milestoneId = row.milestone_id === undefined || row.milestone_id === null ? null : positiveInteger(row.milestone_id);
  const content = requiredText(row.content, MAX_ACTION_CHARS);
  const dueOn = optionalDate(row.due_on);
  // start_on / sort_order はmigration 202610090001 より前の行・応答には無いので、欠けていればnullとして扱う。
  const startOn = row.start_on === undefined ? null : optionalDate(row.start_on);
  const sortOrder = row.sort_order === undefined || row.sort_order === null ? null
    : Number.isSafeInteger(row.sort_order) ? row.sort_order as number : undefined;
  const waitingFor = optionalText(row.waiting_for, MAX_WAITING_FOR_CHARS);
  const completedAt = row.completed_at === null ? null : timestamp(row.completed_at);
  const createdAt = timestamp(row.created_at);
  const updatedAt = timestamp(row.updated_at);
  if (!id || !projectId || (row.project_item_id !== null && !projectItemId) || !content
    || (row.milestone_id !== undefined && row.milestone_id !== null && !milestoneId)
    || dueOn === undefined || startOn === undefined || sortOrder === undefined
    || waitingFor === undefined || !isActionStatus(row.status)
    || (row.completed_at !== null && !completedAt) || !createdAt || !updatedAt) {
    throw new DashboardError("SUPABASE_RESPONSE_INVALID", "project_actions returned invalid data.");
  }
  if ((row.status === "waiting" && !waitingFor) || (row.status === "done" && !completedAt)) {
    throw new DashboardError("SUPABASE_RESPONSE_INVALID", "project_actions returned inconsistent state.");
  }
  return {
    id, projectId, projectItemId, milestoneId, content, status: row.status, dueOn, startOn, sortOrder, waitingFor, completedAt, createdAt, updatedAt,
  };
}

function normalizeMilestoneRow(row: ProjectMilestoneRow): Omit<ProjectMilestone, "total" | "done"> {
  const id = positiveInteger(row.id);
  const projectId = positiveInteger(row.project_id);
  const title = requiredText(row.title, MAX_TITLE_CHARS);
  const dueOn = optionalDate(row.due_on);
  const completedAt = row.completed_at === null ? null : timestamp(row.completed_at);
  const createdAt = timestamp(row.created_at);
  const updatedAt = timestamp(row.updated_at);
  if (!id || !projectId || !title || dueOn === undefined || !Number.isSafeInteger(row.sort_order)
    || (row.status !== "open" && row.status !== "done") || (row.completed_at !== null && !completedAt)
    || !createdAt || !updatedAt) {
    throw new DashboardError("SUPABASE_RESPONSE_INVALID", "project_milestones returned invalid data.");
  }
  return {
    id, projectId, title, dueOn, sortOrder: row.sort_order as number, status: row.status, completedAt, createdAt, updatedAt,
  };
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

/** あとで行うActionは、画面で並べ替えた順（sort_order昇順、未設定は追加順で末尾）に並べる。 */
function compareQueued(left: ProjectAction, right: ProjectAction): number {
  if (left.sortOrder !== right.sortOrder) {
    if (left.sortOrder === null) return 1;
    if (right.sortOrder === null) return -1;
    return left.sortOrder - right.sortOrder;
  }
  return left.createdAt.localeCompare(right.createdAt) || left.id - right.id;
}

function tokyoDate(value: string | Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(typeof value === "string" ? new Date(value) : value);
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function normalizeProjects(
  projectRows: ProjectRow[],
  actionRows: ProjectActionRow[],
  itemRows: ProjectItemRow[],
  milestoneRows: ProjectMilestoneRow[] = [],
  now = new Date(),
) {
  const today = tokyoDate(now);
  const actions = actionRows.map(normalizeActionRow);
  const items = itemRows.map(normalizeItemRow);
  const milestones = milestoneRows.map(normalizeMilestoneRow);
  const milestonesByProject = new Map<number, ProjectMilestone[]>();
  for (const milestone of milestones) {
    const owned = actions.filter((action) => action.milestoneId === milestone.id && action.status !== "cancelled");
    const current = milestonesByProject.get(milestone.projectId) || [];
    current.push({ ...milestone, total: owned.length, done: owned.filter((action) => action.status === "done").length });
    milestonesByProject.set(milestone.projectId, current);
  }
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
  const milestoneIds = new Map(milestones.map((milestone) => [milestone.id, milestone.projectId]));
  if (actions.some((action) => !knownIds.has(action.projectId)) || items.some((item) => !knownIds.has(item.projectId))
    || milestones.some((milestone) => !knownIds.has(milestone.projectId))
    || actions.some((action) => action.milestoneId !== null && milestoneIds.get(action.milestoneId) !== action.projectId)) {
    throw new DashboardError("SUPABASE_RESPONSE_INVALID", "Project data contains orphan rows.");
  }

  const projects: Project[] = baseProjects.map((project) => {
    const projectActions = (actionsByProject.get(project.id) || []).sort((left, right) =>
      actionOrder[left.status] - actionOrder[right.status]
      || (left.status === "queued" ? compareQueued(left, right) : 0)
      || right.updatedAt.localeCompare(left.updatedAt)
      || right.id - left.id);
    const projectItems = (itemsByProject.get(project.id) || []).sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt) || right.id - left.id);
    const nextActions = projectActions.filter((action) => action.status === "next");
    if (nextActions.length > 1) throw new DashboardError("SUPABASE_RESPONSE_INVALID", "Project has multiple next actions.");
    const nextAction = nextActions[0] || null;
    // activeなのに未完了のActionが1件もないProjectは、次の一手を決める必要がある（#154）。
    const hasOpenAction = projectActions.some((action) => action.status === "next" || action.status === "queued" || action.status === "waiting");
    const needsAttention = (project.status === "active" && !hasOpenAction)
      || projectItems.some((item) => item.treatment === "unprocessed");
    const projectMilestones = (milestonesByProject.get(project.id) || []).sort((left, right) =>
      left.sortOrder - right.sortOrder || left.id - right.id);
    const lastActivityAt = [project.updatedAt, ...projectActions.map((action) => action.updatedAt), ...projectMilestones.map((milestone) => milestone.updatedAt)]
      .reduce((latest, value) => (Date.parse(value) > Date.parse(latest) ? value : latest));
    const stale = project.status === "active" && daysBetween(tokyoDate(lastActivityAt), today) >= STALE_DAYS;
    return {
      ...project, nextAction, actions: projectActions, milestones: projectMilestones, items: projectItems, needsAttention, lastActivityAt, stale,
    };
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
      stale: projects.filter((project) => project.stale).length,
      waiting: projects.filter((project) => project.status === "waiting" || project.status === "on_hold").length,
      completed: projects.filter((project) => project.status === "completed").length,
      openActions: actions.filter((action) => ["next", "queued", "waiting"].includes(action.status)).length,
      unprocessedItems: items.filter((item) => item.treatment === "unprocessed").length,
    },
  };
}
