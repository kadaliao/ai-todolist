import { serve } from '@hono/node-server';
import { createNodeWebSocket } from '@hono/node-ws';
import { Hono } from 'hono';
import { Ai } from './ai';
import { createApp } from './app';
import { loadConfig } from './config';
import { Db } from './db';
import { Hub } from './hub';
import { Stt } from './stt';
import { VolcStream } from './volc';

if (!(globalThis as { Temporal?: unknown }).Temporal) await import('temporal-polyfill/global');

const config = loadConfig();
const db = new Db(config.dbPath);
const hub = new Hub(db, config.timeZone);
const ai = config.ai ? new Ai(config.ai) : null;
const stt = config.stt ? new Stt(config.stt) : null;
const volc = config.volc;
const openStream = volc ? (o: ConstructorParameters<typeof VolcStream>[1]) => new VolcStream(volc, o) : null;

const root = new Hono();
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app: root });
root.route(
  '/',
  createApp({
    db,
    hub,
    ai,
    stt,
    openStream,
    upgradeWebSocket,
    ...(config.webDir ? { webDir: config.webDir } : {}),
  }),
);

const server = serve({ fetch: root.fetch, port: config.port, hostname: config.host }, (info) => {
  const devices = db.listDevices().length;
  console.log(`docket-server listening on ${info.address}:${info.port}`);
  console.log(
    `  data: ${config.dbPath} · ops: ${db.maxSeq()} · devices: ${devices} · AI: ${ai ? ai.model : 'off'} · speech: ${[volc ? 'streaming (Volcengine)' : '', stt ? stt.model : ''].filter(Boolean).join(' + ') || 'system only'}`,
  );
  if (!devices) {
    // The first device can't pair from another one: print a code it can use (an hour, once).
    const { code } = db.createPairing('startup', 60 * 60 * 1000);
    console.log(
      `  No devices yet. In Docket → Settings → Sync, enter this server’s address and the pairing code ${code} (valid for an hour).`,
    );
    console.log('  A new code any time: node dist/cli.js pair');
  }
});
injectWebSocket(server);

const shutdown = () => {
  server.close();
  db.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
