export interface PlanSituation {
  id: number;
  character: string | null;
  kind: "trigger" | "state";
  name: string;
  presetKey?: string | null;
  advantage: number | null;
  position: string;
  recovery: string | null;
  archived?: boolean;
}

export interface PlanResult {
  kind: "hit" | "counter_hit" | "punish_counter" | "hit_other" | "guard" | "opponent";
  opponentAction: string | null;
  outcome: string | null;
  hitType?: string | null;
  nextSituationId: number | null;
}

export interface PlanSequence {
  id: number;
  character: string;
  title: string;
  notation: string;
  startup: number | null;
  driveCost: number;
  saCost: number;
  position: string;
  mastery: number;
  archived: boolean;
  starts: number[];
  results: PlanResult[];
  updatedAt?: string;
}

export interface PlanConditions {
  /** 始動の状況。"none" は始動の状況がない手順だけ。 */
  situationId?: number | "none" | null;
  position?: string;
  drive?: number | null;
  sa?: number | null;
  ca?: boolean;
  burnout?: boolean;
  /** 相手の不利F。入れると発生がこれ以下の手順だけになる。 */
  punishWindow?: number | null;
}

export type RouteStep =
  | { situationId: number }
  /** resultKind が null の要素は「この手順で終える」（道のりの最後）。 */
  | { sequenceId: number; resultKind: "hit" | "counter_hit" | "punish_counter" | "hit_other" | "guard" | "opponent" | null; opponentAction?: string | null };


export interface DrillPreset {
  title: string;
  detail: string;
  sequenceIds: number[];
  guardSetting?: string | null;
  counterSetting?: string | null;
  recoverySetting?: string | null;
  reversalRecorded?: boolean;
}

export declare const MASTERY: string[];
export declare const STREAK_GOAL: number;
export declare const PRESET: { punish: string; hitConfirm: string; counter: string; punishCounter: string };
export declare const OPPONENT_OPTIONS: string[];
export declare function usesDrive(notation: string): boolean;
export declare function usableNow(sequence: PlanSequence, conditions: PlanConditions): boolean;
export declare function sortSequences<T extends PlanSequence>(list: T[], conditions: PlanConditions, situationsById: Map<number, PlanSituation>): T[];
export declare function startSituationGroups<T extends PlanSituation>(situations: T[], sequences: PlanSequence[], character: string, selected?: number[], limit?: number): { selected: T[]; triggers: { visible: T[]; more: T[] }; states: { visible: T[]; more: T[] } };
export declare function routeBack(path: RouteStep[], index: number): { path: RouteStep[]; sequenceId: number | null } | null;
export declare function stateLabel(situation: PlanSituation): string;
export declare function findState<T extends PlanSituation>(situations: T[], key: { character: string; advantage: number; position: string; recovery: string | null }): T | null;
export declare function sequencesFrom<T extends PlanSequence>(situation: PlanSituation, sequences: T[]): { sequence: T; via: PlanSituation }[];
export declare function hasOutcomes(sequence: PlanSequence): boolean;
export declare function resultOf(sequence: PlanSequence, kind: "hit" | "guard"): PlanResult | null;
export declare function partsAfter<T extends PlanSequence>(part: PlanSequence, sequences: T[], situations: PlanSituation[]): { sequence: T }[];
export declare function situationUsage(situationId: number, sequences: PlanSequence[]): { starts: number; results: number; sequenceIds: number[]; orphaned: number };
export declare function drillPreset(sequence: PlanSequence, situationsById: Map<number, PlanSituation>): DrillPreset;
export declare function routeDrillPreset(path: RouteStep[], sequencesById: Map<number, PlanSequence>, situationsById: Map<number, PlanSituation>): DrillPreset;
export declare function bestStreakOf(logs: { bestStreak?: number | null }[]): number;
export declare function shouldRaiseMastery(target: { mastery: number } | null, logs: { bestStreak?: number | null }[]): boolean;
export declare function raiseTargets<T extends PlanSequence>(sequenceIds: number[], sequences: T[], logs: { bestStreak?: number | null }[]): T[];
export declare function defaultTitle(notation: string): string;
