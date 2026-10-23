import { DashboardError, type DashboardEnv } from "./dashboard.ts";
import { connection, isPlainObject, supabaseFetch } from "./wantRouting.ts";

export const INBOX_SF6_RESOURCES = ["situations", "sequences", "drills"] as const;
type Resource = typeof INBOX_SF6_RESOURCES[number];
const targetColumns = { situations: "situation_id", sequences: "sequence_id", drills: "drill_id" } as const;

export function sf6Target(row: Record<string, unknown>) {
  const resource = row.resource as Resource;
  if (!INBOX_SF6_RESOURCES.includes(resource) || !Number.isSafeInteger(row.target_id_snapshot)) {
    throw new DashboardError("SUPABASE_RESPONSE_INVALID", "Invalid Inbox SF6 relation.");
  }
  const id = Number(row.target_id_snapshot);
  return { resource, id, url: `/sf6/?resource=${resource}&id=${id}`, deleted: row[targetColumns[resource]] === null };
}

/** This small authenticated read also works after either FK is set null on deletion. */
export async function loadInboxSf6Source(env: DashboardEnv, query: { inboxId: number } | { resource: Resource; targetId: number }) {
  const info = connection(env);
  const read = async (table: string, params: Record<string, string>) => {
    const url = new URL(`/rest/v1/${table}`, info.url);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
    const response = await supabaseFetch(info, url);
    if (!response.ok) throw new DashboardError("SUPABASE_REQUEST_FAILED", `Could not read ${table}.`);
    const rows: unknown = await response.json();
    if (!Array.isArray(rows) || rows.some((row) => !isPlainObject(row))) throw new DashboardError("SUPABASE_RESPONSE_INVALID", `Invalid ${table}.`);
    return rows as Record<string, unknown>[];
  };
  const routes = await read("inbox_sf6_routes", {
    select: "inbox_id,source_inbox_id_snapshot,resource,situation_id,sequence_id,drill_id,target_id_snapshot,source_content,source_result",
    ...("inboxId" in query ? { source_inbox_id_snapshot: `eq.${query.inboxId}` } : { resource: `eq.${query.resource}`, target_id_snapshot: `eq.${query.targetId}` }),
    limit: "1",
  });
  const route = routes[0];
  const inboxId = "inboxId" in query ? query.inboxId : route?.source_inbox_id_snapshot;
  if (!inboxId) return { inbox: null, sf6: null };
  const inboxes = await read("idea_inbox", { id: `eq.${inboxId}`, select: "id,content,status,result", limit: "1" });
  const inbox = inboxes[0];
  if (!inbox && !route) throw new DashboardError("INBOX_NOT_FOUND", "Inbox not found.", 404);
  return {
    inbox: inbox || { id: inboxId, content: route.source_content, result: route.source_result, status: "deleted" },
    sf6: route ? sf6Target(route) : null,
  };
}
