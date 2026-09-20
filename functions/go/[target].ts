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

function isUuid(value: string | null): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export const onRequest = async (context: FunctionContext): Promise<Response> => {
  if (context.request.method !== "GET") return new Response("Method Not Allowed\n", { status: 405, headers: { Allow: "GET" } });
  const definition = TARGETS[context.params.target || ""];
  if (!definition) return new Response("Not Found\n", { status: 404 });
  let target: URL;
  try {
    target = new URL(String(context.env[definition.env] || definition.fallback));
    if (target.protocol !== "https:") throw new Error("invalid protocol");
    const requestUrl = new URL(context.request.url);
    const requestedView = requestUrl.searchParams.get("view");
    const requestedKnowledge = requestUrl.searchParams.get("knowledge");
    if (context.params.target === "knowledge" && (requestedView === "quiz" || isUuid(requestedKnowledge))) {
      target.pathname = "/";
      target.search = "";
      target.hash = "";
      if (requestedView === "quiz") target.searchParams.set("view", "quiz");
      else if (requestedKnowledge) target.searchParams.set("knowledge", requestedKnowledge);
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
