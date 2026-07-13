# Slice: better-auth-extension

_(Parent project `projects/extension-better-auth/`. Outcome this slice contributes: the entire project — single-PR delivery per operator decision.)_

## At a glance

Ships `@prisma-next/extension-better-auth` (`packages/3-extensions/better-auth/`): a managed contract space defining BetterAuth's four core models, a contract-typed BetterAuth database adapter, PGlite-backed integration tests (BetterAuth's official conformance suite + a real `betterAuth()` flow), and `examples/better-auth`. One PR closes TML-2994 (carrier), TML-2995, TML-2996.

## Chosen design

The project spec (`../../spec.md`) carries the settled system-level design; this section pins the slice-level concretions.

### Package layout (mirrors `packages/3-extensions/supabase`)

```
packages/3-extensions/better-auth/
├── package.json                  # exports: /pack, /contract, /adapter (subpath-only; no root export)
├── src/
│   ├── contract/
│   │   ├── contract.prisma       # PSL source of the space (if PSL supports the needed constraints; else hand-authored JSON only)
│   │   ├── contract.json         # canonical space IR (emitted or hand-authored, following supabase precedent)
│   │   ├── contract.d.ts         # emitted types (same pipeline: `prisma-next contract emit`)
│   │   └── handles.ts            # extensionModel-branded handles: User, Session, Account, Verification
│   ├── pack/index.ts             # SqlControlExtensionDescriptor<'postgres'>, spaceId 'better-auth', managed control
│   ├── adapter/                  # prismaNextAdapter(...) via createAdapterFactory
│   ├── runtime/descriptor.ts     # SqlRuntimeExtensionDescriptor (amended 2026-07-13, I12: required for aggregate-contract client construction; pgvector precedent — descriptor only, no facade)
│   └── exports/{pack,contract,adapter,runtime}.ts
├── migrations/                   # baseline migration package + refs/head.json (pgvector precedent)
└── test/                         # package-level unit tests (mapping exhaustiveness, error surfaces)
```

- **Pack descriptor**: follows `supabase/src/pack/index.ts` shape (`kind: 'extension'`, `familyId: 'sql'`, `targetId: 'postgres'`, `contractSpace: { contractJson, migrations, headRef }`) — but `migrations` is non-empty: the baseline package creates the four tables (pgvector's `contractSpaceFromJson` + on-disk migration import pattern).
- **Contract space content**: models `User`, `Session`, `Account`, `Verification`; tables `user`, `session`, `account`, `verification` in `public`; text ids; `Session.userId → User.id` and `Account.userId → User.id` as navigable relations **with `onDelete: Cascade`** (amended 2026-07-13, operator decision 1a: BetterAuth's canonical schema declares `on delete cascade`; the original spec's transcription omitted referential actions and D6's conformance run falsified the omission) **and `User → Session[]` / `User → Account[]` backrelations** (D6 carry-over 2, landed); unique on `User.email`, `Session.token`; timestamps `createdAt`/`updatedAt` on all four; field set per BetterAuth core schema (`https://www.better-auth.com/docs/concepts/database#core-schema`). Control policy: `managed` (contract default — no `defaultControlPolicy: 'external'`).

### Adapter (`/adapter`)

```ts
export function prismaNextAdapter(db: BetterAuthDb): AdapterFactory; // hand to betterAuth({ database: ... })
```

- Built on `createAdapterFactory` from `better-auth/adapters` (v1.5+): config `adapterId: 'prisma-next'`, `supportsDates: true`, `supportsBooleans: true`, `supportsJSON: true`, `supportsNumericIds: false`, `transaction` wired onto the runtime's transaction API.
- `BetterAuthDb` is the minimal structural type the adapter needs — a `Db` whose contract aggregate includes the `better-auth` space (the four typed ORM collections + `transaction`). Strong typing: an internal `modelMap` from BetterAuth default model names (`user`/`session`/`account`/`verification`) to typed collection accessors, exhaustively checked against the space's model set at compile time (adding a model to the contract without a mapping fails `pnpm typecheck`).
- Method mapping: `create` → `Collection.create`; `findOne`/`findMany` → `where/first/all` with `sortBy`/`limit`/`offset`; `update` → `where().update`; `updateMany` → `updateCount`; `delete` → `where().delete` (discard row); `deleteMany` → `deleteCount`; `count` → `count`; `consumeOne` → `where().delete()` returning the row (atomic DELETE…RETURNING inside `withMutationScope`); `join` → `Collection.include()` over the space's navigable relations.
- BetterAuth `where` operators (`eq`, `ne`, `lt`, `lte`, `gt`, `gte`, `in`, `not_in`, `contains`, `starts_with`, `ends_with`, connectors `AND`/`OR`) translate to typed collection filters; unsupported operator or unknown model/field → typed `PrismaNextAdapterError` naming the surface.

### Tests

- **Package-level** (`packages/3-extensions/better-auth/test/`): mapping exhaustiveness (type-level test), where-translation units, typed error surfaces.
- **Integration** (`test/integration/test/`): (a) BetterAuth conformance suite via `testAdapter`/`createTestSuite` from `@better-auth/test-utils/adapter` over PGlite, `runMigrations` implemented with the framework's migrate path (no manual SQL); (b) managed-space lifecycle test: fresh PGlite → emit + `db init` creates the four tables, `db update` no-op at head; (c) end-to-end `betterAuth()` email/password sign-up → session retrieval through the adapter.

### Example (`examples/better-auth`)

Follows `examples/supabase` conventions: `prisma-next.config.ts` with `extensionPacks: [betterAuthPack]`, app contract with a `Profile` model carrying a cross-space FK onto the branded `User` handle, a minimal server exposing BetterAuth's handler (sign-up → authenticated request), README documenting emit → db init → run.

## Coherence rationale

Operator-decided single-PR delivery: the three phases are a strict dependency chain (adapter compiles against the space's `contract.d.ts`; example consumes the adapter), and the PR tells one story — "prisma-next can host BetterAuth end-to-end." The phase structure in `plan.md` is the reviewer's reading order.

## Scope

**In:** `packages/3-extensions/better-auth/**` (new), `architecture.config.json` (register package), `test/integration/**` (new test files + `better-auth` dev-deps), `examples/better-auth/**` (new), extension-authoring doc references, ADR if judged durable, workspace manifest/lockfile.

**Out:** framework contract surface (`packages/1-framework/**`) — any gap found there is a stop-condition, not silent scope; target adapters (`packages/3-targets/**`); BetterAuth plugin tables / `additionalFields`; non-postgres targets; BetterAuth CLI hooks (`createSchema`); publishing workflow changes.

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
| --------- | ----------- | ----- |
| `user` is a reserved-ish identifier in Postgres | Rely on adapter identifier quoting; integration test covers CRUD against `"user"` | Verified: postgres adapter quotes identifiers |
| BetterAuth generates string ids (`useNumberId` unsupported) | `supportsNumericIds: false`; ids are `text` | Settled in project spec |
| Concurrent `consumeOne` on the same verification row | Native `Collection.delete()` is atomic (find-first + narrowed DELETE…RETURNING in one transaction); loser gets `null` | Verified against `sql-orm-client` source |
| Conformance suite may create/drop rows across tables between tests | `testAdapter` handles table cleanup; `runMigrations` must be idempotent (db init no-op at head) | From BetterAuth adapter-testing docs |
| PGlite vs real `pg` driver differences | Integration lane uses PGlite (repo standard); no external DB in CI | Repo testing convention |

## Slice-specific done conditions

Beyond CI-green + reviewer-accept + project-DoD floor (the project spec's DoD carries the full list — single-slice project):

- [ ] BetterAuth official conformance suite (incl. join coverage) green in `pnpm test:integration`.
- [ ] Managed-space lifecycle proven: fresh DB emit + `db init` creates tables; `db update` no-op at head.
- [ ] `examples/better-auth` runs end-to-end per its README with no manual SQL.
- [ ] Grep gate: no `projects/extension-better-auth` references in long-lived files at PR time.

## Open Questions

None — all shaping-time questions resolved in the project spec (see `../../spec.md § Settled decisions`). Design forks surfacing at dispatch time halt per I12.

## References

- Parent project: `projects/extension-better-auth/spec.md`, `projects/extension-better-auth/plan.md`
- Linear: [TML-2994](https://linear.app/prisma-company/issue/TML-2994) (carrier; PR prefix `tml-2994:`), sub-issues [TML-2995](https://linear.app/prisma-company/issue/TML-2995), [TML-2996](https://linear.app/prisma-company/issue/TML-2996)
- Precedents: `packages/3-extensions/supabase` (layout, pack, handles), `packages/3-extensions/pgvector` (space with migrations), `examples/supabase` (example shape)
- BetterAuth: [Create a Database Adapter](https://www.better-auth.com/docs/guides/create-a-db-adapter), [core schema](https://www.better-auth.com/docs/concepts/database#core-schema)
