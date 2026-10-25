# Private attachment storage

Issue #113 adds image storage independent of chat, Nutrition and Discover. Binary
HTTP routes use the same Better Auth browser session as tRPC; the application
service owns validation, ownership and lifecycle. `lib/storage/local.ts` defines
the small `FileStorage` interface (`put/get/remove`) and its first backend. A future
object-storage backend can implement it without changing consumer models. No S3
service or public static-file hosting is required.

## Configuration and persistence

`VELA_ATTACHMENT_STORAGE_DIR` is an **absolute directory path**. In development it
defaults to `<working directory>/.local/attachments`; the devcontainer explicitly
uses `/workspaces/vela/.local/attachments` on the existing host workspace bind
mount. Files survive application restarts, container stops and container rebuilds.
The app creates the directory as the `node` user with mode `0700`, and creates
files exclusively with mode `0600`. No manual `chown` is needed in the normal
devcontainer setup. `.local/` is already Git-ignored. Deleting the workspace or
its `.local` directory deletes these files; a new clone does not include them.

Production **requires** this variable; there is no ephemeral production fallback.
Mount a persistent local disk directory or named volume at that path, writable
and searchable by the application's UID/GID. Provision a private directory owned
by that identity (directory mode `0700`), including after restoring a backup or
changing the container UID. Do not place it under `public`, `.next`, or a web
server document root; Vela rejects its own public/build directories. Do not grant
untrusted processes write access to the storage root. All app replicas and cleanup
workers must use the same backend/directory. A local disk backend does not provide
cross-host replication. Avoid ephemeral serverless filesystems.

Back up **PostgreSQL and the storage directory together**, preferably with writes
paused for a consistent snapshot. PostgreSQL contains metadata, never bytes or
base64. Restore the original storage keys and directory ownership along with the
database. Restoring just the database causes missing-image 404s; changing the
configured directory does not move existing files. Original image metadata,
including camera EXIF, is preserved because original bytes are retained.

## HTTP contract

These are binary transport exceptions to ordinary tRPC requests, like streaming
chat. There is no attachment UI in #113.

- `POST /api/attachments`: raw image bytes in the body, image MIME in
  `Content-Type`, optional `X-Filename: encodeURIComponent(file.name)`. Send one
  image per request; upload front/back/additional images independently. Returns
  `201` JSON with stable UUID `id`, sanitized `originalFilename`, `mimeType`,
  `size` (bytes), `width`, `height` and `createdAt`. The response omits filesystem
  keys and owner details. No multipart or base64 encoding.
- `GET /api/attachments/<id>`: original bytes, owner only. Missing IDs, foreign
  IDs, pending/deleted objects and missing files return the same safe 404.
- `DELETE /api/attachments/<id>`: deletes an unretained owned upload, returning
  `204`. Retained objects return `409`. A failed physical deletion returns `500`
  but leaves a retryable deletion record; retrieval is immediately disabled.

All responses disable caching. Retrieval uses `nosniff`, a restrictive CSP and a
server-generated inline filename. Mutations reject cross-site requests using the
existing chat route's Origin/Fetch Metadata convention. No separate auth system,
public URLs or static-directory bypass is provided. Errors use 400 for invalid
images/IDs, 401 for no session, 403 for cross-site mutation, 413 for size limits,
415 for unsupported request MIME and a redacted 500 for infrastructure failures.

Supported formats are JPEG, PNG and WebP, with matching file signature, decoded
format and declared MIME. The decoder rejects corrupt/truncated images, reported
multiple frames, and images over **40 million pixels**. Size is **1 byte–10 MiB**;
the HTTP body is read with a hard running byte limit even without Content-Length.
SVG, GIF, HEIC and arbitrary files are rejected. Sharp is a direct dependency
(already used transitively by Next.js); the original bytes are not recompressed.
See [Sharp constructor limits](https://sharp.pixelplumbing.com/api-constructor/)
and [metadata versus full decoding](https://sharp.pixelplumbing.com/api-input/).

## Lifecycle and #114 integration contract

`Attachment` stores the UUID, owner FK, unique opaque storage key, original display
filename, validated MIME, size, dimensions and creation time. It also journals
`ready`, `retainedAt` and `deleteRequestedAt`.

An upload first inserts a durable pending row. A short transaction locks that row,
writes/syncs the file with an exclusive generated UUID filename, and marks it
ready. Reads cannot see pending records. On failure, pending uploads are claimed
for deletion, the partial file is removed, then the row is removed. If either
system is unavailable, the durable pending/deletion record enables retry. A
connection failure at commit can have an ambiguous outcome: cleanup never deletes
a READY object. An unreturned completed upload ages out normally. Files are never
created before a metadata record exists.

Run `yarn attachments:prune` regularly (for example hourly via cron/systemd with
the same environment as the app). Each run processes up to 100 candidates:
pending uploads older than 24 hours, READY uploads never retained and older than
7 days, and all previously requested deletions. Re-run to drain larger backlogs.
Retained attachments are excluded. Claims recheck eligibility atomically against
concurrent retention. Files are removed before metadata; missing files count as
successful deletion. Storage failures leave tombstones, fail the command and can
be retried. Cleanup is an explicit operational job, not an in-process timer.
Do not delete metadata directly or cascade-delete owners: the owner FK restricts
account removal until attachments have been dealt with. Out-of-band filesystem
or database edits require operator reconciliation; cleanup does not blindly scan
and delete unknown files.

For #114:

1. Persist only attachment UUIDs in messages, never local paths, data URLs or
   base64. Multiple independent UUIDs can be referenced by one message.
2. Call `retainAttachments(tx, userId, ids)` **inside the transaction that persists
   those message references**. It validates ownership/readiness and locks against
   deletion; an invalid ID rolls back the transaction. There is deliberately no
   public retain endpoint. Do this before model inference, outside long-running
   inference transactions.
3. Retention is conservative and permanent in #113. There is no release method:
   deleting one conversation must not delete an image reused elsewhere. #114 can
   introduce typed reference FKs and transactional release/garbage collection once
   it owns all consumers. Until then, retained objects never expire or accept
   DELETE. Account-wide permanent erasure needs an explicit reference-aware flow.
4. Retrieve through the owner-scoped service for model inputs; do not fetch
   arbitrary client URLs or treat attachment IDs as authorization tokens. Show a
   useful missing-image state for 404 responses. No chat schema/UI is added here.

#83 can reuse the file backend, validation, service and retention contract later;
bounded remote fetching, source URL/provenance and Discover references remain #83.

## Validation

`yarn jest --runInBand lib/attachments lib/storage` covers HTTP authentication,
transport limits, safe headers, errors, actual decoding and path safety.
`yarn tsx --conditions=react-server scripts/verify-attachments.ts` uses real
PostgreSQL and a temporary filesystem directory, creates an isolated temporary
schema with this migration and removes it afterward. The test database role
needs schema-creation privileges. It exercises storage recreation, multiple
uploads, owner isolation, rejection, missing objects, partial-write rollback,
deletion retries, retention rollback/races and age-based cleanup without touching
application records. Apply the migration normally with `yarn prisma migrate
deploy` and regenerate Prisma Client with `yarn prisma generate` on deployment.
