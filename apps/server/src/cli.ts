import { loadConfig } from './config';
import { Db } from './db';

/**
 * Device tokens:
 *   docket-server token create <name>   print a new token (shown once)
 *   docket-server token list
 *   docket-server token revoke <name>
 *   docket-server backup [file]          consistent copy of the database
 */

const [cmd, sub, name] = process.argv.slice(2);
if (cmd === 'backup') {
  const target = sub ?? `docket-backup-${new Date().toISOString().slice(0, 10)}.db`;
  const backupDb = new Db(loadConfig().dbPath);
  backupDb.backup(target);
  backupDb.close();
  console.log(`Backed up to ${target}`);
  process.exit(0);
}
const db = new Db(loadConfig().dbPath);

function usage(): never {
  console.log('usage: cli token create <name> | token list | token revoke <name> | backup [file]');
  process.exit(1);
}

if (cmd !== 'token') usage();
if (sub === 'create') {
  if (!name) usage();
  try {
    const token = db.createToken(name);
    console.log(`Token for “${name}” (shown once — paste it into Docket → Settings → Sync):\n\n  ${token}\n`);
  } catch {
    console.error(`A device named “${name}” already exists. Revoke it first or pick another name.`);
    process.exit(1);
  }
} else if (sub === 'list') {
  for (const d of db.listDevices())
    console.log(`${d.name}\tcreated ${d.createdAt}\tlast seen ${d.lastSeen ?? 'never'}`);
} else if (sub === 'revoke') {
  if (!name) usage();
  console.log(db.revokeToken(name) ? `Revoked “${name}”.` : `No device named “${name}”.`);
} else usage();
db.close();
