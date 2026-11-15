export interface HomeInboxItem {
  id: number;
  url?: string;
  content: string;
  status?: string;
  result?: string | null;
  createdAt?: string | null;
  ageDays?: number | null;
}
export interface HomeInboxState { pending: number; items: HomeInboxItem[] }
export interface InboxSnapshot { content: string; status: string; result: string | null }
export const INBOX_PREVIEW: number;
export const HOME_SKIP_RESULT: string;
export function inboxSnapshot(item: HomeInboxItem): InboxSnapshot;
export function skipRequest(item: HomeInboxItem): { id: number; content: string; status: "skipped"; result: string; original: InboxSnapshot };
export function restoreRequest(item: HomeInboxItem): { id: number; content: string; status: string; result: string | null; original: InboxSnapshot };
export function withAdded(state: HomeInboxState, row: { id: number; content: string; result?: string | null; created_at?: string | null }): HomeInboxState;
export function withRemoved(state: HomeInboxState, id: number): HomeInboxState;
export function inboxMetaLabel(pending: unknown, untriagedWants: unknown): string;
