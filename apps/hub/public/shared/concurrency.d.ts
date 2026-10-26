export function mapConcurrent<T, R>(
  values: T[],
  limit: number,
  run: (value: T, index: number) => Promise<R>,
  shouldStop?: () => boolean,
): Promise<Array<PromiseSettledResult<R> | undefined>>;
