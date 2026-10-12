import { publicError, type DashboardEnv } from "../../_shared/dashboard.ts";
import {
  createSf6Item,
  deleteSf6Item,
  isLegacySf6Resource,
  isReadOnlySf6Resource,
  isSf6Resource,
  readSf6CreateInput,
  readSf6DeleteInput,
  readSf6UpdateInput,
  SF6_STALE_MESSAGE,
  updateSf6Item,
  validateSf6MutationRequest,
} from "../../_shared/sf6.ts";

interface FunctionContext {
  request: Request;
  env: DashboardEnv;
  params: { resource?: string | string[] };
}

const headers = { "Cache-Control": "private, no-store", "Content-Type": "application/json; charset=utf-8" };

// POST = 追加、PATCH = 編集（全項目＋updatedAt）、DELETE = 削除（{ id }）。
// sequences（手順）は始動の状況・結果も一緒に保存し、{ item, situations } を返す。
export const onRequest = async (context: FunctionContext): Promise<Response> => {
  const resource = context.params.resource;
  // 廃止したリソース（コンボ・起き攻めの旧表、注意点）。古い画面からの保存に理由を出す
  if (isLegacySf6Resource(resource)) return Response.json({ error: SF6_STALE_MESSAGE }, { status: 404, headers });
  if (!isSf6Resource(resource) || isReadOnlySf6Resource(resource)) return Response.json({ error: "見つかりませんでした。" }, { status: 404, headers });
  const method = context.request.method;
  if (method !== "POST" && method !== "PATCH" && method !== "DELETE") {
    return new Response("Method Not Allowed\n", { status: 405, headers: { Allow: "POST, PATCH, DELETE" } });
  }
  const guard = validateSf6MutationRequest(context.request);
  if (guard) return Response.json({ error: guard.error }, { status: guard.status, headers });
  try {
    if (method === "POST") {
      const input = await readSf6CreateInput(context.request, resource);
      if (!input.ok) return Response.json({ error: input.error }, { status: input.status, headers });
      return Response.json(await createSf6Item(context.env, resource, input.value), { status: 201, headers });
    }
    if (method === "PATCH") {
      const input = await readSf6UpdateInput(context.request, resource);
      if (!input.ok) return Response.json({ error: input.error }, { status: input.status, headers });
      return Response.json(await updateSf6Item(context.env, resource, input.value), { headers });
    }
    const input = await readSf6DeleteInput(context.request);
    if (!input.ok) return Response.json({ error: input.error }, { status: input.status, headers });
    return Response.json(await deleteSf6Item(context.env, resource, input.value), { headers });
  } catch (error) {
    const failure = publicError(error);
    console.error(`sf6 ${resource} ${method} failed: ${failure.code}`);
    return Response.json({ error: failure.message }, { status: failure.status, headers });
  }
};
