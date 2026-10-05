export type OrganizeTab = "questions" | "insights" | "tags";

export type DashboardRoute =
  | { kind: "dashboard" }
  | { kind: "quiz"; mode: "custom" | "daily" }
  | { kind: "speaking" }
  | { kind: "log" }
  | { kind: "search" }
  | { kind: "organize"; tab: OrganizeTab; questionId: number | null }
  | { kind: "knowledge"; knowledgeId: string }
  | { kind: "invalid-knowledge" };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function asUrl(value: string | URL): URL {
  return value instanceof URL ? new URL(value.toString()) : new URL(value, "https://knowledge.invalid");
}

export function isKnowledgeId(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export function parseDashboardRoute(value: string | URL): DashboardRoute {
  const url = asUrl(value);
  if (url.searchParams.get("view") === "quiz") {
    return { kind: "quiz", mode: url.searchParams.get("mode") === "daily" ? "daily" : "custom" };
  }
  if (url.searchParams.get("view") === "speaking") return { kind: "speaking" };
  if (url.searchParams.get("view") === "log") return { kind: "log" };
  if (url.searchParams.get("view") === "search") return { kind: "search" };
  const view = url.searchParams.get("view");
  // 旧URL（view=insights / view=tags）は統合した「整理」ページの該当タブで開く。
  if (view === "insights") return { kind: "organize", tab: "questions", questionId: null };
  if (view === "tags") return { kind: "organize", tab: "tags", questionId: null };
  if (view === "organize") {
    const tab = url.searchParams.get("tab");
    const question = url.searchParams.get("question") ?? "";
    return {
      kind: "organize",
      tab: tab === "insights" || tab === "tags" ? tab : "questions",
      questionId: /^[1-9]\d{0,15}$/.test(question) ? Number(question) : null,
    };
  }
  const knowledgeId = url.searchParams.get("knowledge");
  if (knowledgeId === null) return { kind: "dashboard" };
  return isKnowledgeId(knowledgeId)
    ? { kind: "knowledge", knowledgeId }
    : { kind: "invalid-knowledge" };
}

export function dashboardRoutePath(value: string | URL, route: DashboardRoute): string {
  const url = asUrl(value);
  url.searchParams.delete("view");
  url.searchParams.delete("mode");
  url.searchParams.delete("knowledge");
  url.searchParams.delete("tab");
  url.searchParams.delete("question");
  if (route.kind === "quiz") {
    url.searchParams.set("view", "quiz");
    if (route.mode === "daily") url.searchParams.set("mode", "daily");
  }
  if (route.kind === "speaking") url.searchParams.set("view", "speaking");
  if (route.kind === "log") url.searchParams.set("view", "log");
  if (route.kind === "search") url.searchParams.set("view", "search");
  if (route.kind === "organize") {
    url.searchParams.set("view", "organize");
    if (route.tab !== "questions") url.searchParams.set("tab", route.tab);
    if (route.questionId !== null) url.searchParams.set("question", String(route.questionId));
  }
  if (route.kind === "knowledge") url.searchParams.set("knowledge", route.knowledgeId);
  return `${url.pathname}${url.search}${url.hash}`;
}
