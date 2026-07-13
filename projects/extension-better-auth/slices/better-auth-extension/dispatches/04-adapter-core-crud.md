# Brief: D4 adapter-core-crud

## Task

Ship the `/adapter` subpath of `@prisma-next/extension-better-auth`: `prismaNextAdapter(db)` built on `createAdapterFactory` from `better-auth/adapters` (v1.5+), covering `create`, `findOne`, `findMany`, `update`, `updateMany`, `delete`, `deleteMany`, `count` — **such that** every BetterAuth operation reaches the database exclusively through the contract-typed ORM collections of the `better-auth` space (no stringly-typed passthrough into SQL), unknown models / fields / where-operators fail fast with a typed adapter error naming the offending surface, and the BetterAuth-model→collection mapping is exhaustively checked against the space's model set at compile time (a model added to the contract without a mapping — or vice versa — fails `pnpm typecheck`). Adapter config declares `adapterId: 'prisma-next'`, `supportsDates: true`, `supportsBooleans: true`, `supportsJSON: true`, `supportsNumericIds: false`. Where-clause translation covers BetterAuth's operator set (`eq` default, `ne`, `lt`, `lte`, `gt`, `gte`, `in`, `not_in`, `contains`, `starts_with`, `ends_with`; connectors `AND`/`OR`) and `findMany`'s `sortBy` / `limit` / `offset`. `consumeOne`, `transaction`, and `join` are explicitly D5 — configure honestly in the meantime (no fake `transaction: true`).

The input type (working name `BetterAuthDb`) is the minimal structural surface the adapter needs — the four typed collections (+ later transaction) from a `Db`/orm client whose aggregate includes the space. Design it so an app passes its ordinary `db` (or `db.orm`) without ceremony; verify against how `orm()` / the runtime facade expose collections (grep `sql-orm-client` exports and the supabase runtime for the shape precedent).

## Scope

**In:** `packages/3-extensions/better-auth/src/adapter/**` (new), `src/exports/adapter.ts`, package.json (`/adapter` export; `better-auth` as `peerDependency` + `devDependency` — pin per workspace policy, `catalog:` if a catalog entry exists or add one; surface if the policy is ambiguous), tsdown/tsconfig updates for the new entry, package-level tests (`test/adapter-*.test.ts`): type-level exhaustiveness tests, where-translation behavioural tests, typed-error tests, and CRUD behavioural tests against a real PGlite-backed db if cheaply constructible in-package (grep how sibling packages stand up PGlite in unit tests; if not cheap, translation-level tests suffice here — D6's conformance suite is the full behavioural net), plus lockfile.

**Out:** `consumeOne` / `transaction` / `join` (D5); `test/integration/**` (D6); contract/space/handles changes; framework packages. Tree-shaking guard: `/pack` and `/contract` must not import `better-auth` — only `/adapter` may.

## Completed when

- [ ] `prismaNextAdapter(db)` returns a `better-auth`-consumable adapter covering the eight methods; package tests prove where-operator translation (all operators + connectors), typed errors for unknown model/field/operator, and the compile-time exhaustiveness property (type-level test that fails if the model map and the space's model set diverge).
- [ ] Values cross through contract codecs: a `Date` written through `create` round-trips as `timestamptz`, booleans as `bool` (behavioural test at whatever seam you chose; if translation-level only, assert the codec-typed collection API is what receives the values).
- [ ] Gates: package build + test + typecheck (incl. test project) + lint; workspace `pnpm typecheck`; `pnpm lint:deps`; grep gate — `better-auth` imports appear only under `src/adapter/**` + tests.

## Standing instruction

Stay focused on the goal; control scope. Trivial-and-related fixes with a one-line note; drift halts and surfaces.

## References

(Resumed — new context only.)

- Slice plan § D4; slice spec § Chosen design → Adapter (method mapping table, `BetterAuthDb` sketch); project spec § Settled decisions (numeric ids, dependency posture).
- BetterAuth adapter guide: https://www.better-auth.com/docs/guides/create-a-db-adapter (`createAdapterFactory` config + adapter method signatures — re-verify against the installed package's types, which are authoritative over docs).
- ORM surface: `packages/3-extensions/sql-orm-client/` (Collection API: `where/first/all/create/update/updateCount/delete/deleteCount/count`, filter callbacks for non-eq operators).
- Calibration: F5, F14 (gates mirror CI; typecheck covers tests), F16 (lint:deps hard gate — new dep edges must be legal for the extensions layer), F17 (the win is the typed-seam property, not method count), F21 (build the real adapter surface; no option-bag indirection), dod.md § Test-dispatch overlay ("fails iff" + right surface), no-bare-casts rule (`blindCast`/`castAs` with reasons where the better-auth interface forces widening).
- Slice-plan open item: `better-auth` version pinning — resolve against workspace precedent (`jose` in supabase is direct semver `^6`; catalog is used for shared third-party deps). Note your choice + rationale; surface only if genuinely ambiguous.

## Operational metadata

- **Model tier:** orchestrator — design-bearing (typed seam over a third-party stringly-typed interface; first of its kind in the repo).
- **Time-box:** 2 h. Overrun → halt with snapshot.
- **Halt conditions:** `createAdapterFactory`'s actual v1.5+ interface diverges from the spec's assumptions in a way that breaks the typed-seam property (falsified assumption, I12); the ORM collection surface can't express a required operator without raw-SQL escape (surface — don't hand-roll SQL); `better-auth` install pulls incompatible peer constraints; diff exceeds ~20 files excluding lockfile.
- **Progress notes:** heartbeats at phase transitions.
