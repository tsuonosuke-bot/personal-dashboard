import { publicError, type DashboardEnv } from "../../_shared/dashboard.ts";
import { loadSf6Moves, readSf6MovesCharacter } from "../../_shared/sf6.ts";

interface FunctionContext {
  request: Request;
  env: DashboardEnv;
}

const headers = { "Cache-Control": "private, no-store", "Content-Type": "application/json; charset=utf-8" };

// GET /api/sf6/moves?character=<キャラ名>：1キャラの技とフレーム（読み取り専用）。
// 静的なルートなので [resource].ts より優先される。
export const onRequest = async (context: FunctionContext): Promise<Response> => {
  if (context.request.method !== "GET") {
    return new Response("Method Not Allowed\n", { status: 405, headers: { Allow: "GET" } });
  }
  const character = readSf6MovesCharacter(new URL(context.request.url));
  if (!character.ok) return Response.json({ error: character.error }, { status: character.status, headers });
  try {
    return Response.json(await loadSf6Moves(context.env, character.value), { headers });
  } catch (error) {
    const failure = publicError(error);
    console.error(`sf6 moves request failed: ${failure.code}`);
    return Response.json({ error: failure.message }, { status: failure.status, headers });
  }
};
