export class CheckinExecutionQueue {
  private tail: Promise<void> = Promise.resolve();

  enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

export async function settleCheckinsSequentially<T, R>(
  items: readonly T[],
  operation: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = [];
  for (const item of items) {
    try {
      results.push({ status: "fulfilled", value: await operation(item) });
    } catch (reason) {
      results.push({ status: "rejected", reason });
    }
  }
  return results;
}
