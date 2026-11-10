import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/server/config.js';

const dataDir = path.join(tmpdir(), 'open-house-config');
const originalHost = process.env.HOST;

afterEach(() => {
  if (originalHost === undefined) {
    delete process.env.HOST;
  } else {
    process.env.HOST = originalHost;
  }
});

describe('HOST', () => {
  it('defaults to loopback for local use', () => {
    delete process.env.HOST;
    expect(loadConfig({ dataDir }).host).toBe('127.0.0.1');
  });

  it('reads the bind host from the environment', () => {
    process.env.HOST = '0.0.0.0';
    expect(loadConfig({ dataDir }).host).toBe('0.0.0.0');
  });

  it('accepts an explicit override', () => {
    process.env.HOST = '0.0.0.0';
    expect(loadConfig({ dataDir, host: '192.0.2.10' }).host).toBe('192.0.2.10');
  });
});
