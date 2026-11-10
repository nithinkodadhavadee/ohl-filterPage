import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { AppConfig } from './config.js';

export const SERVER_HEARTBEAT_INTERVAL_MS = 10_000;
export const SERVER_LOCK_FRESH_MS = 30_000;

export interface ServerLockInfo {
  pid: number;
  heartbeatAt: string;
}

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

export function serverLockPath(config: AppConfig): string {
  return path.join(config.dataDir, 'server.lock');
}

function parseServerLock(raw: string): ServerLockInfo | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object') {
      const { pid, heartbeatAt } = parsed as {
        pid?: unknown;
        heartbeatAt?: unknown;
      };
      if (typeof pid === 'number' && Number.isInteger(pid) && pid > 0) {
        return {
          pid,
          heartbeatAt:
            typeof heartbeatAt === 'string' ? heartbeatAt : '',
        };
      }
    }
  } catch {
    // Older locks stored only the PID.
  }

  const pid = Number.parseInt(trimmed, 10);
  if (Number.isInteger(pid) && pid > 0) {
    return { pid, heartbeatAt: '' };
  }
  return null;
}

export function readServerLock(config: AppConfig): ServerLockInfo | null {
  let raw: string;
  try {
    raw = readFileSync(serverLockPath(config), 'utf8');
  } catch {
    return null;
  }
  return parseServerLock(raw);
}

export function readServerLockPid(config: AppConfig): number | null {
  return readServerLock(config)?.pid ?? null;
}

export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function heartbeatIsFresh(
  lock: ServerLockInfo,
  nowMs: number,
): boolean {
  const heartbeatMs = Date.parse(lock.heartbeatAt);
  if (!Number.isFinite(heartbeatMs)) return false;
  return nowMs - heartbeatMs < SERVER_LOCK_FRESH_MS;
}

export function isServerRunning(
  config: AppConfig,
  nowMs: number = Date.now(),
): boolean {
  const lock = readServerLock(config);
  return lock !== null && heartbeatIsFresh(lock, nowMs);
}

function writeHeartbeat(
  config: AppConfig,
  pid: number,
  now: Date = new Date(),
): void {
  writeFileSync(
    serverLockPath(config),
    `${JSON.stringify({ pid, heartbeatAt: now.toISOString() })}\n`,
    'utf8',
  );
}

function stopHeartbeat(): void {
  if (heartbeatTimer !== null) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

export function acquireServerLock(
  config: AppConfig,
  pid: number = process.pid,
  now: () => Date = () => new Date(),
): void {
  mkdirSync(config.dataDir, { recursive: true });

  const existing = readServerLock(config);
  if (
    existing !== null &&
    existing.pid !== pid &&
    heartbeatIsFresh(existing, now().getTime())
  ) {
    throw new Error(
      `Refusing to start: the server is already running (PID ${existing.pid}).`,
    );
  }

  writeHeartbeat(config, pid, now());
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    try {
      writeHeartbeat(config, pid);
    } catch {
      // The next heartbeat retries; a write failure must not crash the server.
    }
  }, SERVER_HEARTBEAT_INTERVAL_MS);
  heartbeatTimer.unref?.();
}

export function releaseServerLock(
  config: AppConfig,
  pid: number = process.pid,
): boolean {
  const recorded = readServerLockPid(config);
  if (recorded !== null && recorded !== pid) return false;

  stopHeartbeat();
  try {
    unlinkSync(serverLockPath(config));
    return true;
  } catch {
    return false;
  }
}

export function clearStaleServerLock(config: AppConfig): boolean {
  if (isServerRunning(config)) return false;

  stopHeartbeat();
  try {
    unlinkSync(serverLockPath(config));
    return true;
  } catch {
    return false;
  }
}
