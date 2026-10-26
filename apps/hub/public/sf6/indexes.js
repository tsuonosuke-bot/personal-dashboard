import { buildSequenceStartIndex } from "../sf6-plan.js";

/** データ更新ごとに一度だけ作る。配列をその場で更新する保存でも明示的に無効化する。 */
export function createSf6IndexCache(readData) {
  let previous = null;
  let value = null;
  return {
    invalidate() { previous = null; value = null; },
    get() {
      const data = readData();
      if (!value || previous !== data) { value = createSf6Indexes(data); previous = data; }
      return value;
    },
  };
}

export function createSf6Indexes(data) {
  const situations = new Map(data.situations.map((entry) => [entry.id, entry]));
  const sequences = new Map(data.sequences.map((entry) => [entry.id, entry]));
  const starts = buildSequenceStartIndex(data.sequences);
  const activeDrills = new Map();
  const logs = new Map();
  const usage = new Map();
  const maxAdvantages = new Map();
  for (const drill of data.drills || []) {
    if (drill.status !== "active") continue;
    for (const id of drill.sequenceIds) if (!activeDrills.has(id)) activeDrills.set(id, drill);
  }
  for (const log of data.logs || []) {
    if (!logs.has(log.drillId)) logs.set(log.drillId, []);
    logs.get(log.drillId).push(log);
  }
  const usageFor = (id) => {
    if (!usage.has(id)) usage.set(id, { starts: 0, results: 0, sequenceIds: [], orphaned: 0 });
    return usage.get(id);
  };
  for (const sequence of data.sequences) {
    const used = new Set();
    let maximum = -Infinity;
    for (const id of new Set(sequence.starts)) {
      const entry = usageFor(id);
      entry.starts += 1;
      if (sequence.starts.length === 1) entry.orphaned += 1;
      maximum = Math.max(maximum, situations.get(id)?.advantage ?? -Infinity);
      used.add(id);
    }
    for (const result of sequence.results) {
      usageFor(result.nextSituationId).results += 1;
      used.add(result.nextSituationId);
    }
    for (const id of used) usageFor(id).sequenceIds.push(sequence.id);
    maxAdvantages.set(sequence.id, maximum);
  }
  const from = (situation, character = null) => (starts.get(situation.id) || [])
    .filter((sequence) => !character || sequence.character === character)
    .map((sequence) => ({ sequence, via: situation }));
  return {
    situations, sequences, starts, activeDrills, logs, maxAdvantages,
    from,
    usage: (id) => usage.get(id) || { starts: 0, results: 0, sequenceIds: [], orphaned: 0 },
    partsAfter(part) {
      const found = new Map();
      for (const result of part.results) {
        if (result.kind !== "hit") continue;
        const situation = situations.get(result.nextSituationId);
        if (!situation) continue;
        for (const entry of from(situation, part.character)) {
          if (entry.sequence.id !== part.id && !found.has(entry.sequence.id)) found.set(entry.sequence.id, entry);
        }
      }
      return [...found.values()];
    },
  };
}
