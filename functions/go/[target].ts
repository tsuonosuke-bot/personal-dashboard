interface FunctionContext {
  request: Request;
  env?: unknown;
  params: { target?: string };
}

function isUuid(value: string | null): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export const onRequest = async (context: FunctionContext): Promise<Response> => {
  if (context.request.method !== "GET") return new Response("Method Not Allowed\n", { status: 405, headers: { Allow: "GET" } });
  const target = context.params.target || "";
  if (target !== "financial" && target !== "knowledge") return new Response("Not Found\n", { status: 404 });
  const requestUrl = new URL(context.request.url);
  const destination = new URL(target === "knowledge" ? "/knowledge/" : "/finance/", requestUrl);
  const requestedView = requestUrl.searchParams.get("view");
  const requestedMode = requestUrl.searchParams.get("mode");
  const requestedKnowledge = requestUrl.searchParams.get("knowledge");
  if (target === "knowledge" && requestedView === "quiz") {
    destination.searchParams.set("view", "quiz");
    if (requestedMode === "daily") destination.searchParams.set("mode", "daily");
  } else if (target === "knowledge" && isUuid(requestedKnowledge)) {
    destination.searchParams.set("knowledge", requestedKnowledge);
  }
  return new Response(null, {
    status: 302,
    headers: { Location: destination.toString(), "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" },
  });
};
