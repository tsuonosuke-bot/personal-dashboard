import type { PlanSequence, PlanSituation } from '../sf6-plan.js';
type Drill = { id: number; status: string; sequenceIds: number[] };
type Log = { drillId: number };
type Data<S extends PlanSituation, Q extends PlanSequence, D extends Drill, L extends Log> = { situations: S[]; sequences: Q[]; drills?: D[]; logs?: L[] };
export declare function createSf6Indexes<S extends PlanSituation, Q extends PlanSequence, D extends Drill, L extends Log>(data: Data<S, Q, D, L>): {
  situations: Map<number, S>; sequences: Map<number, Q>; starts: Map<number, Q[]>;
  activeDrills: Map<number, D>; logs: Map<number, L[]>; maxAdvantages: Map<number, number>;
  from(situation: PlanSituation, character?: string | null): { sequence: Q; via: PlanSituation }[];
  usage(id: number | null): { starts: number; results: number; sequenceIds: number[]; orphaned: number };
  partsAfter(part: PlanSequence): { sequence: Q; via: PlanSituation }[];
};
export declare function createSf6IndexCache<S extends PlanSituation, Q extends PlanSequence, D extends Drill, L extends Log>(readData: () => Data<S, Q, D, L>): {
  invalidate(): void;
  get(): ReturnType<typeof createSf6Indexes<S, Q, D, L>>;
};
