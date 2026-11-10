import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const [source, built, ...args] = process.argv.slice(2);

if (!source || !built) {
  console.error('Usage: node scripts/run-cli.mjs <source.ts> <built.js> [args...]');
  process.exit(1);
}

const tsx = path.join('node_modules', '.bin', 'tsx');
const useBuilt = !existsSync(tsx);
const command = useBuilt ? process.execPath : tsx;
const target = useBuilt ? built : source;

const result = spawnSync(
  command,
  [
    '--env-file-if-exists=.env',
    '--env-file-if-exists=.env.local',
    target,
    ...args,
  ],
  { stdio: 'inherit' },
);

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
