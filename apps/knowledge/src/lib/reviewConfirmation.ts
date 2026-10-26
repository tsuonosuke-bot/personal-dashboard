import type { QuizLog, ReviewConfirmation } from "../types.ts";
import type { ReviewConfirmationState } from "./learningReadApi.ts";

export const CONFIRM_CHUNK_SIZE = 200;

export type ReviewLogReloadResult =
  | { ok: true; quizLog: ReviewConfirmationState[] }
  | { ok: false; error: string };

export interface ConfirmationProgress {
  total: number;
  confirmedIds: number[];
  phase: "confirming" | "refreshing";
}

export interface ConfirmationRunResult {
  /** 実行開始時に固定した全ページの対象。再試行でも追加しない。 */
  targetIds: number[];
  confirmedIds: number[];
  excludedIds: number[];
  remainingIds: number[];
  /** 全件ログの再取得に成功し、対象全ての現在の状態を照合できたか。 */
  verified: boolean;
  error: string | null;
}

export function isUnconfirmedResult(entry: QuizLog): boolean {
  return entry.review_queue_id !== null && entry.confirmed_at === null;
}

/** 表示ページとは独立した、現在の検索条件に一致する未確認ID集合。 */
export function unconfirmedResultIds(entries: QuizLog[], confirmedIds: ReadonlySet<number> = new Set()): number[] {
  return [...new Set(entries.filter((entry) => isUnconfirmedResult(entry) && !confirmedIds.has(entry.id))
    .map((entry) => entry.id))];
}

function reconcile(targetIds: number[], quizLog: ReviewConfirmationState[]) {
  const byId = new Map(quizLog.map((entry) => [entry.id, entry]));
  const confirmedIds: number[] = [];
  const excludedIds: number[] = [];
  const remainingIds: number[] = [];
  for (const id of targetIds) {
    const entry = byId.get(id);
    if (!entry || entry.review_queue_id === null) excludedIds.push(id);
    else if (entry.confirmed_at !== null) confirmedIds.push(id);
    else remainingIds.push(id);
  }
  return { confirmedIds, excludedIds, remainingIds };
}

/**
 * 全件と単票を同じ同期ロックで直列化する。通信中の成功分は即時反映し、
 * タイムアウト後は全件を取り直してから未確認だけを再送する。
 */
export function createReviewConfirmationCoordinator(deps: {
  confirm: (ids: number[]) => Promise<ReviewConfirmation>;
  reload: (targetIds: readonly number[]) => Promise<ReviewLogReloadResult>;
  onConfirmed?: (ids: number[]) => void;
  onProgress?: (progress: ConfirmationProgress) => void;
}) {
  let busy = false;
  return {
    get busy() { return busy; },
    async run(
      ids: readonly number[],
      options: { previous?: ConfirmationRunResult; recheckOnly?: boolean } = {},
    ): Promise<ConfirmationRunResult | null> {
      if (busy) return null;
      busy = true;
      const targetIds = [...new Set(ids)];
      let confirmedIds = options.previous?.confirmedIds.filter((id) => targetIds.includes(id)) ?? [];
      let excludedIds = options.previous?.excludedIds.filter((id) => targetIds.includes(id)) ?? [];
      let remainingIds = targetIds.filter((id) => !confirmedIds.includes(id) && !excludedIds.includes(id));
      let verified = false;
      let error: string | null = null;
      const progress = (phase: ConfirmationProgress["phase"]) => deps.onProgress?.({
        total: targetIds.length, confirmedIds: [...confirmedIds], phase,
      });
      const refresh = async () => {
        progress("refreshing");
        try {
          const result = await deps.reload(targetIds);
          if (!result.ok) throw new Error(result.error);
          ({ confirmedIds, excludedIds, remainingIds } = reconcile(targetIds, result.quizLog));
          verified = true;
          deps.onConfirmed?.(confirmedIds);
          return true;
        } catch (caught) {
          error = `最新の確認状態を取得できませんでした。${caught instanceof Error ? caught.message : "再読み込みしてください。"}`;
          return false;
        }
      };
      const result = (): ConfirmationRunResult => ({
        targetIds, confirmedIds, excludedIds, remainingIds, verified, error,
      });
      try {
        // 前回の要求がDBへ届いたか不明でも、確認済みを再送しない。
        if (options.previous || options.recheckOnly) {
          if (!await refresh() || options.recheckOnly) return result();
        }
        const pending = [...remainingIds];
        for (let start = 0; start < pending.length; start += CONFIRM_CHUNK_SIZE) {
          progress("confirming");
          verified = false;
          try {
            const receipt = await deps.confirm(pending.slice(start, start + CONFIRM_CHUNK_SIZE));
            confirmedIds = [...new Set([...confirmedIds, ...receipt.confirmedIds])];
            remainingIds = targetIds.filter((id) => !confirmedIds.includes(id) && !excludedIds.includes(id));
            deps.onConfirmed?.(receipt.confirmedIds);
            progress("confirming");
          } catch (caught) {
            error = caught instanceof Error ? caught.message : "確認済みにできませんでした。";
            break;
          }
        }
        await refresh();
        if (verified && remainingIds.length === 0) error = null;
        return result();
      } finally {
        busy = false;
      }
    },
  };
}
