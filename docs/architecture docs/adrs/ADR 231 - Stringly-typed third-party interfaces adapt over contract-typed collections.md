# ADR 231 — Stringly-typed third-party interfaces adapt over contract-typed collections

**Status:** Accepted (2026-07-13)

Third-party libraries that bring their own persistence protocol — auth frameworks, job queues, feature-flag engines — speak a *stringly-typed* data interface: model and field names arrive as strings, values as plain JS, operators as tagged unions, chosen at runtime by library code the application never sees:

```ts
// What the third-party library calls (BetterAuth's adapter protocol):
adapter.create({ model: 'user', data: { email, name, createdAt } });
adapter.findMany({ model: 'session', where: [{ field: 'userId', operator: 'eq', value }] });
```

The decision: such an interface is implemented as an **adapter over the extension's contract-typed collections** — never over raw SQL, and never by widening the contract surface to `Record<string, unknown>`. The adapter is the boundary where stringly-typed requests are checked against the contract and either become typed collection operations or fail fast with a typed error.

```ts
// What the adapter does with it (worked example: @prisma-next/extension-better-auth/adapter):
const spaceModel = resolveSpaceModel(model);   // 'user' → 'User', or typed UNKNOWN_MODEL error
assertKnownFields(model, spaceModel, data);    // unknown field → typed UNKNOWN_FIELD error
const collection = db.orm.public[spaceModel];  // contract-typed collection
return collection.create(data);                // codecs cross inside the collection (obligation 2)
```

## The pattern's five obligations

### 1. A typed model map, exhaustive against the space contract

The adapter's model vocabulary is a literal map from the space contract's model names to the library's names, with exhaustiveness enforced at the type level:

```ts
export type SpaceModelName = keyof Contract['domain']['namespaces']['public']['models'] & string;

export const BETTER_AUTH_MODEL_BY_SPACE_MODEL = {
  User: 'user',
  Session: 'session',
  Account: 'account',
  Verification: 'verification',
} as const satisfies Record<SpaceModelName, string>;
```

The `satisfies` bound cuts both ways: a model added to the contract without a mapping fails `pnpm typecheck` as a missing key; a mapping for a model the contract no longer defines fails as an excess property. The map — not the library's runtime strings — is the source of truth for what the adapter serves.

### 2. All data crosses the codec boundary through the collections

The adapter neither renders SQL nor touches wire values. Collection operations carry values through the contract's codecs in both directions, so the library receives exactly the JS types the contract declares (e.g. `Date` for timestamptz) and never sees driver renderings. If the library hands over a value the codec rejects, the failure names the column and codec — the adapter adds no second, shadow type system.

### 3. Unknown surfaces fail fast with typed errors

Every stringly-typed input that cannot be resolved against the contract is rejected *before* any query is built, with an error that names the offending surface:

```ts
export type PrismaNextAdapterErrorCode =
  | 'UNKNOWN_MODEL'          // plugin tables, custom models
  | 'UNKNOWN_FIELD'          // additionalFields the space does not define
  | 'UNSUPPORTED_OPERATOR'
  | 'UNSUPPORTED_WHERE_MODE' // e.g. case-insensitive comparison
  | 'INVALID_OPERATOR_VALUE'
  | 'UNKNOWN_JOIN_RELATION';
```

This is the honest posture for a **fixed managed space**: the library's schema-mutating conveniences (plugin tables, ad-hoc fields, renamed models) are non-goals, and the adapter says so with an actionable message rather than leaking a stringly-typed name into a query. The same honesty applies to capability flags the adapter reports to the library (`supportsNumericIds: false` because the space's ids are text — not a shim that fakes numeric ids).

### 4. Native capabilities map to native collection surfaces

Where the library's protocol has a semantic requirement, the adapter maps it to the collection surface that actually carries that semantic — not to a lowest-common-denominator emulation:

- **Atomic consume** (single-use tokens): the collection's atomic delete returns the deleted row, so exactly one concurrent consumer wins — no read-then-delete race.
- **Transactions**: the adapter's transaction hook opens `db.transaction(…)` and *rebinds a fresh adapter to the transaction scope's collections*, so every operation the library performs inside the callback rides the same transaction and rolls back with it.
- **Joins**: the library's join requests are served natively through `include()` on the relations the space contract declares (backrelations included, so reverse joins work). A join the contract cannot express is a typed `UNKNOWN_JOIN_RELATION` failure, not a silent extra query.

### 5. Consumption is two views over one database

The consuming app constructs the adapter over the **space-contract view**, not the app's aggregate: the aggregate contract records pack models as cross-space references only (they are not navigable domain models there — see [ADR 226](./ADR%20226%20-%20Cross-contract%20foreign-key%20references.md) on the deferred cross-space query model), so the collections the adapter needs exist only on a client typed by the pack's own contract. The app's own client is constructed over the aggregate (with the pack's `/runtime` descriptor satisfying the requirement check); both share one connection pool, and marker verification runs on the aggregate client — the marker names the aggregate, and the space client is a partial view of the same database.

## Consequences

- The third-party library gets the exact behaviour of the contract: constraints, codecs, atomicity — because it runs *through* the same collections the app uses, with no parallel query path to drift.
- Contract evolution is compile-time visible in the adapter: the exhaustive model map turns a schema change into a typecheck failure at the integration point.
- The adapter is auditable as a boundary: every accepted surface is enumerable (the model map, the operator table); everything else is a typed rejection.
- The library's own conformance suite becomes a meaningful CI surface, since the adapter makes no behavioural shortcuts a suite would paper over.

## Alternatives considered

- **A raw-SQL adapter** (render the library's requests to SQL directly): bypasses codecs and contract validation, duplicates the query pipeline, and silently accepts surfaces the contract does not define. Rejected — it recreates the schema-drift problem these extensions exist to remove.
- **Widening the ORM surface to accept string model names** (`db.orm.collection(name)`): destroys the type-level exhaustiveness property and moves validation from the adapter's single boundary into every call site. Rejected.
- **Folding pack models into the app's aggregate contract** so one client serves both the app and the adapter: makes the aggregate's type surface depend on pack internals and prejudges the cross-space query model that ADR 226 deliberately defers. Rejected for now; if cross-space traversal lands, the two-views shape can collapse without changing the adapter's other obligations.

## Worked example

`@prisma-next/extension-better-auth` (`packages/3-extensions/better-auth/`): the `/adapter` subpath implements BetterAuth's adapter protocol with all five obligations; `examples/better-auth` shows the two-views consumption; the package README documents the consumer architecture.
