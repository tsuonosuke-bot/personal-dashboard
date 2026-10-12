export declare const ARROWS: Record<string, string>;
export declare const LINKS: Record<string, { label: string; kind: string; title: string }>;

export type NotationPart =
  | { type: "command"; jump: boolean; arrows: string[]; button: string; strength: "light" | "medium" | "heavy" | "od" | "any"; limb: "punch" | "kick" }
  | { type: "motion"; jump: boolean; arrows: string[] }
  | { type: "link"; label: string; kind: string; title: string }
  | { type: "text"; text: string };

export declare function appendToken(text: string, token: string): string;
export declare function removeLastToken(text: string): string;
export declare function parseNotation(text: string): NotationPart[];
export declare function frequentFragments(notations: string[], limit?: number): string[];
export declare function appendFragment(text: string, fragment: string): string;
