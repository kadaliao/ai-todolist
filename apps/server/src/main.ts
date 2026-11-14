import { serve } from '@hono/node-server';
import { createNodeWebSocket } from '@hono/node-ws';
import { Hono } from 'hono';
import { Ai } from './ai';
import { createApp } from './app';
import { loadConfig } from './config';
import { Db } from './db';
import { Hub } from './hub';
import { Stt } from './stt';

if (!(globalThis as { Temporal?: unknown }).Temporal) await import('temporal-polyfill/global');

const config = loadConfig();
const db = new Db(config.dbPath);
const hub = new Hub(db, config.timeZone);
const ai = config.ai ? new Ai(config.ai) : null;
const stt = config.stt ? new Stt(config.stt) : null;

const root = new Hono();
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app: root });
root.route(
  '/',
  createApp({ db, hub, ai, stt, upgradeWebSocket, ...(config.webDir ? { webDir: config.webDir } : {}) }),
);

const server = serve({ fetch: root.fetch, port: config.port, hostname: config.host }, (info) => {
  const devices = db.listDevices().length;
  console.log(`docket-server listening on ${info.address}:${info.port}`);
  console.log(
    `  data: ${config.dbPath} · ops: ${db.maxSeq()} · devices: ${devices} · AI: ${ai ? ai.model : 'off'} · speech: ${stt ? stt.model : 'system only'}`,
  );
  if (!devices) console.log('  No device tokens yet. Create one with: node dist/cli.js token create <name>');
});
injectWebSocket(server);

const shutdown = () => {
  server.close();
  db.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
