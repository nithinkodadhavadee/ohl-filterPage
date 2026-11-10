import { describe, expect, it, vi } from 'vitest';
import { createShutdownHandler } from '../src/server/shutdown.js';

describe('graceful shutdown', () => {
  it('logs the signal, closes, releases the lock and exits 0', async () => {
    const events: string[] = [];
    const shutdown = createShutdownHandler({
      close: async () => {
        events.push('close');
      },
      releaseLock: () => {
        events.push('release');
      },
      log: (message) => {
        events.push(`log:${message}`);
      },
      logError: () => {
        events.push('error');
      },
      exit: (code) => {
        events.push(`exit:${code}`);
      },
    });

    await shutdown('SIGTERM');

    expect(events).toEqual([
      'log:Received SIGTERM, shutting down',
      'close',
      'release',
      'exit:0',
    ]);
  });

  it('logs a close failure but still releases the lock and exits 0', async () => {
    const events: string[] = [];
    const failure = new Error('close failed');
    const shutdown = createShutdownHandler({
      close: async () => {
        throw failure;
      },
      releaseLock: () => {
        events.push('release');
      },
      log: () => {},
      logError: (error) => {
        events.push(`error:${(error as Error).message}`);
      },
      exit: (code) => {
        events.push(`exit:${code}`);
      },
    });

    await shutdown('SIGINT');

    expect(events).toEqual([
      'error:close failed',
      'release',
      'exit:0',
    ]);
  });

  it('logs a lock release failure and still exits 0', async () => {
    const events: string[] = [];
    const shutdown = createShutdownHandler({
      close: async () => {},
      releaseLock: () => {
        throw new Error('release failed');
      },
      log: () => {},
      logError: (error) => {
        events.push(`error:${(error as Error).message}`);
      },
      exit: (code) => {
        events.push(`exit:${code}`);
      },
    });

    await shutdown('SIGTERM');

    expect(events).toEqual(['error:release failed', 'exit:0']);
  });

  it('ignores a second signal while shutdown is in progress', async () => {
    let finishClose: () => void = () => {};
    const closeGate = new Promise<void>((resolve) => {
      finishClose = resolve;
    });
    const close = vi.fn(() => closeGate);
    const releaseLock = vi.fn();
    const exit = vi.fn();
    const shutdown = createShutdownHandler({
      close,
      releaseLock,
      log: () => {},
      logError: () => {},
      exit,
    });

    const first = shutdown('SIGINT');
    const second = shutdown('SIGTERM');

    expect(close).toHaveBeenCalledTimes(1);
    finishClose();
    await Promise.all([first, second]);

    expect(close).toHaveBeenCalledTimes(1);
    expect(releaseLock).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });
});
