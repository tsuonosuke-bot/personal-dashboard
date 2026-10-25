import type { PlanResult, PlanSequence, PlanSituation } from "./sf6-plan.js";

export declare const NODE_W: number;
export declare const NODE_H: number;
export declare const STUB_W: number;
export declare const STUB_H: number;

export interface FlowExit extends PlanResult {}
export interface FlowRef { sequenceId: number; resultKind: "hit" | "counter_hit" | "punish_counter" | "hit_other" | "guard" | "opponent"; opponentAction: string | null; nextSituationId: number }
export interface FlowNode { id: number; title: string; startLabel: string; collapsible: boolean; collapsed: boolean; hiddenCount: number; col: number; x: number; y: number; w: number; h: number; loop: boolean }
export interface FlowEdge extends FlowRef {
  from: number; to: number; label: string;
  x1: number; y1: number; x2: number; y2: number;
}
export interface FlowStub extends FlowRef {
  type: "unset" | "dead" | "loop"; label: string; situationId?: number; targetId?: number; targetTitle?: string;
  col: number; x: number; y: number; w: number; h: number; x1: number; y1: number; x2: number; y2: number;
}
export interface FlowLink { from: number; to: number; resultKind: FlowRef["resultKind"]; opponentAction: string | null; nextSituationId: number }
export interface Flow { nodes: FlowNode[]; edges: FlowEdge[]; links: FlowLink[]; stubs: FlowStub[]; width: number; height: number; unsetCount: number }

export declare function exitsOf(sequence: PlanSequence): FlowExit[];
export declare function buildFlow(options: {
  sequences: PlanSequence[];
  situations: PlanSituation[];
  character: string;
  startSituationId?: number | null;
  collapsed?: number[];
  hideUnset?: boolean;
  resultLabel: (exit: FlowExit) => string;
}): Flow;
