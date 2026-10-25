import type { PlanResult, PlanSequence, PlanSituation } from "./sf6-plan.js";

export declare const NODE_W: number;
export declare const NODE_H: number;
export declare const STUB_W: number;
export declare const STUB_H: number;

export interface FlowExit extends PlanResult {}
export interface FlowRef { sequenceId: number; resultKind: "hit" | "counter_hit" | "guard" | "opponent"; opponentAction: string | null }
export interface FlowNode { id: number; title: string; kind: "combo" | "setplay"; col: number; x: number; y: number; w: number; h: number; loop: boolean }
export interface FlowEdge extends FlowRef {
  from: number; to: number; label: string; fit: "same" | "fits" | "near";
  x1: number; y1: number; x2: number; y2: number; back: boolean;
}
export interface FlowStub extends FlowRef {
  type: "unset" | "dead"; label: string; situationId?: number;
  col: number; x: number; y: number; w: number; h: number; x1: number; y1: number; x2: number; y2: number;
}
export interface Flow { nodes: FlowNode[]; edges: FlowEdge[]; stubs: FlowStub[]; width: number; height: number; unsetCount: number }

export declare function exitsOf(sequence: PlanSequence): FlowExit[];
export declare function buildFlow(options: {
  sequences: PlanSequence[];
  situations: PlanSituation[];
  character: string;
  startSituationId?: number | null;
  includeNear?: boolean;
  resultLabel: (exit: FlowExit) => string;
}): Flow;
