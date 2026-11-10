export interface ShutdownOptions {
  close: () => Promise<void>;
  releaseLock: () => void;
  log: (message: string) => void;
  logError: (error: unknown) => void;
  exit: (code: number) => void;
}

export function createShutdownHandler(
  options: ShutdownOptions,
): (signal: string) => Promise<void> {
  let inFlight: Promise<void> | null = null;

  return (signal: string): Promise<void> => {
    if (inFlight !== null) return inFlight;

    inFlight = (async () => {
      options.log(`Received ${signal}, shutting down`);
      try {
        await options.close();
      } catch (error) {
        options.logError(error);
      } finally {
        try {
          options.releaseLock();
        } catch (error) {
          options.logError(error);
        }
        options.exit(0);
      }
    })();

    return inFlight;
  };
}
