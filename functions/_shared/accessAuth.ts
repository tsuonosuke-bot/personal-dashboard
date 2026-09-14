import { createRemoteJWKSet, jwtVerify } from "jose";

export interface AccessEnv {
  AUTH_MODE?: string;
  TEAM_DOMAIN?: string;
  POLICY_AUD?: string;
}

export type AccessCheck =
  | { ok: true }
  | { ok: false; status: 403 | 503; message: string };

const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function teamDomain(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export async function validateAccess(request: Request, env: AccessEnv): Promise<AccessCheck> {
  const issuer = teamDomain(env.TEAM_DOMAIN?.trim());
  const audience = env.POLICY_AUD?.trim();
  if (!issuer || !audience) {
    return { ok: false, status: 503, message: "Cloudflare Access is not configured.\n" };
  }
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) return { ok: false, status: 403, message: "Cloudflare Access authentication required.\n" };
  try {
    let keys = keySets.get(issuer);
    if (!keys) {
      keys = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
      keySets.set(issuer, keys);
    }
    await jwtVerify(token, keys, { issuer, audience });
    return { ok: true };
  } catch (error) {
    const errorName = error instanceof Error ? error.name : "unknown";
    console.warn("Cloudflare Access JWT validation failed", errorName);
    return { ok: false, status: 403, message: "Cloudflare Access token is invalid.\n" };
  }
}
