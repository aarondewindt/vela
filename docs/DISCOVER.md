# Discover

Discover (#42/#75) is a personal backlog at `/discover`, linked from
the main Vela navigation. It works without AI or external metadata services.

## Collection and editing

- Quick add accepts a title or an absolute HTTP/HTTPS URL. A pasted URL becomes
  the initial title (up to 240 characters); edit its title and details later.
- The card collection supports case-insensitive text search across titles,
  descriptions, notes and URLs, plus exact normalized tags. Type, status, exact
  tag and priority filters combine. Results are paginated, 24 at a time.
- Sort by newest/oldest added, title, highest priority, highest rating or last
  update. Unset priorities/ratings sort last. ID breaks ties consistently.
  Title ordering follows the PostgreSQL database collation.
- Click an item's title or **Details & edit** to inspect and edit all fields.
  Change status directly on a card. Deletion requires confirmation.
- Standard content types cover movies, TV shows, games, books, articles, videos,
  podcasts, applications, websites and other content. Enter a custom type in the
  editor or quick add; it then appears in your type filter and suggestions.
- Status is independent of type: Want to Explore (default), In Progress,
  Completed, On Hold and Dropped. Any transition is allowed, including reopening
  completed or dropped items.
- Optional priority is Low/Medium/High (stored as 1/2/3). Personal ratings are
  whole numbers from 0 through 10; blank means unrated. Tags are trimmed,
  lowercased and deduplicated, up to 30 tags of 60 characters each.
- Titles are required, up to 240 characters; descriptions allow 10,000 and notes
  20,000 characters. Item and cover URLs allow 2,048 characters, HTTP/HTTPS only,
  without embedded credentials. Blank optional fields are stored as null.

## Persistence and API

`DiscoverItem` maps to `discover_items` and belongs to a `User` with cascading
deletion. Editable fields remain separate from retrieved web metadata. The single model stores type as
a bounded string, the shared workflow as `DiscoverStatus`, optional details,
tags, integer priority/rating, creation/update timestamps and an optimistic
version. There are no per-media models or speculative metadata tables.

Protected `discover` tRPC procedures delegate to `lib/discover/service.ts`:
`list`, `types`, `get`, `create`, `quickAdd`, `update`, `setStatus`, `remove`,
`refreshMetadata`.
Zod validates inputs; owner IDs come only from the session. Every database read
and write includes owner scope. Persistent state stays in TanStack Query; form,
filter and modal state is local React state, following the existing catalog UI.

Writes compare the last-read version so a stale editor/status update/delete
cannot overwrite another tab's changes. Reopen an item after a conflict. List
results and counts use one repeatable-read snapshot. On remount or failed
authorization, cached results are hidden until fresh owner-scoped data arrives.

A nullable SHA-256 `urlKey` and per-owner unique index prevent repeat URLs,
including concurrent creates and edits. Normalization uses the URL parser
(scheme/host case, default ports and root slash), ignoring fragments while
preserving the entered URL. Query parameters, path case and non-root trailing
slashes remain significant. Redirects, tracking-parameter equivalence and
title-only duplicates are intentionally not inferred. Different users can save
the same URL; multiple items without URLs are allowed.

Migration `20261022120000_discover_items` adds only the enum, item table, owner
foreign key, unique URL index and owner/date and owner/type/status indexes.
Database checks reinforce the priority and rating ranges. Run
`yarn prisma migrate deploy` and `yarn prisma generate` when installing this
version. Back up the database before applying migrations as usual.

## Reviewed URL metadata

Saving a URL through quick add opens its editor. **Retrieve / refresh metadata**
fetches the saved URL, then previews the title, description and cover URL. Select
individual fields, click **Use selected fields**, then **Save item**. Nothing is
selected automatically, including after refresh. Manual fields, notes, ratings
and unsaved edits remain intact until explicitly replaced. A changed URL must be
saved before retrieval; snapshots from another URL are hidden. Retrieval errors
leave manual save and retry available. Empty and partial metadata have explicit
messages. Title-only and URL-only creation never depend on extraction.

`sourceMetadata` is a nullable JSONB snapshot written only by the service. It
contains provider `web`, original saved URL, final fetched URL, optional site name,
retrieval timestamp and extracted values. The latest successful retrieval replaces
the previous snapshot, independently of editable fields. A failed retrieval
preserves the last successful snapshot. Refresh checks owner, URL and optimistic
version both before and after network work; concurrent edits/deletion reject the
result. The client retains its unsaved form while advancing to the returned version.
Applying selected values uses the ordinary validated update and URL deduplication
path. Redirects never change the saved item URL or its duplicate identity.

`lib/discover/metadata-fetch.ts` provides the bounded server fetch;
`metadata.ts` extracts HTML title, Open Graph, Twitter, simple microdata and
JSON-LD name/headline/description/image metadata. Open Graph takes precedence;
relative cover URLs resolve against the final page URL. No JavaScript runs and no
embedded resources, canonical URLs or JSON-LD contexts are fetched. Extracted
text is shown as text, never injected as HTML.

The fetcher allows credential-free HTTP/HTTPS on standard ports only. Every hop
resolves DNS, rejects the entire answer set if any IP is nonpublic, and pins the
validated address through Node's request lookup callback while retaining the
original hostname for Host/TLS verification. IP literals receive the same checks.
Private, loopback, link-local, reserved, multicast, mapped/transition IPv6 and
non-global IPv6 ranges are blocked. Requests use fresh connections, no cookies or
authorization, and no environment proxy. Limits are three redirects, eight seconds
total (including DNS), 16 KiB response headers and 1 MiB HTML. Non-HTML, compressed,
failed and oversized responses fail with a retryable manual-edit message. HTML is
decoded as UTF-8; JavaScript-only pages may produce no useful metadata.

Migration `20261022140000_discover_metadata` adds only the nullable JSONB column.
Run `yarn prisma migrate deploy` and `yarn prisma generate` before using this code
against an existing database, following the documented backup procedure.

## Deliberate limits and future work

There is no image downloading/storage, AI, embeddings, recommendations, external
provider integration or Planner linking. Cover images load directly in the user's
browser from the entered/applied URL, with no referrer, and are not copied into Vela
storage. Search is conventional database text search; tags use exact matching.
There is no type administration or bulk editing interface. Retrieval is explicit,
not a background crawler; only the latest successful snapshot is retained.

TMDB, Steam and Open Library matching/APIs remain separate follow-ups. AI and
semantic search should reuse `lib/ai/` and `lib/embeddings/`, with the same protected
services remaining responsible for all writes.

Tests are colocated under `lib/discover/` and `components/Discover/` and include
validation, defaults, custom types, CRUD, workflow states, compound filters,
sorting, duplicates, concurrency versions, authentication, owner isolation,
metadata extraction, network limits, SSRF guards and selective preview application.
