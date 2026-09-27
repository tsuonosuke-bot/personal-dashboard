import type { QuizFormat } from "./quizValidation.ts";

export interface QuizSigningEnv {
  QUIZ_SIGNING_SECRET?: string;
}

export interface SignedQuizItem {
  id: string;
  question: string;
  format: QuizFormat;
  choices: string[] | null;
}

export interface QuizTokenIssueItem extends SignedQuizItem {
  /** 四択のときだけ入る。トークンには平文では保存せず、HMACの照合情報に変換する。 */
  correctChoice: string | null;
}

export interface VerifiedQuizItem extends SignedQuizItem {
  /** 旧トークンには存在しないためnullを許容する。 */
  correctChoiceProof: string | null;
  /** Signed, random idempotency key. It is never accepted from the request body directly. */
  attempt_id: string;
}

interface QuizTokenPayload extends SignedQuizItem {
  v: 1;
  typ: "quiz-item";
  aud: string;
  exp: number;
  nonce: string;
  correctChoiceProof?: string | null;
}

type TokenResult =
  | { ok: true; value: VerifiedQuizItem }
  | { ok: false; status: 400 | 503; error: string };

const TOKEN_TTL_SECONDS = 2 * 60 * 60;
const MAX_TOKEN_CHARS = 16_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
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

function signingSecret(env: QuizSigningEnv): string | null {
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
  return encoder.encode(`knowledge-dashboard-quiz-v1.${encodedPayload}`);
}

function choiceProofBytes(item: SignedQuizItem, choice: string): Uint8Array {
  return encoder.encode(JSON.stringify([
    "knowledge-dashboard-quiz-choice-v1",
    item.id,
    item.question,
    choice,
  ]));
}

function randomNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

function validChoices(value: unknown, format: QuizFormat): value is string[] | null {
  if (format !== "四択") return value === null;
  return Array.isArray(value)
    && value.length === 4
    && value.every((choice) => typeof choice === "string" && choice.length > 0 && choice.length <= 500)
    && new Set(value).size === value.length;
}

function parsePayload(value: unknown, audience: string, now: number): QuizTokenPayload | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const payload = value as Partial<QuizTokenPayload>;
  if (
    payload.v !== 1 || payload.typ !== "quiz-item" || payload.aud !== audience
    || typeof payload.exp !== "number" || !Number.isInteger(payload.exp)
    || payload.exp < Math.floor(now / 1_000) - 5
    || payload.exp > Math.floor(now / 1_000) + TOKEN_TTL_SECONDS + 5
    || typeof payload.nonce !== "string" || !/^[A-Za-z0-9_-]{20,64}$/.test(payload.nonce)
    || typeof payload.id !== "string" || !UUID_RE.test(payload.id)
    || typeof payload.question !== "string" || !payload.question.trim() || payload.question.length > 2_000
    || !(["一問一答", "四択", "記述説明", "産出"] as unknown[]).includes(payload.format)
    || !validChoices(payload.choices, payload.format as QuizFormat)
    || (
      payload.correctChoiceProof !== undefined
      && payload.correctChoiceProof !== null
      && (typeof payload.correctChoiceProof !== "string"
        || !/^[A-Za-z0-9_-]{43}$/.test(payload.correctChoiceProof))
    )
    || (payload.format !== "四択" && payload.correctChoiceProof != null)
  ) {
    return null;
  }
  return payload as QuizTokenPayload;
}

export async function issueQuizToken(
  item: QuizTokenIssueItem,
  request: Request,
  env: QuizSigningEnv,
  now = Date.now(),
): Promise<{ ok: true; token: string } | { ok: false; status: 503; error: string }> {
  const secret = signingSecret(env);
  if (!secret) {
    return { ok: false, status: 503, error: "サーバーのクイズ署名設定が未完了です。" };
  }
  if (
    (item.format === "四択" && (!item.correctChoice || !item.choices?.includes(item.correctChoice)))
    || (item.format !== "四択" && item.correctChoice !== null)
  ) {
    return { ok: false, status: 503, error: "サーバーが正解選択肢を安全に保持できませんでした。" };
  }
  const signedItem: SignedQuizItem = {
    id: item.id,
    question: item.question,
    format: item.format,
    choices: item.choices,
  };
  const correctChoiceProof = item.format === "四択"
    ? toBase64Url(new Uint8Array(await crypto.subtle.sign(
      "HMAC",
      await hmacKey(secret),
      choiceProofBytes(signedItem, item.correctChoice!) as unknown as BufferSource,
    )))
    : null;
  const payload: QuizTokenPayload = {
    ...signedItem,
    v: 1,
    typ: "quiz-item",
    aud: new URL(request.url).host,
    exp: Math.floor(now / 1_000) + TOKEN_TTL_SECONDS,
    nonce: randomNonce(),
    correctChoiceProof,
  };
  const encoded = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(secret),
    signedBytes(encoded) as unknown as BufferSource,
  );
  return { ok: true, token: `${encoded}.${toBase64Url(new Uint8Array(signature))}` };
}

export async function verifyQuizToken(
  token: string,
  request: Request,
  env: QuizSigningEnv,
  now = Date.now(),
): Promise<TokenResult> {
  const secret = signingSecret(env);
  if (!secret) {
    return { ok: false, status: 503, error: "サーバーのクイズ署名設定が未完了です。" };
  }
  if (!token || token.length > MAX_TOKEN_CHARS) {
    return { ok: false, status: 400, error: "クイズトークンが正しくありません。" };
  }
  const [encoded, encodedSignature, extra] = token.split(".");
  const payloadBytes = encoded ? fromBase64Url(encoded) : null;
  const signature = encodedSignature ? fromBase64Url(encodedSignature) : null;
  if (!encoded || !encodedSignature || extra || !payloadBytes || !signature) {
    return { ok: false, status: 400, error: "クイズトークンが正しくありません。" };
  }
  const valid = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(secret),
    signature as unknown as BufferSource,
    signedBytes(encoded) as unknown as BufferSource,
  );
  if (!valid) return { ok: false, status: 400, error: "クイズトークンが正しくありません。" };
  try {
    const parsed = parsePayload(JSON.parse(new TextDecoder().decode(payloadBytes)), new URL(request.url).host, now);
    if (!parsed) return { ok: false, status: 400, error: "クイズトークンが無効または期限切れです。" };
    return {
      ok: true,
      value: {
        id: parsed.id,
        question: parsed.question,
        format: parsed.format,
        choices: parsed.choices,
        correctChoiceProof: parsed.correctChoiceProof ?? null,
        attempt_id: parsed.nonce,
      },
    };
  } catch {
    return { ok: false, status: 400, error: "クイズトークンが正しくありません。" };
  }
}

/**
 * 出題時に確定した正解選択肢と回答を照合する。正解そのものはトークンへ保存しない。
 * nullは旧トークンなど、サーバー側の確定判定を利用できない場合を表す。
 */
export async function verifyQuizChoiceAnswer(
  item: VerifiedQuizItem,
  answer: string,
  env: QuizSigningEnv,
): Promise<boolean | null> {
  if (item.format !== "四択" || !item.correctChoiceProof) return null;
  const secret = signingSecret(env);
  const proof = fromBase64Url(item.correctChoiceProof);
  if (!secret || !proof) return null;
  return crypto.subtle.verify(
    "HMAC",
    await hmacKey(secret),
    proof as unknown as BufferSource,
    choiceProofBytes(item, answer) as unknown as BufferSource,
  );
}
