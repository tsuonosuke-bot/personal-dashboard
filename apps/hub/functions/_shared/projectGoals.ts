import { fetchSupabase } from "@personal-dashboards/auth";
import { DashboardError, type DashboardEnv } from "./dashboard.ts";
import {
  isPlainObject,
  positiveInteger,
  timestamp,
  requiredText,
  hasExactKeys,
} from "./projectModel.ts";

export interface ProjectGoalStatus {
  projectId: number;
  projectUpdatedAt: string;
  fingerprint: string;
  lastReviewedAt: string | null;
  reviewCurrent: boolean;
  weekDone: number;
  nextMilestone: { id: number; title: string; dueOn: string | null } | null;
}
export type ProjectGoalInput = {
  operation: "capture" | "review";
  requestId: string;
  projectId: number;
  projectUpdatedAt: string;
  content?: string;
  fingerprint?: string;
};

async function rpc(env: DashboardEnv, name: string, body: unknown) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY)
    throw new DashboardError("SUPABASE_NOT_CONFIGURED", "データ接続が設定されていません。", 503);
  const endpoint = new URL(`/rest/v1/rpc/${name}`, env.SUPABASE_URL);
  if (endpoint.protocol !== "https:")
    throw new DashboardError("SUPABASE_CONFIG_INVALID", "データ接続が正しくありません。", 503);
  const response = await fetchSupabase(
    endpoint,
    {
      method: "POST",
      headers: { apikey: env.SUPABASE_SECRET_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    { retryTransientAuth: name === "get_project_goal_status" },
  );
  if (!response.ok) {
    const detail = await response.text();
    const conflictCode = detail.match(
      /GOAL_REQUEST_CONFLICT|GOAL_REVIEW_CONFLICT|PROJECT_CONFLICT|PROJECT_NOT_OPEN|PROJECT_NOT_ACTIVE/,
    )?.[0];
    const conflict = !!conflictCode;
    throw new DashboardError(
      conflictCode || "GOAL_SAVE_FAILED",
      conflict
        ? "内容が変更されています。最新状態を確認してからもう一度操作してください。"
        : "データを取得・保存できませんでした。入力を残して再試行してください。",
      conflict ? 409 : 502,
    );
  }
  return response.json() as Promise<unknown>;
}

export function readProjectGoalInput(value: unknown): ProjectGoalInput | null {
  if (!isPlainObject(value) || !["capture", "review"].includes(String(value.operation)))
    return null;
  const operation = value.operation as ProjectGoalInput["operation"];
  if (
    !hasExactKeys(value, [
      "operation",
      "requestId",
      "projectId",
      "projectUpdatedAt",
      operation === "capture" ? "content" : "fingerprint",
    ]) ||
    typeof value.requestId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value.requestId,
    ) ||
    !positiveInteger(value.projectId) ||
    !timestamp(value.projectUpdatedAt)
  )
    return null;
  if (operation === "capture" && !requiredText(value.content, 500)) return null;
  if (
    operation === "review" &&
    (typeof value.fingerprint !== "string" || !/^[0-9a-f]{32}$/.test(value.fingerprint))
  )
    return null;
  return {
    operation,
    requestId: value.requestId,
    projectId: Number(value.projectId),
    projectUpdatedAt: String(value.projectUpdatedAt),
    ...(operation === "capture"
      ? { content: String(value.content).trim() }
      : { fingerprint: String(value.fingerprint) }),
  };
}

export async function loadProjectGoalStatus(
  env: DashboardEnv,
  ids: number[],
  now = new Date(),
): Promise<ProjectGoalStatus[]> {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(now);
  const rows = await rpc(env, "get_project_goal_status", { p_project_ids: ids, p_today: today });
  if (
    !Array.isArray(rows) ||
    rows.some(
      (row) =>
        !isPlainObject(row) ||
        !ids.includes(Number(row.projectId)) ||
        !positiveInteger(row.projectId) ||
        !timestamp(row.projectUpdatedAt) ||
        typeof row.fingerprint !== "string" ||
        !/^[0-9a-f]{32}$/.test(row.fingerprint) ||
        typeof row.reviewCurrent !== "boolean" ||
        !Number.isSafeInteger(row.weekDone) ||
        Number(row.weekDone) < 0 ||
        (row.lastReviewedAt !== null && !timestamp(row.lastReviewedAt)) ||
        (row.nextMilestone !== null &&
          (!isPlainObject(row.nextMilestone) ||
            !positiveInteger(row.nextMilestone.id) ||
            !requiredText(row.nextMilestone.title, 240))),
    )
  ) {
    throw new DashboardError(
      "GOAL_RESPONSE_INVALID",
      "目標の確認情報を読み取れませんでした。",
      502,
    );
  }
  return rows as ProjectGoalStatus[];
}

export async function saveProjectGoal(env: DashboardEnv, input: ProjectGoalInput) {
  const { operation, ...request } = input;
  const result = await rpc(
    env,
    operation === "capture" ? "capture_project_action" : "record_project_review",
    { p_request: request },
  );
  if (!isPlainObject(result) || result.saved !== true || result.projectId !== input.projectId)
    throw new DashboardError(
      "GOAL_RESPONSE_INVALID",
      "保存結果を確認できませんでした。同じ操作を確認して再試行してください。",
      502,
    );
  return result;
}
