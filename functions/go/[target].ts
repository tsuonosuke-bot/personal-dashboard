import { createHandoffUrl, type SessionEnv } from "../_shared/sessionAuth.ts";

interface Env extends SessionEnv {
  NAV_FINANCIAL_URL?: string;
  NAV_KNOWLEDGE_URL?: string;
}

interface FunctionContext {
  request: Request;
  env: Env;
  params: { target?: string };
}

const TARGETS: Record<string, { env: keyof Env; fallback: string }> = {
  financial: { env: "NAV_FINANCIAL_URL", fallback: "https://financial-dashboard-9q8.pages.dev/" },
  knowledge: { env: "NAV_KNOWLEDGE_URL", fallback: "https://knowledge-dashboard-27t.pages.dev/" },
};

export const onRequest = async (context: FunctionContext): Promise<Response> => {
  if (context.request.method !== "GET") return new Response("Method Not Allowed\n", { status: 405, headers: { Allow: "GET" } });
  const definition = TARGETS[context.params.target || ""];
  if (!definition) return new Response("Not Found\n", { status: 404 });
  let target: URL;
  try {
    target = new URL(String(context.env[definition.env] || definition.fallback));
    if (target.protocol !== "https:") throw new Error("invalid protocol");
  } catch {
    return new Response("Navigation target is invalid.\n", { status: 503 });
  }
  const handoff = await createHandoffUrl(target, context.env);
  if (!handoff) return new Response("SSO handoff is not configured.\n", { status: 503 });
  return new Response(null, {
    status: 302,
    headers: { Location: handoff.toString(), "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" },
  });
};
