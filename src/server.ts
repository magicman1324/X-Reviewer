import { createServer } from 'node:http';
import { createProbot, createNodeMiddleware } from 'probot';
import appFn from './index.js';
import type { AppConfig } from './types/index.js';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getEnvNumber(name: string): number {
  const raw = requireEnv(name);
  const num = Number(raw);
  if (Number.isNaN(num)) {
    throw new Error(`Environment variable ${name} must be a number, got: "${raw}"`);
  }
  return num;
}

function loadConfig(): AppConfig {
  return {
    appId: getEnvNumber('APP_ID'),
    privateKey: requireEnv('PRIVATE_KEY'),
    secret: requireEnv('WEBHOOK_SECRET'),
    port: Number(process.env.PORT) || 3000,
    logLevel: (process.env.LOG_LEVEL as string) || 'info',
  };
}

async function main() {
  const config = loadConfig();

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
      res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
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
    probot.log.info(`X-Reviewer server listening on port ${config.port}`);
    probot.log.info(`Webhook endpoint: http://localhost:${config.port}/api/github/webhooks`);
    probot.log.info(`Health check: http://localhost:${config.port}/health`);
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    probot.log.info(`Received ${signal}, shutting down...`);
    server.close(() => process.exit(0));
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
