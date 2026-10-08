# Vela UI State and API Architecture

Vela uses a clear separation between **server state**, **client/UI state**, **API transport**, and **application logic**.

The main stack is:

- **Next.js** for the web application and server runtime
- **tRPC** for type-safe communication between the Vela web UI and server
- **TanStack Query** for fetching, caching, synchronizing, and mutating server-owned data in the UI
- **Zustand** for local client/UI state
- **Application services** for reusable business logic
- **Prisma + PostgreSQL** for persistence

The intended architecture is:

```text
React UI
│
├── Zustand
│   └── Local/client-only state
│
└── TanStack Query
    └── Server state
         │
         ▼
        tRPC
    Type-safe API layer
         │
         ▼
Application Services
         │
         ▼
    Prisma / PostgreSQL
```

## State ownership

A core rule is that data should have one clear owner.

### Server state: TanStack Query

Data whose source of truth lives on the server or in PostgreSQL should be managed through **TanStack Query**.

Examples include:

- tasks
- daily plans
- recipes
- inventory
- transactions
- user preferences stored in the database
- generated schedules
- other persistent Vela data

TanStack Query is responsible for:

- fetching data
- caching results
- loading states
- error states
- refetching
- cache invalidation
- mutations
- keeping UI data synchronized with the backend

Do **not** copy server-fetched data into Zustand merely to make it globally accessible. TanStack Query already acts as the client-side representation/cache of server state.

Conceptually:

```ts
const tasks = trpc.tasks.list.useQuery({
  date: selectedDate,
});
```

A successful mutation should update or invalidate the relevant query cache rather than manually synchronizing a second copy of the same data.

## Client/UI state: Zustand

Use **Zustand** for state that belongs to the current client interaction rather than to the backend.

Examples include:

- currently selected date
- active tab
- filters
- sort order
- sidebar state
- modal state
- temporary selections
- drag-and-drop interaction state
- local workflow state that does not need persistence

Example:

```ts
const selectedDate = useVelaStore(
  (state) => state.selectedDate
);
```

The distinction should generally be:

```text
Would reloading the authoritative data from the server restore this value?

Yes  -> TanStack Query / server state
No   -> probably Zustand / UI state
```

Persistent application settings should generally remain server state even if they affect the UI.

## tRPC API layer

The Vela web UI communicates with the server primarily through **tRPC**.

tRPC provides end-to-end TypeScript type safety without manually maintaining separate request and response types between the Next.js frontend and backend.

For example:

```ts
export const taskRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        date: z.string(),
      })
    )
    .query(({ input, ctx }) => {
      return taskService.listForDate(
        ctx.user.id,
        input.date
      );
    }),

  create: protectedProcedure
    .input(
      z.object({
        title: z.string(),
      })
    )
    .mutation(({ input, ctx }) => {
      return taskService.create(
        ctx.user.id,
        input
      );
    }),
});
```

The UI can then use the procedure without separately declaring the response type:

```ts
const tasks = trpc.tasks.list.useQuery({
  date: selectedDate,
});

const createTask =
  trpc.tasks.create.useMutation();
```

Types should flow from the server implementation to the client automatically.

## Keep tRPC procedures thin

tRPC is the transport/API layer. It should **not become the application logic layer**.

A procedure should generally:

1. authenticate the request
2. validate input
3. obtain request-specific context
4. call an application service
5. return the result

For example:

```ts
create: protectedProcedure
  .input(createTaskSchema)
  .mutation(({ input, ctx }) => {
    return taskService.create(
      ctx.user.id,
      input
    );
  });
```

Avoid putting substantial business logic directly in a tRPC router.

Do not build the application like this:

```text
React
  ↓
giant tRPC procedure containing all logic
  ↓
Prisma
```

Instead use:

```text
React
  ↓
tRPC
  ↓
application service
  ↓
Prisma
```

## Application services are the reusable boundary

Vela's actual functionality should live in reusable application/domain services.

For example:

```ts
taskService.create(...)
taskService.complete(...)
taskService.reschedule(...)

planService.getDay(...)
planService.generate(...)
planService.updateBlock(...)

inventoryService.consume(...)
recipeService.create(...)
```

These functions contain the deterministic application behaviour.

This is important because the Vela web UI will not be the only interface to the application.

The same services should eventually be callable from:

```text
                    ┌─ tRPC ───── Web UI
                    │
Application Services├─ REST ───── External clients/scripts
                    │
                    ├─ MCP ────── AI agents
                    │
                    └─ Jobs ───── Background automation
```

Each interface should adapt its input into calls to the same underlying application services.

## tRPC is primarily an internal Vela API

tRPC is intended primarily for communication between the **Vela Next.js frontend and Vela backend**.

It should not be treated as Vela's universal integration protocol.

Vela is expected to eventually support other clients such as:

- scripts
- embedded devices
- external applications
- AI agents
- MCP clients

These may use a conventional REST API or MCP instead of tRPC.

For example:

```text
Web UI
   ↓
 tRPC
   ↓
taskService.create()

External script
   ↓
 REST
   ↓
taskService.create()

AI agent
   ↓
 MCP/tool call
   ↓
taskService.create()
```

This avoids duplicating business logic while allowing each client to use an appropriate protocol.

## AI architecture

AI should be treated as another interface to Vela rather than as the foundation of Vela's normal functionality.

The deterministic application should work without an LLM.

For example, an AI tool may expose:

```text
create_task
```

but its implementation should ultimately call the same:

```ts
taskService.create(...)
```

used by the regular UI.

Avoid implementing separate "AI versions" of application behaviour.

The preferred model is:

```text
UI action ───────┐
REST request ────┤
AI tool ─────────┤──► application service ─► database
background job ──┘
```

## Authentication

The architecture should accommodate different authentication methods for different clients.

The web application can use normal browser/session authentication.

External clients should eventually be able to use scoped API credentials such as personal access tokens or bearer tokens.

This avoids requiring interactive OAuth flows for simple scripts, local services, embedded devices, or agent integrations.

Authentication and authorization should be resolved at the API/interface boundary before invoking protected application functionality.

## Shared UI color palette

Use the shared palette tokens and semantic color roles for color-coded UI rather than storing component-specific hex values. See [Color Palette](COLOR_PALETTE.md) for the picker contract, persistence format, light/dark roles, and legacy color handling.

## General rules for agents working on Vela

When adding or modifying functionality:

1. **Do not put persistent server data in Zustand.** Use TanStack Query.
2. **Use Zustand only for genuine client/UI state.**
3. **Use tRPC for normal Vela web UI → server communication.**
4. **Keep tRPC procedures thin.**
5. **Put reusable business behaviour in application/domain services.**
6. **Do not access Prisma directly from React components.**
7. **Avoid accessing Prisma directly from tRPC procedures when meaningful application logic is involved.**
8. **Design application services so they can also be called by REST, MCP, background jobs, and AI tools.**
9. **Do not make AI functionality the only implementation of a deterministic Vela operation.**
10. **Keep PostgreSQL/backend state as the source of truth and use TanStack Query as its client-side cache.**

The overall goal is to keep Vela's core behaviour independent from any particular UI, API protocol, or AI framework.