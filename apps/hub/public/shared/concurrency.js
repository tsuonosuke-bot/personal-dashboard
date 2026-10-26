/** Bounded browser work queue. Check cancellation before starting each new item. */
export async function mapConcurrent(values, limit, run, shouldStop = () => false) {
  const results = new Array(values.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(values.length, Math.max(1, limit)) }, async () => {
      while (next < values.length && !shouldStop()) {
        const index = next++;
        try {
          results[index] = { status: "fulfilled", value: await run(values[index], index) };
        } catch (reason) {
          results[index] = { status: "rejected", reason };
        }
      }
    }),
  );
  return results;
}
