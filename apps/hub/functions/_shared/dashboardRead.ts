import { fetchSupabase } from "@personal-dashboards/auth";
import { DashboardError, type DashboardEnv, normalizeDashboard } from "./dashboard.ts";

export interface IdeaReadQuery {
  view: "inbox" | "wants" | "summary";
  status: string;
  search: string;
  filter: string;
  category: string;
  offset: number;
  limit: number;
  id: number | null;
  routeOffset: number;
}
export function readIdeaQuery(url: URL): IdeaReadQuery | null {
  const p = url.searchParams;
  const view = p.get("view") ?? "inbox";
  const query = {
    view,
    status: p.get("status") ?? (view === "inbox" ? "pending" : "active"),
    search: (p.get("q") ?? "").trim(),
    filter: p.get("filter") ?? "",
    category: p.get("category") ?? "",
    offset: Number(p.get("offset") ?? 0),
    limit: Number(p.get("limit") ?? 50),
    id: p.has("id") ? Number(p.get("id")) : null,
    routeOffset: Number(p.get("routeOffset") ?? 0),
  };
  if (
    !["inbox", "wants", "summary"].includes(view) ||
    query.status.length > 40 ||
    query.search.length > 500 ||
    !["", "knowledge", "github", "untriaged"].includes(query.filter) ||
    !["", "place", "watch", "play", "read", "do", "wish", "other"].includes(query.category) ||
    [query.offset, query.routeOffset].some((n) => !Number.isSafeInteger(n) || n < 0) ||
    !Number.isSafeInteger(query.limit) ||
    query.limit < 1 ||
    query.limit > 100 ||
    (query.id !== null && (!Number.isSafeInteger(query.id) || query.id <= 0))
  )
    return null;
  return query as IdeaReadQuery;
}
export async function loadIdeaReadModel(env: DashboardEnv, query: IdeaReadQuery) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY)
    throw new DashboardError("SUPABASE_NOT_CONFIGURED", "Supabase is not configured.", 503);
  const endpoint = new URL("/rest/v1/rpc/get_idea_read_model", env.SUPABASE_URL);
  if (endpoint.protocol !== "https:")
    throw new DashboardError("SUPABASE_CONFIG_INVALID", "Invalid Supabase URL.", 503);
  const response = await fetchSupabase(
    endpoint,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        apikey: env.SUPABASE_SECRET_KEY,
      },
      body: JSON.stringify({
        p_view: query.view,
        p_status: query.status,
        p_search: query.search.trim(),
        p_filter: query.filter,
        p_category: query.category,
        p_offset: query.offset,
        p_limit: query.limit,
        p_id: query.id,
        p_route_offset: query.routeOffset,
        p_today: new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10),
      }),
    },
    { retryTransientAuth: true },
  );
  if (!response.ok)
    throw new DashboardError(
      response.status === 401 || response.status === 403
        ? "SUPABASE_ACCESS_DENIED"
        : "SUPABASE_REQUEST_FAILED",
      "Idea read failed.",
    );
  const data = (await response.json()) as {
    inbox: Parameters<typeof normalizeDashboard>[0];
    wants: Parameters<typeof normalizeDashboard>[1];
    routes: Parameters<typeof normalizeDashboard>[3];
    summary: ReturnType<typeof normalizeDashboard>["summary"];
    page: Record<string, unknown>;
    routePage: Record<string, unknown>;
    statuses: string[];
  };
  if (
    !data ||
    ![data.inbox, data.wants, data.routes].every(Array.isArray) ||
    !data.summary ||
    !data.page ||
    !data.routePage ||
    !Array.isArray(data.statuses)
  )
    throw new DashboardError("SUPABASE_RESPONSE_INVALID", "Invalid Idea read model.");
  const model = normalizeDashboard(data.inbox, data.wants, env, data.routes);
  return {
    ...model,
    summary: data.summary,
    page: data.page,
    statuses: data.statuses,
    wants: model.wants.map((want) => ({
      ...want,
      detailLoaded: query.id !== null,
      routePage: query.id !== null ? data.routePage : null,
    })),
  };
}
