/** @jest-environment node */
jest.mock('server-only', () => ({}));

import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LocalFileStorage, attachmentStorage } from './local';

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'vela-storage-'));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

it('persists across backend recreation with private permissions and idempotent deletion', async () => {
  const key = `${randomUUID()}.bin`;
  await new LocalFileStorage(directory).put(key, Buffer.from('original bytes'));
  expect(await new LocalFileStorage(directory).get(key)).toEqual(Buffer.from('original bytes'));
  expect((await stat(path.join(directory, key))).mode & 0o777).toBe(0o600);
  await expect(
    new LocalFileStorage(directory).put(key, Buffer.from('overwrite'))
  ).rejects.toMatchObject({ code: 'EEXIST' });
  await new LocalFileStorage(directory).remove(key);
  await new LocalFileStorage(directory).remove(key);
  await expect(new LocalFileStorage(directory).get(key)).rejects.toMatchObject({ code: 'ENOENT' });
});

it.each(['../secret', '/etc/passwd', '..\\secret', 'image.png', 'a/../../b'])(
  'rejects unsafe key %s for every operation',
  async (key) => {
    const storage = new LocalFileStorage(directory);
    await expect(storage.put(key, Buffer.from('x'))).rejects.toThrow('Invalid storage key');
    await expect(storage.get(key)).rejects.toThrow('Invalid storage key');
    await expect(storage.remove(key)).rejects.toThrow('Invalid storage key');
  }
);

it('rejects public/build directories and symlinked files', async () => {
  const key = `${randomUUID()}.bin`;
  for (const root of ['public/attachments', '.next/attachments']) {
    await expect(new LocalFileStorage(root).put(key, Buffer.from('x'))).rejects.toThrow('outside');
  }
  const secret = path.join(directory, 'secret');
  await writeFile(secret, 'private');
  await symlink(secret, path.join(directory, key));
  await expect(new LocalFileStorage(directory).get(key)).rejects.toMatchObject({ code: 'ELOOP' });
});

it('requires absolute configured paths', () => {
  const original = process.env.VELA_ATTACHMENT_STORAGE_DIR;
  try {
    process.env.VELA_ATTACHMENT_STORAGE_DIR = 'relative';
    expect(attachmentStorage).toThrow('absolute');
  } finally {
    if (original === undefined) {
      delete process.env.VELA_ATTACHMENT_STORAGE_DIR;
    } else {
      process.env.VELA_ATTACHMENT_STORAGE_DIR = original;
    }
  }
});
