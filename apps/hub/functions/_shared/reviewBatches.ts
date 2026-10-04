/** Knowledgeの GET /api/status が返す、生成・採点バッチの状態（reviewBatches）。 */
export interface BatchKindStatus {
  lastOkAt: string | null;
  lastRunAt: string | null;
  consecutiveFailures: number;
  failed24h: number;
  partial24h: number;
  lastFailureNote: string | null;
}

export interface CronJobStatus {
  jobname: string;
  active: boolean;
  lastRunAt: string | null;
  lastStatus: string | null;
  failed24h: number;
}

export interface ReviewBatchesStatus {
  generate: BatchKindStatus;
  grade: BatchKindStatus;
  cron: CronJobStatus[];
  alerts: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const text = (value: unknown): string | null => (typeof value === "string" ? value : null);
const count = (value: unknown): number => (Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : 0);

function readKind(value: unknown): BatchKindStatus | null {
  if (!isRecord(value)) return null;
  return {
    lastOkAt: text(value.lastOkAt),
    lastRunAt: text(value.lastRunAt),
    consecutiveFailures: count(value.consecutiveFailures),
    failed24h: count(value.failed24h),
    partial24h: count(value.partial24h),
    lastFailureNote: text(value.lastFailureNote),
  };
}

/** 形が合わない（古いKnowledgeなど）ときはnull。Hubの表示は止めない。 */
export function readReviewBatches(value: unknown): ReviewBatchesStatus | null {
  if (!isRecord(value) || !isRecord(value.reviewBatches)) return null;
  const batches = value.reviewBatches;
  const generate = readKind(batches.generate);
  const grade = readKind(batches.grade);
  if (!generate || !grade) return null;
  const cron = Array.isArray(batches.cron)
    ? batches.cron.flatMap((job): CronJobStatus[] => isRecord(job) && typeof job.jobname === "string"
      ? [{ jobname: job.jobname, active: job.active === true, lastRunAt: text(job.lastRunAt), lastStatus: text(job.lastStatus), failed24h: count(job.failed24h) }]
      : [])
    : [];
  const alerts = Array.isArray(batches.alerts)
    ? batches.alerts.flatMap((alert) => isRecord(alert) && typeof alert.message === "string" ? [alert.message] : [])
    : [];
  return { generate, grade, cron, alerts };
}
