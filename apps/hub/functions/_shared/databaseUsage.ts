import type { HubEnv } from "./hub.ts";

/** Supabase無料プランのDB容量。プランを変えたら `SUPABASE_DB_LIMIT_MB` で上書きする。 */
export const DEFAULT_DB_LIMIT_MB = 500;
/** 使用率がこの割合を超えたら警告（注意 / 逼迫）。 */
export const WARN_RATIO = 0.8;
export const CRITICAL_RATIO = 0.9;

export type UsageLevel = "ok" | "warn" | "critical";

export interface DatabaseUsage {
  usedBytes: number;
  limitBytes: number;
  /** 0〜1以上。上限を超えたら1を超える。 */
  ratio: number;
  level: UsageLevel;
  publicBytes: number | null;
  topTables: Array<{ name: string; bytes: number }>;
  /** 注意以上のときだけ、画面に出す文言。 */
  alert: string | null;
}

export interface DatabaseUsageEnv extends HubEnv {
  SUPABASE_DB_LIMIT_MB?: string;
}

const MB = 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const bytes = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null);

export function limitMegabytes(value: string | undefined): number {
  const parsed = Number(value?.trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_DB_LIMIT_MB;
}

export function formatBytes(value: number): string {
  if (value >= 1024 * MB) return `${(value / (1024 * MB)).toFixed(2)} GB`;
  if (value >= MB) return `${(value / MB).toFixed(value >= 100 * MB ? 0 : 1)} MB`;
  return `${Math.max(0, Math.round(value / 1024))} KB`;
}

export function levelFor(ratio: number): UsageLevel {
  return ratio >= CRITICAL_RATIO ? "critical" : ratio >= WARN_RATIO ? "warn" : "ok";
}

/** `get_database_usage()` の応答を、使用率と警告つきの形にする。形が違えばnull。 */
export function parseDatabaseUsage(data: unknown, limitMb: number): DatabaseUsage | null {
  if (!isRecord(data)) return null;
  const usedBytes = bytes(data.database_bytes);
  if (usedBytes === null) return null;
  const limitBytes = limitMb * MB;
  const ratio = usedBytes / limitBytes;
  const level = levelFor(ratio);
  const topTables = Array.isArray(data.top_tables)
    ? data.top_tables.flatMap((entry) => (isRecord(entry) && typeof entry.name === "string" && bytes(entry.bytes) !== null
      ? [{ name: entry.name, bytes: entry.bytes as number }]
      : []))
    : [];
  const percent = Math.round(ratio * 100);
  const alert = level === "ok"
    ? null
    : `DB容量が上限の${percent}%に達しています（${formatBytes(usedBytes)} / ${formatBytes(limitBytes)}）。${level === "critical" ? "上限を超えると書き込めなくなります。不要なデータの整理かプランの変更を検討してください。" : "増え方を確認してください。"}`;
  return { usedBytes, limitBytes, ratio, level, publicBytes: bytes(data.public_bytes), topTables, alert };
}

/** SupabaseのDB容量。取得できないとき（関数が未適用・通信失敗）はnull。 */
export async function loadDatabaseUsage(env: DatabaseUsageEnv): Promise<DatabaseUsage | null> {
  const rawUrl = env.SUPABASE_URL?.trim();
  const key = env.SUPABASE_SECRET_KEY?.trim();
  if (!rawUrl || !key) return null;
  try {
    const endpoint = new URL("/rest/v1/rpc/get_database_usage", rawUrl);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", apikey: key },
      body: "{}",
    });
    if (!response.ok || !response.headers.get("Content-Type")?.toLowerCase().includes("json")) return null;
    return parseDatabaseUsage(await response.json(), limitMegabytes(env.SUPABASE_DB_LIMIT_MB));
  } catch {
    return null;
  }
}
