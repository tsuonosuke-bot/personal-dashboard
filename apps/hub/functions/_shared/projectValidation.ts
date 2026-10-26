/** Same-origin mutation request validation; no database or external-service calls. */
import { MAX_REQUEST_CHARS, type ValidationResult, isPlainObject, type ProjectCreateInput, hasExactKeys, requiredText, MAX_TITLE_CHARS, MAX_OUTCOME_CHARS, optionalText, MAX_THEME_CHARS, optionalDate, MAX_ACTION_CHARS, type ProjectSourceSnapshot, positiveInteger, type ProjectSourceRouteInput, timestamp, type ProjectItemProcessInput, type ProjectUpdateInput, type ProjectActionCreateInput, MAX_BULK_ACTIONS, type ProjectMilestoneUpdateInput, PROJECT_MILESTONE_OPERATIONS, type ProjectMilestoneOperation, type ProjectActionResolveInput, MAX_WAITING_FOR_CHARS, type ProjectActionUpdateInput, PROJECT_ACTION_OPERATIONS, type ProjectActionOperation } from "./projectModel.ts";
import { validTodoSnapshot, type TodoSnapshot } from "./projectActionTodos.ts";

export function validateProjectMutationRequest(
  request: Request,
  expectedHeader:
    | "project-create" | "project-update" | "project-action-create" | "project-action-resolve" | "project-action-update"
    | "project-milestone-update"
    | "project-source-route" | "project-item-process" | "project-todo-link",
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
  if (parsed.value.operation === "addBulk") return readBulkActions(parsed.value);
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

/** 改行区切りで貼り付けた複数のタスク（#161）。空行は除き、1行ずつ1件にする。 */
function readBulkActions(value: Record<string, unknown>): ValidationResult<ProjectActionCreateInput> {
  if (!hasExactKeys(value, ["operation", "projectId", "contents", "milestoneId", "originalProjectUpdatedAt"])) {
    return { ok: false, status: 400, error: "入力内容の形式が正しくありません。" };
  }
  const projectId = positiveInteger(value.projectId);
  const originalProjectUpdatedAt = timestamp(value.originalProjectUpdatedAt);
  const milestoneId = value.milestoneId === null ? null : positiveInteger(value.milestoneId);
  if (!projectId || !originalProjectUpdatedAt || (value.milestoneId !== null && !milestoneId)
    || !Array.isArray(value.contents) || value.contents.some((line) => typeof line !== "string")) {
    return { ok: false, status: 400, error: "まとめて追加する内容が正しくありません。" };
  }
  const contents = (value.contents as string[]).map((line) => line.trim()).filter(Boolean);
  if (!contents.length) return { ok: false, status: 400, error: "追加するタスクを1行以上入力してください。" };
  if (contents.length > MAX_BULK_ACTIONS) {
    return { ok: false, status: 400, error: `一度に追加できるのは${MAX_BULK_ACTIONS}件までです。` };
  }
  if (contents.some((line) => line.length > MAX_ACTION_CHARS)) {
    return { ok: false, status: 400, error: `タスクは1行${MAX_ACTION_CHARS}文字以内で入力してください。` };
  }
  return { ok: true, value: { operation: "addBulk", projectId, contents, milestoneId, originalProjectUpdatedAt } };
}

export async function readProjectMilestoneUpdateInput(request: Request): Promise<ValidationResult<ProjectMilestoneUpdateInput>> {
  const parsed = await readJson(request);
  if (!parsed.ok) return parsed;
  const keys = ["projectId", "originalProjectUpdatedAt", "milestoneId", "originalUpdatedAt", "operation", "title", "dueOn"];
  if (!hasExactKeys(parsed.value, keys)) return { ok: false, status: 400, error: "入力内容の形式が正しくありません。" };
  const { value } = parsed;
  const projectId = positiveInteger(value.projectId);
  const originalProjectUpdatedAt = timestamp(value.originalProjectUpdatedAt);
  const operation = value.operation;
  if (!projectId || !originalProjectUpdatedAt || typeof operation !== "string"
    || !(PROJECT_MILESTONE_OPERATIONS as readonly string[]).includes(operation)) {
    return { ok: false, status: 400, error: "マイルストンの操作内容が正しくありません。" };
  }
  const creating = operation === "create";
  const milestoneId = value.milestoneId === null ? null : positiveInteger(value.milestoneId);
  const originalUpdatedAt = value.originalUpdatedAt === null ? null : timestamp(value.originalUpdatedAt);
  if (creating ? (value.milestoneId !== null || value.originalUpdatedAt !== null) : (!milestoneId || !originalUpdatedAt)) {
    return { ok: false, status: 400, error: "対象のマイルストンが正しくありません。" };
  }
  if (operation !== "create" && operation !== "edit") {
    if (value.title !== null || value.dueOn !== null) {
      return { ok: false, status: 400, error: "名前と期日は作成・編集するときだけ送信してください。" };
    }
    return {
      ok: true,
      value: { projectId, originalProjectUpdatedAt, milestoneId, originalUpdatedAt, operation: operation as ProjectMilestoneOperation, title: null, dueOn: null },
    };
  }
  const title = requiredText(value.title, MAX_TITLE_CHARS);
  const dueOn = optionalDate(value.dueOn);
  if (!title) return { ok: false, status: 400, error: `マイルストン名は1〜${MAX_TITLE_CHARS}文字で入力してください。` };
  if (dueOn === undefined) return { ok: false, status: 400, error: "期日はYYYY-MM-DD形式で入力してください。" };
  return { ok: true, value: { projectId, originalProjectUpdatedAt, milestoneId, originalUpdatedAt, operation, title, dueOn } };
}

export async function readProjectActionResolveInput(request: Request): Promise<ValidationResult<ProjectActionResolveInput>> {
  const parsed = await readJson(request);
  if (!parsed.ok) return parsed;
  const keys = ["actionId", "originalUpdatedAt", "resolution", "nextActionId", "nextActionContent", "waitingFor", "reviewOn"];
  const optionalKeys = ["todo", "terminal"].filter((key) => key in parsed.value);
  if (!hasExactKeys(parsed.value, [...keys, ...optionalKeys])
    || (parsed.value.todo !== undefined && !validTodoSnapshot(parsed.value.todo))
    || (parsed.value.terminal !== undefined && parsed.value.terminal !== "done" && parsed.value.terminal !== "cancelled")) return { ok: false, status: 400, error: "入力内容の形式が正しくありません。" };
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
    value: { actionId, originalUpdatedAt, resolution, nextActionId, nextActionContent, waitingFor, reviewOn,
      ...(parsed.value.todo ? { todo: parsed.value.todo as TodoSnapshot } : {}),
      ...(parsed.value.terminal ? { terminal: parsed.value.terminal as "done" | "cancelled" } : {}) },
  };
}

export async function readProjectActionUpdateInput(request: Request): Promise<ValidationResult<ProjectActionUpdateInput>> {
  const parsed = await readJson(request);
  if (!parsed.ok) return parsed;
  // milestoneId は編集のときに送る（#161）。Hubなどの完了操作は送らない。
  const keys = ["actionId", "originalUpdatedAt", "operation", "content", "dueOn", "startOn"];
  const extraKeys = ["milestoneId", "todo"].filter((key) => key in parsed.value);
  if (!hasExactKeys(parsed.value, [...keys, ...extraKeys]) || (parsed.value.todo !== undefined && !validTodoSnapshot(parsed.value.todo))) {
    return { ok: false, status: 400, error: "入力内容の形式が正しくありません。" };
  }
  const actionId = positiveInteger(parsed.value.actionId);
  const originalUpdatedAt = timestamp(parsed.value.originalUpdatedAt);
  const operation = parsed.value.operation;
  if (!actionId || !originalUpdatedAt || typeof operation !== "string"
    || !(PROJECT_ACTION_OPERATIONS as readonly string[]).includes(operation)) {
    return { ok: false, status: 400, error: "Actionの操作内容が正しくありません。" };
  }
  if (operation !== "edit") {
    if (parsed.value.content !== null || parsed.value.dueOn !== null || parsed.value.startOn !== null
      || (parsed.value.milestoneId !== undefined && parsed.value.milestoneId !== null)) {
      return { ok: false, status: 400, error: "内容と日付は編集するときだけ送信してください。" };
    }
    return {
      ok: true,
      value: {
        actionId, originalUpdatedAt, operation: operation as ProjectActionOperation, content: null, dueOn: null, startOn: null, milestoneId: null,
        ...(parsed.value.todo ? { todo: parsed.value.todo as TodoSnapshot } : {}),
      },
    };
  }
  if (!("milestoneId" in parsed.value)) {
    return { ok: false, status: 400, error: "編集するときはマイルストンも送信してください。" };
  }
  const milestoneId = parsed.value.milestoneId === null ? null : positiveInteger(parsed.value.milestoneId);
  if (parsed.value.milestoneId !== null && !milestoneId) {
    return { ok: false, status: 400, error: "マイルストンの指定が正しくありません。" };
  }
  const content = requiredText(parsed.value.content, MAX_ACTION_CHARS);
  const dueOn = optionalDate(parsed.value.dueOn);
  const startOn = optionalDate(parsed.value.startOn);
  if (!content) return { ok: false, status: 400, error: `Actionは1〜${MAX_ACTION_CHARS}文字で入力してください。` };
  if (dueOn === undefined || startOn === undefined) {
    return { ok: false, status: 400, error: "期日と着手日はYYYY-MM-DD形式で入力してください。" };
  }
  if (dueOn && startOn && startOn > dueOn) {
    return { ok: false, status: 400, error: "着手日は期日より前の日付にしてください。" };
  }
  return { ok: true, value: { actionId, originalUpdatedAt, operation: "edit", content, dueOn, startOn, milestoneId,
    ...(parsed.value.todo ? { todo: parsed.value.todo as TodoSnapshot } : {}) } };
}
