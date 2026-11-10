export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function sleep(
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }

    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };

    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
