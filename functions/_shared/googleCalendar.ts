import { DashboardError, type DashboardEnv } from "./dashboard.ts";

export const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";
export const GOOGLE_CALENDAR_TIME_ZONE = "Asia/Tokyo";

const PROVIDER = "google_calendar";
const STATE_COOKIE = "google_calendar_oauth_state";
const CALLBACK_PATH = "/api/google-calendar-callback";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface CalendarSchedule {
  allDay: boolean;
  date: string;
  startTime: string | null;
  endTime: string | null;
  timeZone: typeof GOOGLE_CALENDAR_TIME_ZONE;
}

export interface GoogleCalendarConnectionStatus {
  configured: boolean;
  connected: boolean;
  calendarId: "primary";
  timeZone: typeof GOOGLE_CALENDAR_TIME_ZONE;
  connectedAt: string | null;
}

interface IntegrationRow {
  provider?: unknown;
  encrypted_credentials?: unknown;
  scope?: unknown;
  connected_at?: unknown;
  updated_at?: unknown;
}

interface OAuthState {
  state: string;
  verifier: string;
  expiresAt: number;
}

interface GoogleEventShape {
  id?: unknown;
  htmlLink?: unknown;
  status?: unknown;
  summary?: unknown;
  start?: unknown;
  end?: unknown;
}

interface GoogleEventResult {
  targetId: string;
  targetUrl: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key)) && keys.every((key) => key in value);
}

function isValidDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isValidTime(value: unknown): value is string {
  return typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function minutes(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

export function parseCalendarSchedule(value: unknown): CalendarSchedule | null {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ["allDay", "date", "startTime", "endTime", "timeZone"])) return null;
  if (typeof value.allDay !== "boolean" || !isValidDate(value.date) || value.timeZone !== GOOGLE_CALENDAR_TIME_ZONE) return null;
  if (value.allDay) {
    if (value.startTime !== null || value.endTime !== null) return null;
  } else {
    if (!isValidTime(value.startTime) || !isValidTime(value.endTime) || minutes(value.endTime) <= minutes(value.startTime)) return null;
  }
  return {
    allDay: value.allDay,
    date: value.date,
    startTime: value.startTime as string | null,
    endTime: value.endTime as string | null,
    timeZone: GOOGLE_CALENDAR_TIME_ZONE,
  };
}

function configured(env: DashboardEnv): boolean {
  return Boolean(
    env.SUPABASE_URL?.trim() &&
    env.SUPABASE_SECRET_KEY?.trim() &&
    env.GOOGLE_OAUTH_CLIENT_ID?.trim() &&
    env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() &&
    env.GOOGLE_TOKEN_ENCRYPTION_KEY?.trim(),
  );
}

function supabaseConnection(env: DashboardEnv): { url: URL; key: string } {
  const rawUrl = env.SUPABASE_URL?.trim();
  const key = env.SUPABASE_SECRET_KEY?.trim();
  if (!rawUrl || !key) throw new DashboardError("SUPABASE_NOT_CONFIGURED", "Supabase is not configured.", 503);
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new DashboardError("SUPABASE_CONFIG_INVALID", "SUPABASE_URL is invalid.", 503);
  }
  if (url.protocol !== "https:") throw new DashboardError("SUPABASE_CONFIG_INVALID", "SUPABASE_URL must use HTTPS.", 503);
  return { url, key };
}

async function supabaseFetch(env: DashboardEnv, endpoint: URL, init: RequestInit = {}): Promise<Response> {
  const { key } = supabaseConnection(env);
  try {
    return await fetch(endpoint, {
      ...init,
      headers: {
        Accept: "application/json",
        apikey: key,
        ...(init.headers || {}),
      },
    });
  } catch {
    throw new DashboardError("SUPABASE_UNAVAILABLE", "Could not reach integration connections.");
  }
}

function integrationEndpoint(env: DashboardEnv): URL {
  return new URL("/rest/v1/integration_connections", supabaseConnection(env).url);
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function encryptionKeyBytes(env: DashboardEnv): Uint8Array {
  const encoded = env.GOOGLE_TOKEN_ENCRYPTION_KEY?.trim();
  const bytes = encoded ? base64UrlDecode(encoded) : null;
  if (!bytes || bytes.length !== 32) {
    throw new DashboardError("GOOGLE_CALENDAR_CONFIG_INVALID", "Google token encryption key is invalid.", 503);
  }
  return bytes;
}

async function encryptionKey(env: DashboardEnv): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encryptionKeyBytes(env) as unknown as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function seal(value: string, env: DashboardEnv, context: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(context) },
    await encryptionKey(env),
    encoder.encode(value),
  );
  return `v1.${base64UrlEncode(iv)}.${base64UrlEncode(new Uint8Array(encrypted))}`;
}

async function unseal(value: string, env: DashboardEnv, context: string): Promise<string> {
  const [version, encodedIv, encodedCiphertext, extra] = value.split(".");
  const iv = encodedIv ? base64UrlDecode(encodedIv) : null;
  const ciphertext = encodedCiphertext ? base64UrlDecode(encodedCiphertext) : null;
  if (version !== "v1" || !iv || iv.length !== 12 || !ciphertext || extra) {
    throw new DashboardError("GOOGLE_CALENDAR_RECONNECT_REQUIRED", "Stored Google credentials are invalid.", 409);
  }
  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv as unknown as BufferSource, additionalData: encoder.encode(context) },
      await encryptionKey(env),
      ciphertext as unknown as BufferSource,
    );
    return decoder.decode(decrypted);
  } catch {
    throw new DashboardError("GOOGLE_CALENDAR_RECONNECT_REQUIRED", "Stored Google credentials could not be decrypted.", 409);
  }
}

function randomToken(byteLength: number): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(byteLength)));
}

async function sha256(value: string): Promise<string> {
  return base64UrlEncode(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

function cookieValue(request: Request, name: string): string | null {
  const cookies = request.headers.get("Cookie") || "";
  for (const entry of cookies.split(";")) {
    const [candidate, ...parts] = entry.trim().split("=");
    if (candidate === name) return parts.join("=") || null;
  }
  return null;
}

function oauthCookie(value: string, request: Request, maxAge: number): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${STATE_COOKIE}=${value}; Path=${CALLBACK_PATH}; Max-Age=${maxAge}; HttpOnly${secure}; SameSite=Lax`;
}

function redirectUri(request: Request): string {
  const url = new URL(request.url);
  const local = url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  if (url.protocol !== "https:" && !local) {
    throw new DashboardError("GOOGLE_CALENDAR_CONFIG_INVALID", "Google OAuth requires HTTPS.", 503);
  }
  return new URL(CALLBACK_PATH, url.origin).toString();
}

function safeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

async function readConnectionRow(env: DashboardEnv, includeCredentials: boolean): Promise<IntegrationRow | null> {
  const endpoint = integrationEndpoint(env);
  endpoint.searchParams.set("select", includeCredentials
    ? "provider,encrypted_credentials,scope,connected_at,updated_at"
    : "provider,scope,connected_at,updated_at");
  endpoint.searchParams.set("provider", `eq.${PROVIDER}`);
  endpoint.searchParams.set("limit", "1");
  const response = await supabaseFetch(env, endpoint);
  if (!response.ok) {
    const code = response.status === 401 || response.status === 403 ? "SUPABASE_ACCESS_DENIED" : "SUPABASE_REQUEST_FAILED";
    throw new DashboardError(code, `integration_connections returned ${response.status}.`);
  }
  const rows: unknown = await response.json();
  if (!Array.isArray(rows)) throw new DashboardError("SUPABASE_RESPONSE_INVALID", "integration_connections returned invalid data.");
  return rows.length > 0 && isPlainObject(rows[0]) ? rows[0] as IntegrationRow : null;
}

async function saveRefreshToken(env: DashboardEnv, refreshToken: string, scope: string): Promise<void> {
  const now = new Date().toISOString();
  const endpoint = integrationEndpoint(env);
  endpoint.searchParams.set("on_conflict", "provider");
  endpoint.searchParams.set("select", "provider");
  const encrypted = await encryptGoogleCalendarRefreshToken(refreshToken, env);
  const response = await supabaseFetch(env, endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify({
      provider: PROVIDER,
      encrypted_credentials: encrypted,
      scope,
      connected_at: now,
      updated_at: now,
    }),
  });
  if (!response.ok) {
    const code = response.status === 401 || response.status === 403 ? "SUPABASE_ACCESS_DENIED" : "SUPABASE_REQUEST_FAILED";
    throw new DashboardError(code, `integration_connections returned ${response.status}.`);
  }
  const rows: unknown = await response.json();
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new DashboardError("SUPABASE_RESPONSE_INVALID", "integration_connections returned invalid data.");
  }
}

export async function encryptGoogleCalendarRefreshToken(refreshToken: string, env: DashboardEnv): Promise<string> {
  if (!refreshToken) throw new DashboardError("GOOGLE_CALENDAR_RESPONSE_INVALID", "Google refresh token is empty.");
  return seal(refreshToken, env, "google-calendar-refresh-token-v1");
}

async function loadRefreshToken(env: DashboardEnv): Promise<string> {
  const row = await readConnectionRow(env, true);
  if (!row || typeof row.encrypted_credentials !== "string") {
    throw new DashboardError("GOOGLE_CALENDAR_NOT_CONNECTED", "Google Calendar is not connected.", 409);
  }
  const refreshToken = await unseal(row.encrypted_credentials, env, "google-calendar-refresh-token-v1");
  if (!refreshToken) throw new DashboardError("GOOGLE_CALENDAR_RECONNECT_REQUIRED", "Google Calendar must be reconnected.", 409);
  return refreshToken;
}

export async function getGoogleCalendarConnectionStatus(env: DashboardEnv): Promise<GoogleCalendarConnectionStatus> {
  if (!configured(env)) {
    return { configured: false, connected: false, calendarId: "primary", timeZone: GOOGLE_CALENDAR_TIME_ZONE, connectedAt: null };
  }
  encryptionKeyBytes(env);
  const row = await readConnectionRow(env, false);
  const hasRequiredScope = typeof row?.scope === "string" && row.scope.split(/\s+/).includes(GOOGLE_CALENDAR_SCOPE);
  return {
    configured: true,
    connected: Boolean(row && row.provider === PROVIDER && hasRequiredScope && typeof row.connected_at === "string"),
    calendarId: "primary",
    timeZone: GOOGLE_CALENDAR_TIME_ZONE,
    connectedAt: typeof row?.connected_at === "string" && !Number.isNaN(Date.parse(row.connected_at))
      ? new Date(row.connected_at).toISOString()
      : null,
  };
}

export async function assertGoogleCalendarConnected(env: DashboardEnv): Promise<void> {
  if (!configured(env)) throw new DashboardError("GOOGLE_CALENDAR_NOT_CONFIGURED", "Google Calendar is not configured.", 503);
  await loadRefreshToken(env);
}

export async function startGoogleCalendarOAuth(request: Request, env: DashboardEnv): Promise<Response> {
  if (!configured(env)) throw new DashboardError("GOOGLE_CALENDAR_NOT_CONFIGURED", "Google Calendar is not configured.", 503);
  const state = randomToken(24);
  const verifier = randomToken(48);
  const payload: OAuthState = { state, verifier, expiresAt: Date.now() + 10 * 60 * 1_000 };
  const sealed = await seal(JSON.stringify(payload), env, "google-calendar-oauth-state-v1");
  const location = new URL(AUTHORIZATION_ENDPOINT);
  location.searchParams.set("client_id", env.GOOGLE_OAUTH_CLIENT_ID!.trim());
  location.searchParams.set("redirect_uri", redirectUri(request));
  location.searchParams.set("response_type", "code");
  location.searchParams.set("scope", GOOGLE_CALENDAR_SCOPE);
  location.searchParams.set("access_type", "offline");
  location.searchParams.set("prompt", "consent");
  location.searchParams.set("include_granted_scopes", "false");
  location.searchParams.set("state", state);
  location.searchParams.set("code_challenge", await sha256(verifier));
  location.searchParams.set("code_challenge_method", "S256");
  return new Response(null, {
    status: 302,
    headers: {
      Location: location.toString(),
      "Set-Cookie": oauthCookie(sealed, request, 600),
      "Cache-Control": "private, no-store",
    },
  });
}

async function exchangeAuthorizationCode(
  request: Request,
  env: DashboardEnv,
  code: string,
  verifier: string,
): Promise<{ accessToken: string; refreshToken: string; scope: string }> {
  const body = new URLSearchParams({
    client_id: env.GOOGLE_OAUTH_CLIENT_ID!.trim(),
    client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET!.trim(),
    code,
    code_verifier: verifier,
    grant_type: "authorization_code",
    redirect_uri: redirectUri(request),
  });
  let response: Response;
  try {
    response = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
  } catch {
    throw new DashboardError("GOOGLE_CALENDAR_UNAVAILABLE", "Could not reach Google OAuth.");
  }
  if (!response.ok) throw new DashboardError("GOOGLE_CALENDAR_ACCESS_DENIED", `Google OAuth returned ${response.status}.`, 502);
  const payload: unknown = await response.json();
  if (!isPlainObject(payload) || typeof payload.access_token !== "string" || typeof payload.refresh_token !== "string") {
    throw new DashboardError("GOOGLE_CALENDAR_RESPONSE_INVALID", "Google OAuth returned invalid data.");
  }
  const scope = typeof payload.scope === "string" ? payload.scope : GOOGLE_CALENDAR_SCOPE;
  if (!scope.split(/\s+/).includes(GOOGLE_CALENDAR_SCOPE)) {
    throw new DashboardError("GOOGLE_CALENDAR_ACCESS_DENIED", "Google Calendar scope was not granted.", 403);
  }
  return { accessToken: payload.access_token, refreshToken: payload.refresh_token, scope };
}

async function verifyPrimaryCalendarAccess(accessToken: string): Promise<void> {
  const endpoint = new URL(`${CALENDAR_API}/calendars/primary/events`);
  endpoint.searchParams.set("maxResults", "1");
  endpoint.searchParams.set("fields", "kind");
  let response: Response;
  try {
    response = await fetch(endpoint, { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } });
  } catch {
    throw new DashboardError("GOOGLE_CALENDAR_UNAVAILABLE", "Could not reach Google Calendar.");
  }
  if (!response.ok) {
    const code = response.status === 401 || response.status === 403
      ? "GOOGLE_CALENDAR_ACCESS_DENIED"
      : "GOOGLE_CALENDAR_REQUEST_FAILED";
    throw new DashboardError(code, `Google Calendar returned ${response.status}.`, 502);
  }
}

function callbackRedirect(request: Request, result: "connected" | "denied" | "error"): Response {
  const location = new URL("/compass/", new URL(request.url).origin);
  location.searchParams.set("calendar", result);
  return new Response(null, {
    status: 302,
    headers: {
      Location: location.toString(),
      "Set-Cookie": oauthCookie("", request, 0),
      "Cache-Control": "private, no-store",
    },
  });
}

export async function handleGoogleCalendarOAuthCallback(request: Request, env: DashboardEnv): Promise<Response> {
  const url = new URL(request.url);
  try {
    if (!configured(env)) throw new DashboardError("GOOGLE_CALENDAR_NOT_CONFIGURED", "Google Calendar is not configured.", 503);
    const sealedState = cookieValue(request, STATE_COOKIE);
    if (!sealedState) throw new DashboardError("GOOGLE_CALENDAR_OAUTH_INVALID", "Google OAuth state cookie is missing.", 400);
    const rawState = await unseal(sealedState, env, "google-calendar-oauth-state-v1");
    const parsed: unknown = JSON.parse(rawState);
    if (!isPlainObject(parsed) || typeof parsed.state !== "string" || typeof parsed.verifier !== "string" ||
        typeof parsed.expiresAt !== "number" || parsed.expiresAt < Date.now()) {
      throw new DashboardError("GOOGLE_CALENDAR_OAUTH_INVALID", "Google OAuth state is invalid.", 400);
    }
    const returnedState = url.searchParams.get("state") || "";
    if (!safeEqual(parsed.state, returnedState)) {
      throw new DashboardError("GOOGLE_CALENDAR_OAUTH_INVALID", "Google OAuth state did not match.", 400);
    }
    if (url.searchParams.get("error")) return callbackRedirect(request, "denied");
    const code = url.searchParams.get("code") || "";
    if (!code) throw new DashboardError("GOOGLE_CALENDAR_OAUTH_INVALID", "Google OAuth code is missing.", 400);
    const token = await exchangeAuthorizationCode(request, env, code, parsed.verifier);
    await verifyPrimaryCalendarAccess(token.accessToken);
    await saveRefreshToken(env, token.refreshToken, token.scope);
    return callbackRedirect(request, "connected");
  } catch (error) {
    const code = error instanceof DashboardError ? error.code : "GOOGLE_CALENDAR_OAUTH_FAILED";
    console.error(`Google Calendar OAuth callback failed: ${code}`);
    return callbackRedirect(request, "error");
  }
}

async function refreshAccessToken(env: DashboardEnv): Promise<string> {
  const refreshToken = await loadRefreshToken(env);
  const body = new URLSearchParams({
    client_id: env.GOOGLE_OAUTH_CLIENT_ID!.trim(),
    client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET!.trim(),
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  let response: Response;
  try {
    response = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
  } catch {
    throw new DashboardError("GOOGLE_CALENDAR_UNAVAILABLE", "Could not refresh Google access.");
  }
  if (!response.ok) {
    if (response.status === 400 || response.status === 401) {
      throw new DashboardError("GOOGLE_CALENDAR_RECONNECT_REQUIRED", "Google Calendar must be reconnected.", 409);
    }
    throw new DashboardError("GOOGLE_CALENDAR_REQUEST_FAILED", `Google OAuth returned ${response.status}.`);
  }
  const payload: unknown = await response.json();
  if (!isPlainObject(payload) || typeof payload.access_token !== "string") {
    throw new DashboardError("GOOGLE_CALENDAR_RESPONSE_INVALID", "Google OAuth returned invalid data.");
  }
  return payload.access_token;
}

function nextDate(date: string): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

function eventDateTime(date: string, time: string): string {
  return `${date}T${time}:00+09:00`;
}

function expectedEvent(
  wantId: number,
  idempotencyKey: string,
  title: string,
  detail: string | null,
  schedule: CalendarSchedule,
) {
  const description = [detail, `Personal Dashboard Want #${wantId}`].filter(Boolean).join("\n\n");
  return {
    id: `pd${idempotencyKey.replace(/-/g, "")}`,
    summary: title,
    description,
    start: schedule.allDay
      ? { date: schedule.date }
      : { dateTime: eventDateTime(schedule.date, schedule.startTime!), timeZone: schedule.timeZone },
    end: schedule.allDay
      ? { date: nextDate(schedule.date) }
      : { dateTime: eventDateTime(schedule.date, schedule.endTime!), timeZone: schedule.timeZone },
  };
}

function validGoogleUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "google.com" || url.hostname.endsWith(".google.com"));
  } catch {
    return false;
  }
}

function matchesEvent(actual: GoogleEventShape, expected: ReturnType<typeof expectedEvent>): boolean {
  if (actual.id !== expected.id || actual.status === "cancelled" || actual.summary !== expected.summary ||
      !isPlainObject(actual.start) || !isPlainObject(actual.end)) return false;
  if ("date" in expected.start) {
    return actual.start.date === expected.start.date && actual.end.date === expected.end.date;
  }
  const expectedEnd = "dateTime" in expected.end ? expected.end.dateTime : null;
  return typeof actual.start.dateTime === "string" && typeof actual.end.dateTime === "string" &&
    Date.parse(actual.start.dateTime) === Date.parse(expected.start.dateTime) &&
    typeof expectedEnd === "string" && Date.parse(actual.end.dateTime) === Date.parse(expectedEnd);
}

async function readVerifiedEvent(accessToken: string, expected: ReturnType<typeof expectedEvent>): Promise<GoogleEventResult> {
  const endpoint = new URL(`${CALENDAR_API}/calendars/primary/events/${encodeURIComponent(expected.id)}`);
  endpoint.searchParams.set("fields", "id,htmlLink,status,summary,start,end");
  let response: Response;
  try {
    response = await fetch(endpoint, { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } });
  } catch {
    throw new DashboardError("GOOGLE_CALENDAR_UNAVAILABLE", "Could not verify the Google event.");
  }
  if (!response.ok) {
    const code = response.status === 401 || response.status === 403
      ? "GOOGLE_CALENDAR_ACCESS_DENIED"
      : "GOOGLE_CALENDAR_REQUEST_FAILED";
    throw new DashboardError(code, `Google Calendar verification returned ${response.status}.`);
  }
  const event: unknown = await response.json();
  if (!isPlainObject(event) || !matchesEvent(event as GoogleEventShape, expected) || !validGoogleUrl(event.htmlLink)) {
    throw new DashboardError("GOOGLE_CALENDAR_RESPONSE_INVALID", "Google Calendar returned an unexpected event.");
  }
  return { targetId: expected.id, targetUrl: event.htmlLink };
}

export async function createGoogleCalendarEvent(
  env: DashboardEnv,
  input: {
    wantId: number;
    idempotencyKey: string;
    title: string;
    detail: string | null;
    schedule: CalendarSchedule;
  },
): Promise<GoogleEventResult> {
  if (!configured(env)) throw new DashboardError("GOOGLE_CALENDAR_NOT_CONFIGURED", "Google Calendar is not configured.", 503);
  const accessToken = await refreshAccessToken(env);
  const event = expectedEvent(input.wantId, input.idempotencyKey, input.title, input.detail, input.schedule);
  const endpoint = new URL(`${CALENDAR_API}/calendars/primary/events`);
  endpoint.searchParams.set("sendUpdates", "none");
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(event),
    });
  } catch {
    throw new DashboardError("GOOGLE_CALENDAR_UNAVAILABLE", "Could not create the Google event.");
  }
  if (!response.ok && response.status !== 409) {
    const code = response.status === 401 || response.status === 403
      ? "GOOGLE_CALENDAR_ACCESS_DENIED"
      : response.status === 429
        ? "GOOGLE_CALENDAR_RATE_LIMITED"
        : "GOOGLE_CALENDAR_REQUEST_FAILED";
    throw new DashboardError(code, `Google Calendar returned ${response.status}.`, response.status === 429 ? 429 : 502);
  }
  return readVerifiedEvent(accessToken, event);
}
