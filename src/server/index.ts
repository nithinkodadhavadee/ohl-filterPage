import { buildApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = await buildApp({ serveStatic: true, logger: true });

const shutdown = async (signal: string): Promise<void> => {
  app.log.info(`Received ${signal}, shutting down`);
  await app.close();
  process.exit(0);
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ port: config.port, host: '127.0.0.1' });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
