import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config.js';
import { db } from './db/connection.js';

const app = express();

app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin: false }));
app.use(express.json({ limit: '256kb' }));

app.get('/health/live', (_req, res) => {
  res.status(200).json({ status: 'ok', service: 'kingxtech-vtu-server' });
});

app.get('/health/ready', async (_req, res) => {
  const databaseReady = await db.healthCheck();
  if (!databaseReady) {
    return res.status(503).json({ status: 'not_ready', checks: { database: false } });
  }
  return res.status(200).json({ status: 'ready', checks: { database: true } });
});

app.use((_req, res) => {
  res.status(404).json({ error: 'NOT_FOUND' });
});

const server = app.listen(config.PORT, '0.0.0.0', () => {
  console.log(`KingxTech VTU server listening on 0.0.0.0:${config.PORT}`);
});

async function shutdown(signal: string): Promise<void> {
  console.log(`${signal} received; shutting down VTU server`);
  server.close(async () => {
    await db.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
