import { callRpc, isRecord } from "./reviewQueue.ts";
import type { SupabaseEnv } from "./supabaseRest.ts";

/** 全体の失敗がこの回数続いたら警告する（生成は30分ごと、採点は1時間ごとに動く）。 */
export const FAILURE_STREAK_LIMIT = 3;
/** 最後の成功（何もなく見送った実行も含む）からこの時間が空いたら警告する。 */
export const STALE_HOURS = { generate: 3, grade: 3 } as const;
/** pg_cronのジョブが最後に動いてからこの時間が空いたら警告する。 */
const CRON_STALE_HOURS = { generate: 2, grade: 3 } as const;

export interface BatchKindHealth {
  /** 最後に成功した（または対象がなく見送った）実行の開始時刻。 */
  lastOkAt: string | null;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  /** 直近の成功以降に続けて起きた、バッチ全体の失敗（AI・DB・打ち切り）の回数。 */
  consecutiveFailures: number;
  /** 直近24時間のバッチ全体の失敗回数。 */
  failed24h: number;
  /** 直近24時間で、成功したが一部のカードだけ処理できなかった実行の回数。 */
  partial24h: number;
  lastFailureAt: string | null;
  lastFailureNote: string | null;
}

export interface CronJobHealth {
  jobname: string;
  schedule: string | null;
  active: boolean;
  lastRunAt: string | null;
  lastStatus: string | null;
  failed24h: number;
  lastFailureMessage: string | null;
}

export interface ReviewBatchAlert {
  code: "generate_failing" | "generate_stale" | "grade_failing" | "grade_stale" | "cron_failing" | "cron_stale" | "cron_missing";
  message: string;
}

export interface ReviewBatchHealth {
  generate: BatchKindHealth;
  grade: BatchKindHealth;
  cron: CronJobHealth[];
  alerts: ReviewBatchAlert[];
}

const CRON_JOBS = { generate: "review-generate-questions", grade: "review-grade-answers" } as const;
const KIND_LABEL = { generate: "問題の生成", grade: "回答の採点" } as const;

const text = (value: unknown): string | null => (typeof value === "string" ? value : null);
const count = (value: unknown): number => (Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : 0);

function parseKind(value: unknown): BatchKindHealth | null {
  if (!isRecord(value)) return null;
  return {
    lastOkAt: text(value.last_ok_at),
    lastRunAt: text(value.last_run_at),
    lastRunStatus: text(value.last_run_status),
    consecutiveFailures: count(value.consecutive_failures),
    failed24h: count(value.failed_24h),
    partial24h: count(value.partial_24h),
    lastFailureAt: text(value.last_failure_at),
    lastFailureNote: text(value.last_failure_note),
  };
}

function parseCron(value: unknown): CronJobHealth[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.jobname !== "string") return [];
    return [{
      jobname: entry.jobname,
      schedule: text(entry.schedule),
      active: entry.active === true,
      lastRunAt: text(entry.last_run_at),
      lastStatus: text(entry.last_status),
      failed24h: count(entry.failed_24h),
      lastFailureMessage: text(entry.last_failure_message),
    }];
  });
}

function hoursSince(value: string | null, now: Date): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : (now.getTime() - time) / 3_600_000;
}

/** バッチ全体の失敗が続いている・成功が途絶えている・cronが動いていない、を警告に直す。 */
export function evaluateAlerts(health: Omit<ReviewBatchHealth, "alerts">, now: Date): ReviewBatchAlert[] {
  const alerts: ReviewBatchAlert[] = [];
  for (const kind of ["generate", "grade"] as const) {
    const batch = health[kind];
    const label = KIND_LABEL[kind];
    if (batch.consecutiveFailures >= FAILURE_STREAK_LIMIT) {
      const note = batch.lastFailureNote ? `（${batch.lastFailureNote}）` : "";
      alerts.push({ code: `${kind}_failing`, message: `${label}のバッチが${batch.consecutiveFailures}回続けて失敗しています${note}` });
    }
    const idle = hoursSince(batch.lastOkAt, now);
    if (idle === null) {
      alerts.push({ code: `${kind}_stale`, message: `${label}のバッチの成功記録がありません。` });
    } else if (idle >= STALE_HOURS[kind]) {
      alerts.push({ code: `${kind}_stale`, message: `${label}のバッチが${Math.floor(idle)}時間以上成功していません。` });
    }
    const job = health.cron.find((entry) => entry.jobname === CRON_JOBS[kind]);
    if (!job || !job.active) {
      alerts.push({ code: "cron_missing", message: `${label}の定期実行（${CRON_JOBS[kind]}）が登録されていないか、止まっています。` });
    } else if (job.lastStatus === "failed") {
      const reason = job.lastFailureMessage ? `（${job.lastFailureMessage}）` : "";
      alerts.push({ code: "cron_failing", message: `${label}の定期実行ジョブが直近で失敗しています${reason}` });
    } else {
      const since = hoursSince(job.lastRunAt, now);
      if (since === null || since >= CRON_STALE_HOURS[kind]) {
        alerts.push({ code: "cron_stale", message: `${label}の定期実行ジョブが${CRON_STALE_HOURS[kind]}時間以上動いていません。` });
      }
    }
  }
  return alerts;
}

/** DB関数の応答を解釈する。形が違えばnull（接続状態の確認そのものは失敗させない）。 */
export function parseBatchHealth(data: unknown, now = new Date()): ReviewBatchHealth | null {
  if (!isRecord(data)) return null;
  const generate = parseKind(data.generate);
  const grade = parseKind(data.grade);
  if (!generate || !grade) return null;
  const base = { generate, grade, cron: parseCron(data.cron) };
  return { ...base, alerts: evaluateAlerts(base, now) };
}

export async function loadBatchHealth(env: SupabaseEnv, now = new Date()): Promise<ReviewBatchHealth | null> {
  try {
    return parseBatchHealth(await callRpc(env, "get_review_batch_health", {}), now);
  } catch {
    return null;
  }
}
