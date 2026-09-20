import { createHandoffUrl, type SessionEnv } from "../_shared/sessionAuth.ts";

interface Env extends SessionEnv {
  AUTH_MODE?: string;
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
    const requestedView = new URL(context.request.url).searchParams.get("view");
    if (context.params.target === "knowledge" && requestedView === "quiz") {
      target.pathname = "/";
      target.search = "";
      target.hash = "";
      target.searchParams.set("view", "quiz");
    }
  } catch {
    return new Response("Navigation target is invalid.\n", { status: 503 });
  }
  const useDirectNavigation = context.env.AUTH_MODE?.trim().toLowerCase() === "access";
  const handoff = useDirectNavigation ? null : await createHandoffUrl(target, context.env);
  const destination = handoff || target;
  return new Response(null, {
    status: 302,
    headers: { Location: destination.toString(), "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" },
  });
};
