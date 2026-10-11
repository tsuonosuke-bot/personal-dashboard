export interface PlanCombo {
  id: number;
  character: string;
  position: string;
  situations: string[];
  driveCost: number;
  saCost: number;
  burnoutOk: boolean;
  endAdvantage: number | null;
  recovery: string | null;
  mastery: number;
  damage?: number | null;
}

export interface PlanSetplay {
  id: number;
  character: string;
  title: string;
  comboIds: number[];
  startAdvantage: number;
  position: string;
  recovery: string;
  archived: boolean;
}

export interface PlanConditions {
  situation?: string;
  position?: string;
  drive?: number | null;
  sa?: number | null;
  ca?: boolean;
  burnout?: boolean;
}

export declare const SITUATION_PRESETS: string[];
export declare const MASTERY: string[];
export declare const STREAK_GOAL: number;
export declare const NEAR_FRAMES: number;
export declare function situationOptions(combos: Pick<PlanCombo, "situations">[]): string[];
export declare function usableNow(combo: PlanCombo, conditions: PlanConditions): boolean;
export declare function setplayFit(combo: PlanCombo, setplay: PlanSetplay): "linked" | "exact" | "near" | null;
export declare function setplaysAfter(combo: PlanCombo, setplays: PlanSetplay[]): { setplay: PlanSetplay; fit: "linked" | "exact" | "near" }[];
export declare function bestStreakOf(logs: { bestStreak?: number | null }[]): number;
export declare function shouldRaiseMastery(target: { mastery: number } | null, logs: { bestStreak?: number | null }[]): boolean;
