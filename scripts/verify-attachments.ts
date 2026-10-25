/** Real PostgreSQL + filesystem integration checks in an isolated temporary schema.
 * Run: yarn tsx --conditions=react-server scripts/verify-attachments.ts
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import sharp from 'sharp';
import { PrismaClient } from '../generated/prisma/client';
import { createAttachmentService, retainAttachments } from '../lib/attachments/service';
import { LocalFileStorage } from '../lib/storage/local';
import { MAX_IMAGE_BYTES } from '../lib/attachments/image';
import { prisma } from '../lib/prisma';

async function main() {
  const schema = `attachments_test_${randomUUID().replaceAll('-', '')}`;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }, { schema }),
  });
  const directory = await mkdtemp(path.join(os.tmpdir(), 'vela-attachments-integration-'));
  const backend = new LocalFileStorage(directory);
  const service = createAttachmentService(() => backend, db);
  try {
    const client = await pool.connect();
    try {
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(`SET search_path TO "${schema}"`);
      await client.query('CREATE TABLE "user" (id TEXT PRIMARY KEY)');
      await client.query("INSERT INTO \"user\" (id) VALUES ('alice'), ('bob')");
      await client.query(
        await readFile('prisma/migrations/20261025160000_attachments/migration.sql', 'utf8')
      );
    } finally {
      client.release();
    }

    const bytes = await sharp({ create: { width: 8, height: 6, channels: 3, background: 'red' } })
      .png()
      .toBuffer();
    const front = await service.upload('alice', bytes, '../../front.png', 'image/png');
    const back = await service.upload('alice', bytes, 'C:\\fakepath\\back.png', 'image/png');
    assert.notEqual(front.id, back.id);
    assert.equal(front.originalFilename, 'front.png');
    assert.equal(back.originalFilename, 'back.png');
    assert.equal(front.width, 8);
    assert.equal(await db.attachment.count(), 2);
    const restarted = createAttachmentService(() => new LocalFileStorage(directory), db);
    assert.deepEqual((await restarted.retrieve('alice', front.id)).bytes, bytes);
    for (const operation of [
      () => service.retrieve('bob', front.id),
      () => service.remove('bob', front.id),
    ]) {
      await assert.rejects(operation, { code: 'NOT_FOUND' });
    }
    for (const [input, mime] of [
      [Buffer.from('fake'), 'image/png'],
      [bytes, 'image/jpeg'],
      [Buffer.alloc(MAX_IMAGE_BYTES + 1), 'image/png'],
    ] as const) {
      await assert.rejects(() => service.upload('alice', input, 'bad.png', mime));
    }
    assert.equal(await db.attachment.count(), 2);

    // A missing object is a safe 404; deletion is still possible.
    const row = await db.attachment.findUniqueOrThrow({ where: { id: back.id } });
    await backend.remove(row.storageKey);
    await assert.rejects(() => service.retrieve('alice', back.id), { code: 'NOT_FOUND' });
    await service.remove('alice', back.id);

    // A partially written object is removed and its pending metadata is cleared.
    const brokenWrite = createAttachmentService(
      () => ({
        get: backend.get.bind(backend),
        remove: backend.remove.bind(backend),
        async put(key, content) {
          await backend.put(key, content.subarray(0, 10));
          throw new Error('write failed');
        },
      }),
      db
    );
    await assert.rejects(
      () => brokenWrite.upload('alice', bytes, 'partial.png', 'image/png'),
      /write failed/
    );
    assert.equal(await db.attachment.count(), 1);
    assert.equal((await readdir(directory)).length, 1);

    // DB failure before the pending record exists never writes a file.
    await assert.rejects(() => service.upload('unknown-user', bytes, 'no-owner.png', 'image/png'));
    assert.equal((await readdir(directory)).length, 1);

    // Fail READY publication after a successful file write; rollback still removes it.
    await pool.query(`CREATE FUNCTION "${schema}".reject_ready() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.ready AND NEW."originalFilename" = 'fail-db.png' THEN
          RAISE EXCEPTION 'test publication failure';
        END IF;
        RETURN NEW;
      END $$`);
    await pool.query(`CREATE TRIGGER reject_ready BEFORE UPDATE ON "${schema}".attachments
      FOR EACH ROW EXECUTE FUNCTION "${schema}".reject_ready()`);
    await assert.rejects(() => service.upload('alice', bytes, 'fail-db.png', 'image/png'));
    assert.equal(await db.attachment.count(), 1);
    assert.equal((await readdir(directory)).length, 1);

    // If both writing and immediate cleanup fail, the durable pending row survives.
    const brokenBoth = createAttachmentService(
      () => ({
        get: backend.get.bind(backend),
        async put(key, content) {
          await backend.put(key, content);
          throw new Error('write failed');
        },
        async remove() {
          throw new Error('cleanup failed');
        },
      }),
      db
    );
    await assert.rejects(
      () => brokenBoth.upload('alice', bytes, 'retry.png', 'image/png'),
      AggregateError
    );
    assert.equal(await db.attachment.count({ where: { deleteRequestedAt: { not: null } } }), 1);
    await service.prune();
    assert.equal(await db.attachment.count(), 1);
    assert.equal((await readdir(directory)).length, 1);

    // A failure to delete keeps a retryable tombstone, hidden from reads.
    const removable = await service.upload('alice', bytes, 'remove.png', 'image/png');
    const brokenRemove = createAttachmentService(
      () => ({
        put: backend.put.bind(backend),
        get: backend.get.bind(backend),
        async remove() {
          throw new Error('disk unavailable');
        },
      }),
      db
    );
    await assert.rejects(() => brokenRemove.remove('alice', removable.id), /disk unavailable/);
    await assert.rejects(() => service.retrieve('alice', removable.id), { code: 'NOT_FOUND' });
    assert.ok(
      (await db.attachment.findUniqueOrThrow({ where: { id: removable.id } })).deleteRequestedAt
    );
    await service.prune();
    assert.equal(await db.attachment.count(), 1);

    // Retention and consumer persistence must commit/roll back together.
    await assert.rejects(
      () =>
        db.$transaction(async (tx) => {
          await retainAttachments(tx, 'alice', [front.id]);
          throw new Error('consumer failed');
        }),
      /consumer failed/
    );
    assert.equal(
      (await db.attachment.findUniqueOrThrow({ where: { id: front.id } })).retainedAt,
      null
    );
    await assert.rejects(() => db.$transaction((tx) => retainAttachments(tx, 'bob', [front.id])), {
      code: 'NOT_FOUND',
    });
    await db.$transaction((tx) => retainAttachments(tx, 'alice', [front.id, front.id]));
    await assert.rejects(() => service.remove('alice', front.id), { code: 'CONFLICT' });

    // Retention wins against deletion while its transaction holds the row lock.
    const raced = await service.upload('alice', bytes, 'race.png', 'image/png');
    let release!: () => void;
    let locked!: () => void;
    const lockAcquired = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const retention = db.$transaction(async (tx) => {
      await retainAttachments(tx, 'alice', [raced.id]);
      locked();
      await gate;
    });
    await lockAcquired;
    const deletion = service.remove('alice', raced.id);
    release();
    await retention;
    await assert.rejects(() => deletion, { code: 'CONFLICT' });

    // A deletion claim prevents a later consumer from retaining the attachment.
    const claimed = await service.upload('alice', bytes, 'claimed.png', 'image/png');
    await assert.rejects(() => brokenRemove.remove('alice', claimed.id));
    await assert.rejects(
      () => db.$transaction((tx) => retainAttachments(tx, 'alice', [claimed.id])),
      { code: 'NOT_FOUND' }
    );

    // Simulate a process crash during upload, and an abandoned READY upload.
    const pending = await service.upload('alice', bytes, 'pending.png', 'image/png');
    await db.attachment.update({
      where: { id: pending.id },
      data: { ready: false, createdAt: new Date('2000-01-01') },
    });
    const abandoned = await service.upload('alice', bytes, 'unused.png', 'image/png');
    await db.attachment.updateMany({ data: { createdAt: new Date('2000-01-01') } });
    await service.prune();
    assert.equal(await db.attachment.count(), 2); // only retained front + race
    assert.equal((await readdir(directory)).length, 2);
    await assert.rejects(() => service.retrieve('alice', abandoned.id), { code: 'NOT_FOUND' });
    assert.deepEqual((await service.retrieve('alice', front.id)).bytes, bytes);
    process.stdout.write('Attachment PostgreSQL/filesystem integration checks passed.\n');
  } finally {
    await db.$disconnect();
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await pool.end();
    await prisma.$disconnect();
    await rm(directory, { recursive: true, force: true });
  }
}
main().catch(() => {
  process.stderr.write('Attachment integration verification failed.\n');
  process.exitCode = 1;
});
