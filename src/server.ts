import { createServer } from 'node:http';
import { createProbot, createNodeMiddleware } from 'probot';
import appFn from './index.js';
import type { AppConfig } from './types/index.js';
import { Logger, setLogger } from './utils/logger.js';
import { handleError, registerGlobalErrorHandlers } from './utils/error-handler.js';
import { DEFAULTS } from './defaults.js';

function getEnv(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

function getEnvNumber(name: string, fallback: string): number {
  const raw = getEnv(name, fallback);
  const num = Number(raw);
  if (Number.isNaN(num)) {
    throw new Error(`Environment variable ${name} must be a number, got: "${raw}"`);
  }
  return num;
}

function loadConfig(): AppConfig {
  return {
    appId: getEnvNumber('APP_ID', DEFAULTS.APP_ID),
    privateKey: getEnv('PRIVATE_KEY', DEFAULTS.PRIVATE_KEY),
    secret: getEnv('WEBHOOK_SECRET', DEFAULTS.WEBHOOK_SECRET),
    port: Number(getEnv('PORT', DEFAULTS.PORT)),
    logLevel: getEnv('LOG_LEVEL', DEFAULTS.LOG_LEVEL),
  };
}

async function main() {
  const config = loadConfig();

  // Initialize structured logger
  const logger = new Logger({ level: config.logLevel as 'info' | 'debug' | 'trace' | 'warn' | 'error' | 'fatal', json: process.env.LOG_JSON === 'true' });
  setLogger(logger);

  // Register global error handlers
  const cleanupHandlers = registerGlobalErrorHandlers();

  const probot = createProbot({
    overrides: {
      appId: config.appId,
      privateKey: config.privateKey,
      secret: config.secret,
      logLevel: config.logLevel as 'info' | 'debug' | 'trace' | 'warn' | 'error' | 'fatal',
    },
  });

  const middleware = await createNodeMiddleware(appFn, {
    probot,
    webhooksPath: '/api/github/webhooks',
  });

  const server = createServer((req, res) => {
    // Health check — no auth required
    if (req.url === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      const memUsage = process.memoryUsage();
      res.end(JSON.stringify({
        status: 'ok',
        uptime: process.uptime(),
        memory: {
          heapUsedMB: Math.round(memUsage.heapUsed / 1024 / 1024),
          heapTotalMB: Math.round(memUsage.heapTotal / 1024 / 1024),
          rssMB: Math.round(memUsage.rss / 1024 / 1024),
        },
      }));
      return;
    }

    // All other routes go through Probot webhook middleware
    // Probot automatically verifies x-hub-signature-256 here
    middleware(req, res, () => {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    });
  });

  server.listen(config.port, () => {
    logger.info(`X-Reviewer server listening on port ${config.port}`);
    logger.info(`Webhook endpoint: http://localhost:${config.port}/api/github/webhooks`);
    logger.info(`Health check: http://localhost:${config.port}/health`);
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, initiating graceful shutdown...`);

    // Stop accepting new connections
    server.close(() => {
      logger.info('HTTP server closed');
    });

    // Force exit after 10s if graceful shutdown hangs
    const forceExit = setTimeout(() => {
      logger.warn('Graceful shutdown timed out, forcing exit');
      process.exit(1);
    }, 10_000);

    // Allow forceExit timer to be cancelled by clean exit
    forceExit.unref();

    cleanupHandlers();
    logger.info('Shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  const classified = handleError(err, { phase: 'startup' });
  console.error(`Fatal startup error [${classified.category}]: ${classified.message}`);
  process.exit(1);
});
