/** Projects only own the relationship. Habit definitions and logs stay in Habits. */
import { fetchSupabase } from "@personal-dashboards/auth";
import { DashboardError, type DashboardEnv } from "./dashboard.ts";
import { loadHabits } from "./habits.ts";
import { supabaseHeaders } from "./supabaseAuth.ts";

const PAGE_SIZE = 1_000;
const MAX_REQUEST_CHARS = 8_000;
type Validation<T> = { ok: true; value: T } | { ok: false; status: number; error: string };
export interface ProjectHabitInput {
  projectId: number;
  projectUpdatedAt: string;
  habitId: number;
  habitUpdatedAt: string;
  relationUpdatedAt: string | null;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function id(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
function timestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

export function readProjectHabitQuery(request: Request): Validation<number> {
  const query = new URL(request.url).searchParams;
  const raw = query.get("projectId");
  if (
    [...query.keys()].some((key) => key !== "projectId") ||
    query.getAll("projectId").length !== 1 ||
    raw === null ||
    !/^[1-9]\d*$/.test(raw) ||
    !id(Number(raw))
  ) {
    return { ok: false, status: 400, error: "目標を指定してください。" };
  }
  return { ok: true, value: Number(raw) };
}

export function validateProjectHabitRequest(
  request: Request,
): { status: number; error: string } | null {
  if (request.headers.get("Origin") !== new URL(request.url).origin)
    return { status: 403, error: "許可されていない送信元です。" };
  if (request.headers.get("X-Dashboard-Action") !== "project-habit-link")
    return { status: 403, error: "更新用ヘッダーがありません。" };
  if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json"))
    return { status: 415, error: "JSON形式で送信してください。" };
  if (Number(request.headers.get("Content-Length") || "0") > MAX_REQUEST_CHARS)
    return { status: 413, error: "リクエストが大きすぎます。" };
  return null;
}

export async function readProjectHabitInput(
  request: Request,
): Promise<Validation<ProjectHabitInput>> {
  let value: unknown;
  try {
    const raw = await request.text();
    if (raw.length > MAX_REQUEST_CHARS)
      return { ok: false, status: 413, error: "リクエストが大きすぎます。" };
    value = JSON.parse(raw);
  } catch {
    return { ok: false, status: 400, error: "入力内容を読み取れませんでした。" };
  }
  if (
    !record(value) ||
    Object.keys(value).length !== 5 ||
    Object.keys(value).some(
      (key) =>
        ![
          "projectId",
          "projectUpdatedAt",
          "habitId",
          "habitUpdatedAt",
          "relationUpdatedAt",
        ].includes(key),
    ) ||
    !id(value.projectId) ||
    !id(value.habitId) ||
    !timestamp(value.projectUpdatedAt) ||
    !timestamp(value.habitUpdatedAt) ||
    (value.relationUpdatedAt !== null && !timestamp(value.relationUpdatedAt))
  ) {
    return {
      ok: false,
      status: 400,
      error: "関連づけの内容が正しくありません。再読込してください。",
    };
  }
  // Preserve PostgreSQL's fractional-second precision for optimistic locking.
  return { ok: true, value: value as unknown as ProjectHabitInput };
}

function connection(env: DashboardEnv) {
  const key = env.SUPABASE_SECRET_KEY?.trim();
  if (!key || !env.SUPABASE_URL?.trim())
    throw new DashboardError("SUPABASE_NOT_CONFIGURED", "Supabase is not configured.", 503);
  let url: URL;
  try {
    url = new URL(env.SUPABASE_URL.trim());
  } catch {
    throw new DashboardError("SUPABASE_CONFIG_INVALID", "SUPABASE_URL is invalid.", 503);
  }
  if (url.protocol !== "https:")
    throw new DashboardError("SUPABASE_CONFIG_INVALID", "SUPABASE_URL must use HTTPS.", 503);
  return { key, url };
}

async function requestDatabase(
  env: DashboardEnv,
  path: string,
  query?: (url: URL) => void,
  body?: unknown,
) {
  const info = connection(env);
  const endpoint = new URL(`/rest/v1/${path}`, info.url);
  query?.(endpoint);
  let response: Response;
  try {
    response = await fetchSupabase(
      endpoint,
      {
        headers: supabaseHeaders(
          info.key,
          body === undefined ? {} : { "Content-Type": "application/json" },
        ),
        ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }),
      },
      { retryTransientAuth: body === undefined },
    );
  } catch {
    throw new DashboardError("SUPABASE_UNAVAILABLE", "Could not reach habit links.");
  }
  if (!response.ok) {
    const detail = await response.text();
    const conflict = [
      "PROJECT_HABIT_CONFLICT",
      "PROJECT_CONFLICT",
      "HABIT_CONFLICT",
      "PROJECT_NOT_OPEN",
    ].find((marker) => detail.includes(marker));
    if (conflict)
      throw new DashboardError(
        conflict,
        "目標または習慣が変更されました。再読込してください。",
        409,
      );
    throw new DashboardError(
      response.status === 401 || response.status === 403
        ? "SUPABASE_ACCESS_DENIED"
        : "SUPABASE_REQUEST_FAILED",
      "Could not load habit links.",
    );
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new DashboardError("SUPABASE_RESPONSE_INVALID", "Habit links returned invalid data.");
  }
  return data;
}

async function projectSnapshot(env: DashboardEnv, projectId: number) {
  const rows = await requestDatabase(env, "projects", (url) => {
    url.searchParams.set("select", "id,updated_at,status");
    url.searchParams.set("id", `eq.${projectId}`);
    url.searchParams.set("limit", "2");
  });
  if (!Array.isArray(rows))
    throw new DashboardError("SUPABASE_RESPONSE_INVALID", "Project returned invalid data.");
  if (!rows.length) throw new DashboardError("PROJECT_NOT_FOUND", "Project was not found.", 404);
  if (
    rows.length !== 1 ||
    !record(rows[0]) ||
    rows[0].id !== projectId ||
    !timestamp(rows[0].updated_at) ||
    typeof rows[0].status !== "string" ||
    !["active", "waiting", "on_hold", "completed", "dropped"].includes(rows[0].status)
  ) {
    throw new DashboardError("SUPABASE_RESPONSE_INVALID", "Project returned invalid data.");
  }
  return { updatedAt: rows[0].updated_at, status: rows[0].status };
}

async function linksForProject(env: DashboardEnv, projectId: number) {
  const links: Array<{ habitId: number; linkedAt: string; linked: boolean; updatedAt: string }> =
    [];
  const seen = new Set<number>();
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const rows = await requestDatabase(env, "project_habits", (url) => {
      url.searchParams.set("select", "project_id,habit_id,linked,created_at,updated_at");
      url.searchParams.set("project_id", `eq.${projectId}`);
      url.searchParams.set("order", "created_at.asc,habit_id.asc");
      url.searchParams.set("limit", String(PAGE_SIZE));
      url.searchParams.set("offset", String(offset));
    });
    if (!Array.isArray(rows))
      throw new DashboardError("SUPABASE_RESPONSE_INVALID", "Habit links returned invalid data.");
    for (const row of rows) {
      if (
        !record(row) ||
        row.project_id !== projectId ||
        !id(row.habit_id) ||
        !timestamp(row.created_at) ||
        typeof row.linked !== "boolean" ||
        !timestamp(row.updated_at) ||
        seen.has(row.habit_id)
      ) {
        throw new DashboardError("SUPABASE_RESPONSE_INVALID", "Habit link is invalid.");
      }
      seen.add(row.habit_id);
      links.push({
        habitId: row.habit_id,
        linkedAt: row.created_at,
        linked: row.linked,
        updatedAt: row.updated_at,
      });
    }
    if (rows.length < PAGE_SIZE) return links;
  }
}

export async function loadProjectHabits(env: DashboardEnv, projectId: number, now = new Date()) {
  const [project, links, overview] = await Promise.all([
    projectSnapshot(env, projectId),
    linksForProject(env, projectId),
    loadHabits(env, now),
  ]);
  const habits = new Map(overview.habits.map((habit) => [habit.id, habit]));
  return {
    projectId,
    projectUpdatedAt: project.updatedAt,
    projectStatus: project.status,
    source: overview.source,
    today: overview.today,
    weekStart: overview.weekStart,
    links: links
      .filter((link) => link.linked)
      .map((link) => ({
        ...link,
        state: habits.has(link.habitId) ? ("available" as const) : ("missing" as const),
        habit: habits.get(link.habitId) ?? null,
      })),
    relations: links.map(({ habitId, linked, updatedAt }) => ({ habitId, linked, updatedAt })),
    habits: overview.habits,
  };
}

export async function mutateProjectHabit(
  env: DashboardEnv,
  input: ProjectHabitInput,
  linked: boolean,
) {
  const result = await requestDatabase(
    env,
    `rpc/${linked ? "link_project_habit" : "unlink_project_habit"}`,
    undefined,
    { p_request: input },
  );
  if (result !== input.projectId)
    throw new DashboardError("SUPABASE_RESPONSE_INVALID", "Habit link returned invalid data.");
  return { projectId: input.projectId, habitId: input.habitId, linked };
}
