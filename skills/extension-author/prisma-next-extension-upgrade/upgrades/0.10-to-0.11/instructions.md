---
from: "0.10"
to: "0.11"
changes:
  - id: facade-add-close-and-async-dispose
    summary: |
      The official Prisma Next facades (`@prisma-next/postgres`, `@prisma-next/sqlite`, `@prisma-next/mongo`) now expose `close()` and `[Symbol.asyncDispose]` so short-lived scripts can release facade-owned resources cleanly and exit instead of hanging on a live connection. Extensions that expose a facade in the same shape should add the same surface for parity, honouring the ownership rule (only close resources the facade itself constructed) and managing a terminal closed state (subsequent operations reject with a clear error). No script — manual code authoring per extension.
    detection:
      glob: "**/src/runtime/*.ts"
      contains:
        - "createRuntimeCore"
      anyMatch: true
  - id: mongo-close-ownership-rule
    summary: |
      The Mongo facade's `db.close()` is **silently breaking**. Before 0.11 it unconditionally called `await runtime.close()`, which closed the underlying `MongoClient` regardless of how the facade was constructed. From 0.11 it honours the ownership rule and closes only facade-constructed clients (from a `{ url }` binding); when the facade was constructed with `{ mongoClient }` the caller-supplied `MongoClient` is left untouched. Extensions that wrap or extend `@prisma-next/mongo` and relied on `db.close()` disposing of a shared `MongoClient` need to either switch to a `{ url }` binding (so the facade owns the client) or close the `MongoClient` themselves.
    detection:
      glob: "**/*.{ts,tsx}"
      contains:
        - "mongoClient"
        - "@prisma-next/mongo"
      anyMatch: true
---

# 0.10 → 0.11 — Extension-author upgrade instructions

## `facade-add-close-and-async-dispose`

Starting at the 0.11 release the three official facades (`postgres()`, `sqlite()`, `mongo()`) expose two new methods:

```typescript
interface ClientFacade {
  // ...existing surface...
  close(): Promise<void>;
  [Symbol.asyncDispose](): Promise<void>;
}
```

This is the surface that lets a short-lived script (`tsx my-script.ts`) release facade-owned connection resources and exit cleanly. Without it, a `pg.Pool` (or analogous keep-alive in SQLite / Mongo) keeps Node's event loop alive and the script hangs after its last query prints.

If your extension exposes a facade in the same shape (e.g. you publish your own `postgresServerless()` or `someDriver()` factory that returns the same client object), add the equivalent surface. Three load-bearing properties:

1. **Ownership rule.** `close()` releases only the resources the facade *itself* constructed. A `{ url }` (or similar opaque-string) binding means the facade opened the connection — facade owns it, `close()` disposes it. A `{ pool }` / `{ client }` / `{ mongoClient }` (caller-supplied opaque-handle) binding means the caller owns it — `close()` leaves it untouched. The facade must capture this ownership decision at construction time and remember it.

2. **Idempotence.** `close()` can be called multiple times in a row without throwing. The second and later calls are no-ops.

3. **Terminal closed state.** After `close()` resolves, the facade is permanently locked. Any subsequent `db.orm.X.<op>(...)`, `db.runtime()`, `db.connect()` call rejects with `Error('<target> client is closed')`. This catches use-after-close bugs cleanly instead of silently re-opening resources.

Reference implementations in this repo:

- `packages/3-extensions/postgres/src/runtime/postgres.ts` (full pattern; `{ url }` vs `{ pool }` ownership)
- `packages/3-extensions/sqlite/src/runtime/sqlite.ts` (only-`{ path }` shape; the facade always owns)
- `packages/3-extensions/mongo/src/runtime/mongo.ts` (`{ url }` vs `{ mongoClient }`)

The `[Symbol.asyncDispose]` alias is one line — delegate to `close()` — and enables the TS 5.2+ `await using db = yourFacade(...)` syntax. There is no good reason not to add both methods together.

## `mongo-close-ownership-rule`

Before 0.11, `@prisma-next/mongo`'s `db.close()` looked like this:

```typescript
async close() {
  try {
    await runtimePromise;
    await runtime.close();  // unconditional — closed any MongoClient, owned or not
  } catch { /* swallow */ }
  closed = true;
}
```

From 0.11 it captures the ownership decision at construction time and only closes the `MongoClient` if the facade owns it:

```typescript
let ownedDispose: (() => Promise<void>) | undefined;
if (resolvedBinding.kind === 'url') {
  ownedDispose = () => driver.close();
}
// ...
async close() {
  try {
    await runtimePromise;
    await ownedDispose?.();  // no-op when the caller supplied the MongoClient
  } catch { /* swallow */ }
  closed = true;
}
```

**If your extension uses `mongo({ mongoClient: someClient })`** and previously called `db.close()` expecting `someClient` to be closed, your test suite will now show the `MongoClient` outliving the facade. Two ways to migrate:

- **Switch to a `{ url }` binding.** If your extension constructs the `MongoClient` purely to hand it to `mongo()`, drop the manual construction — pass the connection string in `{ url }` and let the facade own the client.
- **Close the `MongoClient` explicitly.** If your extension genuinely needs to share a `MongoClient` across multiple consumers (e.g. one client backs several `mongo()` facades, or the client is held in a higher-level connection-management seam), keep the `{ mongoClient }` binding and add `await someClient.close()` after your last facade is disposed.

No script — the right migration depends on why your extension was sharing the client in the first place. Walk the call sites by hand.

## Validation by execution

This transition's entries are prose-only (no scripts). The substrate diff on `packages/3-extensions/` is additive (new methods on the three official facades) plus the Mongo behaviour change documented above. There is no codemod to apply against a reverted substrate — the framework change *is* the new surface, and these instructions describe the consumer-side translation, not a substrate transform.

The release-pipeline gate (`pnpm check:upgrade-coverage`) is satisfied by this directory existing with at least one entry. The substantive verification of the consumer-facing translation lives in the published skill's per-step bump-install-instructions-validate-commit loop, which runs in extension authors' own CI.
