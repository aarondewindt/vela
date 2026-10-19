import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
process.umask(0o077);
const compose = ['compose', '-f', '.devcontainer/docker-compose.inner.yml', 'exec', '-T', 'db'];
function run(args, stdio) {
  return new Promise((done, reject) => {
    const child = spawn('docker', [...compose, ...args], { stdio });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? done() : reject(new Error(`Database command failed (${code}).`)));
  });
}

const [action = 'backup', source, target] = process.argv.slice(2);
if (action === 'backup') {
  const directory = resolve(source || '.local/backups');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = resolve(directory, `vela-${new Date().toISOString().replaceAll(':', '-')}.dump`);
  const fd = openSync(path, 'wx', 0o600);
  try {
    await run(['sh', '-c', 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom'], ['ignore', fd, 'inherit']);
  } catch (error) {
    rmSync(path);
    throw error;
  } finally {
    closeSync(fd);
  }
  console.log(`Backup saved to ${path}`);
} else if (action === 'restore') {
  // Never overwrite an existing database. Restore to a new name and inspect first.
  if (!source || !target || !/^[a-z][a-z0-9_]{0,62}$/.test(target)) {
    throw new Error('Usage: database-backup.mjs restore FILE NEW_DATABASE (lowercase letters, digits, underscores).');
  }
  const fd = openSync(resolve(source), 'r');
  try {
    await run(['sh', '-c', 'exec createdb -U "$POSTGRES_USER" -- "$1"', 'restore', target], ['ignore', 'inherit', 'inherit']);
    await run(['sh', '-c', 'exec pg_restore -U "$POSTGRES_USER" --dbname="$1" --exit-on-error --no-owner --no-acl', 'restore', target], [fd, 'inherit', 'inherit']);
  } finally {
    closeSync(fd);
  }
  console.log(`Restored to ${target}. The running app database has not changed.`);
} else {
  throw new Error('Expected backup or restore.');
}
