// SF6の手順をフローチャートにする計算（描画はしない）。
// 箱＝手順、矢印＝結果（ヒット・ガード・相手の行動）。結果の「次の状況」から始まる手順へ矢印を引く。
// 次の状況が未設定の結果と、次の状況に続く手順がない結果は、点線の「出口」として出す。
import { OPPONENT_OPTIONS, sequencesFrom, buildSequenceStartIndex } from "./sf6-plan.js";

export const NODE_W = 168;
export const NODE_H = 52;
export const STUB_W = 132;
export const STUB_H = 34;
export const COL_GAP = 96;
export const ROW_GAP = 18;
export const PAD = 16;

const EXIT_ORDER = ["hit", "counter_hit", "punish_counter", "hit_other", "guard", ...OPPONENT_OPTIONS];

/** 1つの手順から出る結果の一覧。コンボはヒット、起き攻めはヒット・ガードが無ければ「未設定」で足す（カウンターヒット・パニッシュカウンター・その他のヒットは入力したときだけ出る）。 */
export function exitsOf(sequence) {
  const exits = sequence.results.map((result) => ({
    kind: result.kind, opponentAction: result.opponentAction ?? null, outcome: result.outcome ?? null,
    nextSituationId: result.nextSituationId ?? null,
  }));
  for (const kind of ["hit"]) {
    if (!exits.some((exit) => exit.kind === kind)) exits.push({ kind, opponentAction: null, outcome: null, nextSituationId: null });
  }
  const rank = (exit) => EXIT_ORDER.indexOf(exit.kind === "opponent" ? exit.opponentAction : exit.kind);
  return exits.sort((a, b) => rank(a) - rank(b));
}

const byIdAsc = (a, b) => a.id - b.id;

/**
 * options: { sequences, situations, character, startSituationId = null, resultLabel(exit) }
 * startSituationId を渡すと、その状況から始まる手順につながる範囲だけを出す。
 * collapsed（手順の id の配列）の手順は、そこから先の分岐（ほかの道では辿れない手順と出口）を隠す。
 * hideUnset=true にすると、次の状況が未設定の出口（赤い枠）を出さない。
 * 返す座標は SVG にそのまま使える（左上が原点）。
 */
export function buildFlow({ sequences, situations, character, startSituationId = null, collapsed = [], hideUnset = false, resultLabel }) {
  const situationById = new Map(situations.map((situation) => [situation.id, situation]));
  const mine = sequences.filter((sequence) => sequence.character === character && !sequence.archived);
  const byId = new Map(mine.map((sequence) => [sequence.id, sequence]));
  const startIndex = buildSequenceStartIndex(mine);

  // 矢印と出口を先に全部作る。次の状況に続く手順は、その結果1つにつき矢印1本
  const edges = [];
  const stubs = [];
  const loops = new Set();
  for (const sequence of mine) {
    for (const exit of exitsOf(sequence)) {
      const label = resultLabel(exit);
      const ref = { sequenceId: sequence.id, resultKind: exit.kind, opponentAction: exit.opponentAction };
      const next = situationById.get(exit.nextSituationId);
      if (!next) {
        stubs.push({ ...ref, label, type: "unset" });
        continue;
      }
      const found = sequencesFrom(next, mine, startIndex);
      if (found.some((entry) => entry.sequence.id === sequence.id)) loops.add(sequence.id);
      const targets = found.filter((entry) => entry.sequence.id !== sequence.id);
      if (!targets.length) stubs.push({ ...ref, label, type: "dead", situationId: next.id });
      for (const { sequence: target } of targets) edges.push({ ...ref, from: sequence.id, to: target.id, label, nextSituationId: next.id });
    }
  }

  const outgoing = new Map(mine.map((sequence) => [sequence.id, []]));
  edges.forEach((edge) => outgoing.get(edge.from).push(edge));
  const hasIncoming = new Set(edges.map((edge) => edge.to));
  const folded = new Set(collapsed);
  const descendantsOf = (id) => {
    const seen = new Set();
    const queue = [id];
    while (queue.length) {
      for (const edge of outgoing.get(queue.shift()) || []) {
        if (seen.has(edge.to)) continue;
        seen.add(edge.to);
        queue.push(edge.to);
      }
    }
    return seen;
  };
  // 畳んだ手順より先にある手順（畳んだ手順自身は除く）。ほかの道で辿れないものは、循環の拾い直しでも出さない
  const shadow = new Set();
  for (const id of folded) for (const target of descendantsOf(id)) if (!folded.has(target)) shadow.add(target);

  // 起点から幅優先で桁（左から右）を決める。循環だけの手順は、残った最小idを起点にして拾う
  const column = new Map();
  const order = [];
  const walk = (roots) => {
    const queue = [];
    for (const root of roots) {
      if (column.has(root.id)) continue;
      column.set(root.id, 0);
      order.push(root);
      queue.push(root);
    }
    while (queue.length) {
      const current = queue.shift();
      if (folded.has(current.id)) continue;
      for (const edge of outgoing.get(current.id)) {
        if (column.has(edge.to)) continue;
        column.set(edge.to, column.get(current.id) + 1);
        const target = byId.get(edge.to);
        order.push(target);
        queue.push(target);
      }
    }
  };
  if (startSituationId !== null && situationById.has(startSituationId)) {
    walk(sequencesFrom(situationById.get(startSituationId), mine, startIndex).map((entry) => entry.sequence));
  } else {
    walk(mine.filter((sequence) => !hasIncoming.has(sequence.id)).sort(byIdAsc));
    for (const sequence of [...mine].sort(byIdAsc)) if (!column.has(sequence.id) && !shadow.has(sequence.id)) walk([sequence]);
  }

  // 前の桁（または同じ桁）の手順へ戻る矢印は、図を横切らせない。戻り先を示す小さな枠（出口）にする
  const isBack = (edge) => column.has(edge.from) && column.has(edge.to) && column.get(edge.to) <= column.get(edge.from);
  const forwardEdges = edges.filter((edge) => !isBack(edge));
  for (const edge of edges.filter(isBack)) {
    stubs.push({ sequenceId: edge.from, resultKind: edge.resultKind, opponentAction: edge.opponentAction, label: edge.label, type: "loop", targetId: edge.to, targetTitle: byId.get(edge.to).title });
  }

  // 行：桁ごとに、手順を見つけた順、その下に出口を手順の並び順で
  const nodeRow = new Map();
  const perColumn = new Map();
  for (const sequence of order) {
    const col = column.get(sequence.id);
    perColumn.set(col, [...(perColumn.get(col) || []), sequence]);
  }
  const visibleStubs = stubs.filter((stub) => column.has(stub.sequenceId) && !folded.has(stub.sequenceId));
  const shownStubs = hideUnset ? visibleStubs.filter((stub) => stub.type !== "unset") : visibleStubs;
  const stubColumns = new Map();
  const orderIndex = new Map(order.map((sequence, index) => [sequence.id, index]));
  for (const stub of [...shownStubs].sort((a, b) => orderIndex.get(a.sequenceId) - orderIndex.get(b.sequenceId))) {
    const col = column.get(stub.sequenceId) + 1;
    stubColumns.set(col, [...(stubColumns.get(col) || []), stub]);
  }

  const maxCol = Math.max(-1, ...perColumn.keys(), ...stubColumns.keys());
  const colX = (col) => PAD + col * (NODE_W + COL_GAP);
  const nodes = [];
  const sequencesWithStubs = new Set(stubs.map((stub) => stub.sequenceId));
  let bottom = 0;
  for (let col = 0; col <= maxCol; col += 1) {
    let y = PAD;
    for (const sequence of perColumn.get(col) || []) {
      nodes.push({ id: sequence.id, title: sequence.title, startLabel: situationById.get(sequence.starts[0])?.name || "", col, x: colX(col), y, w: NODE_W, h: NODE_H, loop: loops.has(sequence.id),
        collapsible: outgoing.get(sequence.id).length > 0 || sequencesWithStubs.has(sequence.id),
        collapsed: folded.has(sequence.id),
        hiddenCount: folded.has(sequence.id) ? [...descendantsOf(sequence.id)].filter((id) => !column.has(id)).length : 0 });
      nodeRow.set(sequence.id, y);
      y += NODE_H + ROW_GAP;
    }
    for (const stub of stubColumns.get(col) || []) {
      Object.assign(stub, { col, x: colX(col), y, w: STUB_W, h: STUB_H });
      y += STUB_H + ROW_GAP;
    }
    bottom = Math.max(bottom, y);
  }

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  // 同じ手順から同じ手順へ向かう複数の結果（暴れ・バクステなど）は、重ならないよう1本の矢印にまとめ、結果名を並べる
  const merged = new Map();
  for (const edge of forwardEdges.filter((entry) => nodeById.has(entry.from) && nodeById.has(entry.to))) {
    const key = `${edge.from}>${edge.to}`;
    const found = merged.get(key);
    if (!found) merged.set(key, { ...edge, labels: [edge.label] });
    else if (!found.labels.includes(edge.label)) found.labels.push(edge.label);
  }
  const placedEdges = [...merged.values()].map((edge) => {
    const from = nodeById.get(edge.from);
    const to = nodeById.get(edge.to);
    return { ...edge, label: edge.labels.join("・"), x1: from.x + from.w, y1: from.y + from.h / 2, x2: to.x, y2: to.y + to.h / 2 };
  });
  const placedStubs = shownStubs.map((stub) => {
    const from = nodeById.get(stub.sequenceId);
    return { ...stub, x1: from.x + from.w, y1: from.y + from.h / 2, x2: stub.x, y2: stub.y + stub.h / 2 };
  });
  return {
    nodes, edges: placedEdges, stubs: placedStubs,
    /** 手順どうしのつながり（戻る矢印も含む）。図の矢印とは別に、詳細の「前」「続き」に使う。 */
    links: edges.filter((edge) => column.has(edge.from) && column.has(edge.to)).map((edge) => ({ from: edge.from, to: edge.to, resultKind: edge.resultKind, opponentAction: edge.opponentAction, nextSituationId: edge.nextSituationId })),
    width: maxCol < 0 ? 0 : colX(maxCol) + (stubColumns.has(maxCol) && !perColumn.has(maxCol) ? STUB_W : NODE_W) + PAD,
    height: bottom + PAD - ROW_GAP,
    unsetCount: visibleStubs.filter((stub) => stub.type === "unset").length,
  };
}
