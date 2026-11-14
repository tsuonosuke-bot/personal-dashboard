export const HOME_HIDDEN_KEY: string;
export function parseHidden(value: unknown): string[];
export function hubUrl(hidden: string[]): string;
export function revealedSections(previous: string[], next: string[]): string[];
export function sameSections(left: string[], right: string[]): boolean;
