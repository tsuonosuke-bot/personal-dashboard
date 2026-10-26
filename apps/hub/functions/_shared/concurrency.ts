/** Request-local bounded work queue. Results retain input order, including failures. */
export async function mapConcurrent<T, R>(
  values: readonly T[],
  limit: number,
  run: (value: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(values.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(values.length, Math.max(1, limit)) }, async () => {
      while (next < values.length) {
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
