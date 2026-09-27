import type { QuizSigningEnv } from "./quizSession.ts";

export interface RecoveryAssignment {
  knowledge_id: string;
  current_next_review_on: string;
  scheduled_on: string;
}

interface RecoveryTokenPayload {
  v: 1;
  typ: "review-recovery";
  aud: string;
  exp: number;
  daily_limit: number;
  assignments: RecoveryAssignment[];
}

const TOKEN_TTL_SECONDS = 15 * 60;
const MAX_TOKEN_CHARS = 250_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function secret(env: QuizSigningEnv): string | null {
  const value = env.QUIZ_SIGNING_SECRET?.trim();
  return value && value.length >= 32 ? value : null;
}

async function hmacKey(value: string) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(value),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function signedBytes(encodedPayload: string): Uint8Array {
  return encoder.encode(`knowledge-dashboard-recovery-v1.${encodedPayload}`);
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function parsePayload(value: unknown, audience: string, now: number): RecoveryTokenPayload | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const payload = value as Partial<RecoveryTokenPayload>;
  if (
    payload.v !== 1 || payload.typ !== "review-recovery" || payload.aud !== audience
    || typeof payload.exp !== "number" || !Number.isInteger(payload.exp)
    || payload.exp < Math.floor(now / 1_000) - 5
    || payload.exp > Math.floor(now / 1_000) + TOKEN_TTL_SECONDS + 5
    || typeof payload.daily_limit !== "number" || !Number.isInteger(payload.daily_limit)
    || payload.daily_limit < 1 || payload.daily_limit > 30
    || !Array.isArray(payload.assignments) || payload.assignments.length < 1 || payload.assignments.length > 5_000
  ) return null;

  const seen = new Set<string>();
  for (const assignment of payload.assignments) {
    if (
      typeof assignment !== "object" || assignment === null
      || typeof assignment.knowledge_id !== "string" || !UUID_RE.test(assignment.knowledge_id)
      || seen.has(assignment.knowledge_id)
      || !validDate(assignment.current_next_review_on)
      || !validDate(assignment.scheduled_on)
      || assignment.scheduled_on <= assignment.current_next_review_on
    ) return null;
    seen.add(assignment.knowledge_id);
  }
  return payload as RecoveryTokenPayload;
}

export async function issueRecoveryToken(
  dailyLimit: number,
  assignments: RecoveryAssignment[],
  request: Request,
  env: QuizSigningEnv,
  now = Date.now(),
): Promise<{ ok: true; token: string } | { ok: false; status: 503; error: string }> {
  const signingSecret = secret(env);
  if (!signingSecret) {
    return { ok: false, status: 503, error: "サーバーの復習署名設定が未完了です。" };
  }
  const payload: RecoveryTokenPayload = {
    v: 1,
    typ: "review-recovery",
    aud: new URL(request.url).host,
    exp: Math.floor(now / 1_000) + TOKEN_TTL_SECONDS,
    daily_limit: dailyLimit,
    assignments,
  };
  const encoded = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(signingSecret),
    signedBytes(encoded) as unknown as BufferSource,
  );
  return { ok: true, token: `${encoded}.${toBase64Url(new Uint8Array(signature))}` };
}

export async function verifyRecoveryToken(
  token: string,
  request: Request,
  env: QuizSigningEnv,
  now = Date.now(),
): Promise<
  | { ok: true; dailyLimit: number; assignments: RecoveryAssignment[] }
  | { ok: false; status: 400 | 503; error: string }
> {
  const signingSecret = secret(env);
  if (!signingSecret) {
    return { ok: false, status: 503, error: "サーバーの復習署名設定が未完了です。" };
  }
  if (!token || token.length > MAX_TOKEN_CHARS) {
    return { ok: false, status: 400, error: "回復プレビューが正しくありません。" };
  }
  const [encoded, encodedSignature, extra] = token.split(".");
  const payloadBytes = encoded ? fromBase64Url(encoded) : null;
  const signature = encodedSignature ? fromBase64Url(encodedSignature) : null;
  if (!encoded || !encodedSignature || extra || !payloadBytes || !signature) {
    return { ok: false, status: 400, error: "回復プレビューが正しくありません。" };
  }
  const valid = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(signingSecret),
    signature as unknown as BufferSource,
    signedBytes(encoded) as unknown as BufferSource,
  );
  if (!valid) return { ok: false, status: 400, error: "回復プレビューが正しくありません。" };
  try {
    const payload = parsePayload(
      JSON.parse(new TextDecoder().decode(payloadBytes)),
      new URL(request.url).host,
      now,
    );
    if (!payload) return { ok: false, status: 400, error: "回復プレビューが無効または期限切れです。" };
    return { ok: true, dailyLimit: payload.daily_limit, assignments: payload.assignments };
  } catch {
    return { ok: false, status: 400, error: "回復プレビューが正しくありません。" };
  }
}
