export interface InboxSource { prefix?: string; label: string; url: string; knowledgeId?: string }
export function splitInboxSource(content: unknown): { body: string; source: InboxSource | null };
