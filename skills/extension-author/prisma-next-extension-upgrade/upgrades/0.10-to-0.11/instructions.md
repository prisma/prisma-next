---
from: "0.10"
to: "0.11"
changes:
  - id: namespace-kind-required-on-handcrafted-contract-literals
    summary: Add the `kind` discriminator (`'sql-namespace'` for SQL namespaces; `'mongo-namespace'` for Mongo namespaces) to every handcrafted `Contract<{ namespaces: { ... } }>` type literal in extension test-d files and inline-typed fixtures. The framework `Namespace` interface tightened `kind` from optional to required; emitted `contract.d.ts` literals carry it automatically, but anything you write by hand will fail typecheck without it.
    detection:
      glob: "**/*.test-d.ts"
      contains:
        - "Contract<"
        - "namespaces"
      anyMatch: true
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
  - id: sql-orm-client-nested-includes-single-query-at-depth-2
    summary: SQL ORM client — nested includes at depth ≥ 2 now collapse to a single-query strategy on capable targets; non-leaf `.distinct()` combined with nested includes now throws at plan / dispatch time.
    detection:
      glob: "**/*.{ts,tsx}"
      contains:
        - "@prisma-next/sql-orm-client"
      anyMatch: true
---

# 0.10 → 0.11 — Extension-author upgrade instructions

## `namespace-kind-required-on-handcrafted-contract-literals`

Starting at the 0.11 release, the framework `Namespace` interface tightens `kind` from optional (inherited from `IRNode`) to required. Any **handcrafted** `Contract<{ namespaces: { ... } }>` type literal — typically used in extension test-d files and inline-typed fixtures — must add `kind: 'sql-namespace'` (or `'mongo-namespace'`) to each namespace literal or TypeScript will reject the literal as not structurally assignable to `Namespace`.

This **does not** affect:

- Real `contract.d.ts` files emitted by `prisma-next contract emit`. The emitter prints `kind` automatically.
- Real `contract.json` envelopes. The runtime `kind` field is non-enumerable on namespace class instances, so it doesn't surface in the JSON on-disk envelope and the byte hash is unchanged.
- Plain-literal `Contract` values constructed at runtime (the framework only tightens the **type** declaration of `kind`; the runtime walks tolerate missing values).

It **does** affect:

- `.test-d.ts` files in extension packages that handcraft `Contract<{ namespaces: { __unbound__: { id, tables, ... } } }>` literals to assert generic-inference shapes. Each namespace literal needs `kind: 'sql-namespace'` (SQL namespaces) or `kind: 'mongo-namespace'` (Mongo namespaces) added alongside `id`.
- Any inline-typed fixture file (`test/fixtures/*.d.ts`, etc.) that mirrors what the emitter would produce for testing.

### Before 0.11

```ts
type ContractUnderTest = Contract<
  SqlStorage<string> & {
    readonly namespaces: {
      readonly __unbound__: {
        readonly id: '__unbound__';
        readonly tables: {
          readonly user: {
            // ... columns, primaryKey, etc.
          };
        };
      };
    };
    readonly storageHash: StorageHash;
  },
  // ...
>;
```

### Starting at 0.11

```ts
type ContractUnderTest = Contract<
  SqlStorage<string> & {
    readonly namespaces: {
      readonly __unbound__: {
        readonly id: '__unbound__';
        readonly kind: 'sql-namespace'; // ← new: required
        readonly tables: {
          readonly user: {
            // ... columns, primaryKey, etc.
          };
        };
      };
    };
    readonly storageHash: StorageHash;
  },
  // ...
>;
```

### Mapping table

| Namespace family | Discriminator literal | Where it surfaces in handcrafted types |
|---|---|---|
| SQL (`SqlNamespace`, `SqlUnboundNamespace`) | `'sql-namespace'` | Anywhere you write `Contract<{ namespaces: { … } }>` with a SQL-style namespace |
| Mongo (`MongoNamespace`, `MongoUnboundNamespace`) | `'mongo-namespace'` | Anywhere you write `Contract<{ namespaces: { … } }>` with a Mongo-style namespace |
| Postgres (`PostgresSchema`, when handcrafted) | `'postgres-schema'` or `'postgres-unbound-schema'` | Rare in extension code; only needed if you handcraft a literal with a Postgres-specific namespace class |

### Detection

Run the matcher's grep over your extension's source:

```bash
rg --files-with-matches -t ts -e 'Contract<' -e 'namespaces' -g '**/*.test-d.ts'
```

For each match, open the file and add the `kind` literal to every namespace entry under `namespaces:`. If you have many such literals, a regex-driven mechanical pass works (e.g. find every `readonly id: '<ns-id>';` inside a `namespaces:` block and inject `readonly kind: 'sql-namespace';` immediately after).

### Why the change

The framework needs every namespace IR node to carry its family discriminator at the type level so that cross-family namespace walks (the new `elementCoordinates(storage)` surface in `@prisma-next/framework-components/ir`) can dispatch on a known-present `kind`, not an optional one.

The runtime invariant has always held — every concrete namespace class sets `kind` non-enumerably via `Object.defineProperty(this, 'kind', { value, enumerable: false })` in its constructor. The type tightening makes the invariant honest at the consumer surface.

### What you do **not** need to change

- No `.d.ts` regeneration is needed. Run `prisma-next contract emit` only as part of your normal authoring flow; the emitter handles the `kind` field for you.
- No `contract.json` snapshot changes. The hash inputs are unchanged because `kind` is non-enumerable on namespace class instances.
- No runtime API changes. Extension factories that construct namespaces via `new SqlStorage(...)`, `new PostgresSchema(...)`, etc. are unchanged — the constructors continue to materialise `kind` non-enumerably.

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

## `sql-orm-client-nested-includes-single-query-at-depth-2`

Starting at the 0.11 release, the SQL ORM client (`@prisma-next/sql-orm-client`) changes how it picks an include-execution strategy for nested includes.

### Behaviour change

Previously, any include tree of depth ≥ 2 was executed as a **multi-query** fan-out (one root query plus one follow-up query per nested level). Starting at 0.11, the client first attempts a **single-query** plan (`joinChain`-style nested-JSON aggregation) on capable SQL targets, and only falls back to multi-query when the target or the descriptor shape cannot honour the single-query plan.

This is a bugfix that makes nested includes behave the way the documented surface already describes: fewer issued SQL statements per query on capable targets, identical row results, identical typed surface. No public API was renamed or removed.

### Recursive scalar / combine gate

The existing rejection of unsupported scalar selectors and `combine()` descriptors on nested includes is now applied recursively rather than only at the top level — the same predicate runs at every depth of the include tree. Trees that previously fell through to the multi-query path with a nested `count()` / `combine()` now route through the same recursion-aware multi-query gate.

### Who is affected

The small subset of extension authors who consume `compileSelectWithIncludeStrategy` directly to introspect plan shape may see different plans on capable targets at depth ≥ 2 (single-query JSON aggregate inside the root statement, instead of follow-up statements). Plan-shape assertions in such test suites may need updating, or — if a specific strategy must be exercised — pin the strategy explicitly in the test.

### Validation

After updating any plan-shape assertions or include-tree shapes flagged above, run `pnpm typecheck && pnpm test` (or your extension's equivalent). The pin set is unchanged for this transition; `prisma-next-check-pins` should pass without changes.

## Validation by execution

These entries are prose-only (no scripts). The substrate diff on `packages/3-extensions/` is additive (new methods on the three official facades, plus the SQL ORM client nested-includes collapse) and the Mongo behaviour change documented above; the `namespace-kind-required-on-handcrafted-contract-literals` entry covers a type-only tightening with no runtime substrate transform. There is no codemod to apply against a reverted substrate — the framework changes *are* the new surfaces, and these instructions describe the consumer-side translation, not a substrate transform.

The release-pipeline gate (`pnpm check:upgrade-coverage`) is satisfied by this directory existing with at least one entry. The substantive verification of the consumer-facing translation lives in the published skill's per-step bump-install-instructions-validate-commit loop, which runs in extension authors' own CI.
