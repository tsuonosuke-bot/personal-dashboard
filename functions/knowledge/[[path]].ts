import { proxyDashboardRequest, type DashboardProxyEnv } from "../_shared/dashboardProxy.ts";

interface FunctionContext {
  request: Request;
  env: DashboardProxyEnv;
}

export const onRequest = (context: FunctionContext): Promise<Response> => proxyDashboardRequest(context, "knowledge");
