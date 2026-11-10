import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { acquireServerLock, releaseServerLock } from './server-lock.js';
import { createShutdownHandler } from './shutdown.js';

const config = loadConfig();
acquireServerLock(config);

const app = await buildApp({
  serveStatic: true,
  logger: true,
  crawler: config.crawlerEnabled,
}).catch((error) => {
  releaseServerLock(config);
  throw error;
});

const shutdown = createShutdownHandler({
  close: () => app.close(),
  releaseLock: () => releaseServerLock(config),
  log: (message) => app.log.info(message),
  logError: (error) => app.log.error(error),
  exit: (code) => process.exit(code),
});

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ port: config.port, host: config.host });
} catch (error) {
  app.log.error(error);
  releaseServerLock(config);
  process.exit(1);
}
