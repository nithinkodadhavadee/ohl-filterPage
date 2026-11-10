import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { AppConfig } from './config.js';

export function serverLockPath(config: AppConfig): string {
  return path.join(config.dataDir, 'server.lock');
}

export function readServerLockPid(config: AppConfig): number | null {
  let raw: string;
  try {
    raw = readFileSync(serverLockPath(config), 'utf8').trim();
  } catch {
    return null;
  }

  const pid = Number.parseInt(raw, 10);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
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

export function isServerRunning(config: AppConfig): boolean {
  const pid = readServerLockPid(config);
  return pid !== null && isProcessAlive(pid);
}

export function acquireServerLock(
  config: AppConfig,
  pid: number = process.pid,
): void {
  mkdirSync(config.dataDir, { recursive: true });
  writeFileSync(serverLockPath(config), `${pid}\n`, 'utf8');
}

export function releaseServerLock(
  config: AppConfig,
  pid: number = process.pid,
): boolean {
  const recorded = readServerLockPid(config);
  if (recorded !== null && recorded !== pid) return false;

  try {
    unlinkSync(serverLockPath(config));
    return true;
  } catch {
    return false;
  }
}

export function clearStaleServerLock(config: AppConfig): boolean {
  if (isServerRunning(config)) return false;
  return releaseServerLock(config, readServerLockPid(config) ?? process.pid);
}
