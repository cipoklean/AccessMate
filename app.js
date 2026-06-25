import 'dotenv/config';
import http from 'node:http';
import { App, LogLevel } from '@slack/bolt';
import { registerAppHomeEvents } from './lib/appHome.js';
// ── Startup validation: fail fast before creating anything ──────────
import { activeProvider, fallbackChain } from './lib/llm.js';
import { registerAltTextShortcut } from './listeners/altText.js';
import { registerAccessMateCommand } from './listeners/commands.js';
import { registerMentionHandler } from './listeners/mention.js';
import { registerSimplifyShortcut } from './listeners/simplify.js';

const requiredEnvVars = ['SLACK_BOT_TOKEN', 'SLACK_APP_TOKEN', activeProvider.apiKeyEnv];
for (const key of requiredEnvVars) {
  if (!process.env[key]) {
    console.error(
      key === activeProvider.apiKeyEnv
        ? `FATAL: ${key} is not set (LLM_PROVIDER=${process.env.LLM_PROVIDER || 'gemini'}). Get one at your ${activeProvider.keyLabel} provider. Aborting.`
        : `FATAL: ${key} is not set. Aborting.`,
    );
    process.exit(1);
  }
}
if (fallbackChain.length > 1) {
  console.log(`LLM fallback chain: ${fallbackChain.map((p) => p.keyLabel).join(' → ')}`);
}

/** @type {any} */
const LogLevelMap = LogLevel;
const logLevel = process.env.LOG_LEVEL ? LogLevelMap[process.env.LOG_LEVEL.toUpperCase()] : LogLevel.INFO;

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
  logLevel,
  ignoreSelf: true,
});

registerAccessMateCommand(app);
registerAltTextShortcut(app);
registerSimplifyShortcut(app);
registerMentionHandler(app);
registerAppHomeEvents(app);

(async () => {
  try {
    await app.start();
    app.logger.info('AccessMate is running!');
  } catch (err) {
    console.error('Failed to start Slack app:', err);
    process.exit(1);
  }
})();

// ── Keep-alive HTTP endpoint for Render free tier ──────────────────
// UptimeRobot pings /health every 5 min so Render never spins this service down.
// Will be removed when migrating to Railway.
const PORT = process.env.PORT || 3000;

const SECURITY_HEADERS = {
  'Content-Type': 'text/plain',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Cache-Control': 'no-store',
  Pragma: 'no-cache',
};

// Simple in-memory rate limiter for the health endpoint
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 30;

function isRateLimited(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now - entry.resetAt > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT_MAX;
}

// Periodically evict expired rate-limit entries so the map doesn't grow forever
const RATE_LIMIT_SWEEP_INTERVAL_MS = 5 * 60_000;
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if (now - entry.resetAt > RATE_LIMIT_WINDOW_MS) {
      rateLimitMap.delete(ip);
    }
  }
}, RATE_LIMIT_SWEEP_INTERVAL_MS).unref();

http
  .createServer((req, res) => {
    const clientIp = req.socket.remoteAddress || 'unknown';
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');

    if (isRateLimited(clientIp)) {
      res.writeHead(429, SECURITY_HEADERS);
      res.end('Too Many Requests');
      return;
    }

    const pathname = req.url?.split('?')[0] || '/';
    if (pathname === '/health' && req.method === 'GET') {
      res.writeHead(200, SECURITY_HEADERS);
      res.end('OK');
      return;
    }

    res.writeHead(404, SECURITY_HEADERS);
    res.end('Not found');
  })
  .listen(PORT, () => {
    console.log(`Keep-alive HTTP listening on :${PORT}`);
  });
