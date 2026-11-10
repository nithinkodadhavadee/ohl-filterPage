import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { acquireServerLock, releaseServerLock } from './server-lock.js';

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

const shutdown = async (signal: string): Promise<void> => {
  app.log.info(`Received ${signal}, shutting down`);
  await app.close();
  releaseServerLock(config);
  process.exit(0);
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ port: config.port, host: '127.0.0.1' });
} catch (error) {
  app.log.error(error);
  releaseServerLock(config);
  process.exit(1);
}
