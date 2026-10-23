export type InboxSf6Resource = "situations" | "sequences" | "drills";
export const INBOX_SF6_TYPES: Record<InboxSf6Resource, string>;
export function inboxSf6Preset(resource: InboxSf6Resource, content: string): Record<string, unknown>;
export function parseSf6Entry(href: string):
  | { type: "inbox"; inboxId: number; resource: InboxSf6Resource }
  | { type: "target"; resource: InboxSf6Resource; id: number }
  | { type: "invalid" } | null;
export interface InboxSf6Source {
  inbox: { id: number; content: string; result: string | null; status: string };
  key?: string;
  attempt?: string;
}
interface Editing {
  resource: InboxSf6Resource;
  values: Record<string, unknown>;
  item: { id: number } | null;
  inboxSource?: InboxSf6Source | null;
}
export function createSf6InboxFlow(options: {
  state: {
    editing: Editing | null;
    sequenceCharacter: string; sequenceKind: string; sequencePosition: string;
    situationCharacter: string; situationPosition: string;
    conditions: { situationId: number | null };
  };
  els: { inboxStatus: HTMLElement; inboxContext: HTMLElement; inboxBoundary: HTMLElement; saveButton: HTMLButtonElement };
  openModal: (resource: InboxSf6Resource, item: unknown, preset?: Record<string, unknown>, source?: InboxSf6Source) => void;
  closeModal: () => void;
  readDraft: () => Record<string, unknown>;
  load: () => Promise<boolean>;
  selectTab: (resource: InboxSf6Resource) => void;
  find: (resource: InboxSf6Resource, id: number) => { id: number; character?: string; kind?: string } | undefined;
  render: () => void;
  showToast: (message: string) => void;
}): { onOpened: (editing: Editing) => void; save: (resource: InboxSf6Resource, fields: Record<string, unknown>, source: InboxSf6Source) => Promise<void>; onLoaded: () => Promise<void> };
