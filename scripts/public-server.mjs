import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
// Use the existing database and auth secret. Public-only overrides stay out of Git.
const env = {
  ...dotenv.parse(readFileSync('vela.env')),
  ...process.env,
  ...(existsSync('.env.public.local') ? dotenv.parse(readFileSync('.env.public.local')) : {}),
  NODE_ENV: 'production',
  VELA_PUBLIC_MODE: 'true',
  BETTER_AUTH_URL: 'https://vela.aarondewindt.space',
  BETTER_AUTH_TRUSTED_ORIGINS: 'https://vela.aarondewindt.space',
};
delete env.NEXT_PUBLIC_BETTER_AUTH_URL;
// Next's .env.local must not silently reintroduce a localhost client override.
env.NEXT_PUBLIC_BETTER_AUTH_URL = '';
const action = process.argv[2];
if (!['build', 'start'].includes(action)) throw new Error('Expected build or start.');
const child = spawn(process.execPath, [
  'node_modules/next/dist/bin/next', action,
  ...(action === 'start' ? ['--hostname', '0.0.0.0', '--port', '3001'] : []),
], { env, stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
