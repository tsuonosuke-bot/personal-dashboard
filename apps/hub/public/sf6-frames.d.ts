/** GET /api/sf6/moves の1件（sf6_moves を camelCase にしたもの）。 */
export interface Move {
  id?: number;
  sortOrder: number;
  category: string;
  name: string;
  command: string | null;
  startupText?: string | null;
  activeText?: string | null;
  recoveryText?: string | null;
  hitText?: string | null;
  blockText?: string | null;
  cancelText?: string | null;
  damageText?: string | null;
  notes?: string | null;
  startup: number | null;
  onHit: number | null;
  hitKnockdown: boolean;
  onBlock: number | null;
  counterOverride?: string | null;
  punishCounterOverride?: string | null;
}

/** 投入用JSONの1件（設計書 §8.2）。フレームは公式の表記のまま。 */
export interface MoveInput {
  category: string;
  name: string;
  command?: string | null;
  startup?: string | null;
  active?: string | null;
  recovery?: string | null;
  hit?: string | null;
  block?: string | null;
  cancel?: string | null;
  damage?: string | null;
  scaling?: string | null;
  driveGain?: string | null;
  driveLoss?: string | null;
  saGain?: string | null;
  attribute?: string | null;
  notes?: string | null;
  counterOverride?: string | null;
  punishCounterOverride?: string | null;
}

export interface ParsedFrame { value: number | null; min: number | null; max: number | null; knockdown: boolean }

export declare const PUNISHABLE_AT: number;
export declare const HEAVY_PUNISH_AT: number;
export declare const COUNTER_BONUS: number;
export declare const PUNISH_COUNTER_BONUS: number;
export declare const CATEGORIES: string[];
export declare function parseFrameText(text: string | null | undefined, kind: "startup" | "advantage"): ParsedFrame;
export declare function formatAdvantage(text: string | null | undefined): string;
export declare function counterText(move: Move): { text: string; overridden: boolean };
export declare function punishCounterText(move: Move): { text: string; overridden: boolean };
export declare function punishLevel(move: Pick<Move, "onBlock">): "heavy" | "light" | null;
export declare function normalizeQuery(text: string | null | undefined): string;
export declare function searchMoves<T extends Move>(moves: T[], options?: { query?: string; category?: string; punishableOnly?: boolean; cancelableOnly?: boolean; sort?: "official" | "startup" | "block" }): T[];
export declare function starterMove<T extends Move>(notation: string, moves: T[]): T | null;
export declare function defaultStateName(notation: string, moves: Move[]): string | null;
export declare function toMoveRow(input: MoveInput, sortOrder: number): { row: Record<string, unknown>; errors: string[] };
