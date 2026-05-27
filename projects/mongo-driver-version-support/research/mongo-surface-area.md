# Mongo driver surface-area reconnaissance

Reference artifact for TML-2663. Maps every place the repo touches the
`mongodb` npm driver, identifies the API symbols we depend on, projects
those onto the v6 → v7 (and prospective v8) breaking-change surface, and
synthesises a "what changes per support-policy choice" matrix.

All paths are repo-relative. The workspace catalog currently pins
`mongodb: ^6.16.0` (`pnpm-workspace.yaml:23`). The latest published major
of the driver as of 2026-05-22 is **v7.2.0** (released 2026-04-17); v8
does **not** exist yet — the ticket's "v8" target is hypothetical.

---

## Section 1 — Declarations of `mongodb` as a dependency

12 `package.json` files mention `mongodb`. Every declaration uses the
workspace catalog entry (`mongodb: catalog:` → `^6.16.0`).

### Classification key

- **runtime-consumer** — the package imports values or types from
  `mongodb` in its source (non-test) tree.
- **types-only** — declared on the package but only `import type` usage
  in source (none observed; see notes per row).
- **dev/test-only** — declared in `devDependencies`; mongodb imports are
  only in test files / `setup.ts`.
- **re-exporter** — the package exports values or types that originate
  from `mongodb` via an `src/exports/**` barrel listed in the package's
  `exports` map.
- **stale-runtime-dep** — the package declares `mongodb` in
  `dependencies` but its `src/` tree never imports from it (no direct or
  type-only references). Likely vestigial.

### Workspace packages

| Package | Path | Field | Specifier | Domain / Layer / Plane | Classification |
| --- | --- | --- | --- | --- | --- |
| `@prisma-next/driver-mongo` | `packages/3-mongo-target/3-mongo-driver/package.json` | `dependencies` | `catalog:` (`^6.16.0`) | targets / drivers / runtime | **runtime-consumer** (constructs `MongoClient`, holds `Db`; see `src/mongo-driver.ts:20`, `src/exports/control.ts:7`) |
| `@prisma-next/adapter-mongo` | `packages/3-mongo-target/2-mongo-adapter/package.json` | `dependencies` | `catalog:` | targets / adapters / mixed (shared + migration + runtime) | **runtime-consumer** (`ObjectId`, `MongoServerError`, type-only `Db`, `Document`, `UpdateFilter`; six files under `src/core/**`) |
| `@prisma-next/target-mongo` | `packages/3-mongo-target/1-mongo-target/package.json` | `dependencies` | `catalog:` | extensions / targets / shared+runtime | **stale-runtime-dep** (no `from 'mongodb'` import in `src/`; only test files import the driver) |
| `@prisma-next/family-mongo` | `packages/2-mongo-family/9-family/package.json` | `dependencies` | `catalog:` | mongo / family / shared+migration | **stale-runtime-dep** (no `from 'mongodb'` import in `src/`; only the string literal `'mongodb-shell'` in `src/core/operation-preview.ts`) |
| `@prisma-next/mongo` | `packages/3-extensions/mongo/package.json` | `dependencies` | `catalog:` | extensions / adapters / mixed | **re-exporter + runtime-consumer** (re-exports `Binary, Decimal128, Long, MongoClient, ObjectId, Timestamp` from `src/exports/bson.ts`; accepts user-supplied `MongoClient` in `src/runtime/binding.ts` / `src/runtime/mongo.ts:55` and re-exports `MongoBinding`/`MongoBindingInput`/`MongoClient`-typed options via `src/exports/runtime.ts`) |
| `@prisma-next/mongo-runtime` | `packages/2-mongo-family/7-runtime/package.json` | `devDependencies` | `catalog:` | mongo / runtime / runtime | **dev/test-only** (`test/setup.ts`, `test/codecs/decoding.test.ts`, `test/decode-via-query-builder.test.ts`) |
| `@prisma-next/mongo-orm` | `packages/2-mongo-family/5-query-builders/orm/package.json` | `devDependencies` | `catalog:` | mongo / query-builders / runtime | **dev/test-only** (`test/integration/polymorphism.test.ts`, `test/integration/orm-ergonomics.test.ts`) |

### Test harnesses and example apps

| Package | Path | Field | Specifier | Classification |
| --- | --- | --- | --- | --- |
| `@prisma-next/integration-test` | `test/integration/package.json` | `devDependencies` | `catalog:` | dev/test-only (heavy: 13+ mongo e2e/integration test files) |
| `cli-e2e-test-app` (fixture) | `test/integration/test/fixtures/cli/cli-e2e-test-app/package.json` | `dependencies` | `catalog:` | dev/test-only (fixture only; no source imports) |
| `mongo-demo` (example) | `examples/mongo-demo/package.json` | `dependencies` | `catalog:` | runtime-consumer (5 test files import `MongoClient`) |
| `retail-store` (example) | `examples/retail-store/package.json` | `dependencies` | `catalog:` | runtime-consumer (`scripts/reset-db.ts`, 4 test files) |
| `mongo-blog-leaderboard` (example) | `examples/mongo-blog-leaderboard/package.json` | `dependencies` | `catalog:` | runtime-consumer (`test/leaderboard.test.ts`) |

### Companion dependency: `mongodb-memory-server`

`mongodb-memory-server` is pinned to **`11.1.0`** in the catalog
(`pnpm-workspace.yaml:24`). Memory-server v11.x bundles **driver 7.x**
internally (see typegoose changelog: "deps(mongodb): upgrade to 7.0.0").
With our catalog at `mongodb ^6.16.0` and `mongodb-memory-server 11.1.0`,
two driver majors can already coexist in the install graph. This is
worth confirming during the design discussion — it suggests there may
already be an unintentional driver-version conflict in our test
environment, or pnpm is hoisting one of them.

### Stale-dep findings (pre-flagged)

- `@prisma-next/target-mongo` and `@prisma-next/family-mongo` declare
  `mongodb` in `dependencies` but no `src/**` file imports from it.
  These declarations look vestigial — almost certainly fallout from an
  earlier refactor that moved direct driver usage into `adapter-mongo`
  and `driver-mongo`. Worth dropping in the same change as any
  version-policy update; otherwise they keep pinning users to the
  workspace's chosen `mongodb` major even though those packages don't
  need it.

---

## Section 2 — `mongodb` API surface we actually use

Exhaustive over `from 'mongodb'` imports in repo source + tests (excluding `dist/`, `node_modules/`). Every Prisma Next mongo import uses the bare entry point `'mongodb'` — no subpath imports (e.g. `mongodb/lib/...`) anywhere.

### Symbol-by-symbol surface

| Symbol | Type/Value | What we use it for | Importing packages (sample path:line) |
| --- | --- | --- | --- |
| `MongoClient` | value (class) | Connect to mongod from our control driver + runtime driver; passed back to users as part of the binding API; instantiated with `driverInfo` for telemetry. | `driver-mongo/src/mongo-driver.ts:20`, `driver-mongo/src/exports/control.ts:7`, `mongo/src/runtime/binding.ts:1`, `mongo/src/exports/bson.ts:1` (re-export), `mongo/src/runtime/mongo.ts:55` (in `MongoBindingOptions`) |
| `MongoClient` (type-only) | type | Type the user-supplied client on `MongoBindingOptions.mongoClient`. | `mongo/src/runtime/mongo.ts:55`, `mongo/src/runtime/binding.ts:1` |
| `Db` | type-only | Pass DB handles across the adapter / driver / runner-deps seams. Most pervasive type import. | `adapter-mongo/src/core/{mongo-control-driver,marker-ledger,introspect-schema,command-executor,runner-deps}.ts`, `driver-mongo/src/mongo-driver.ts:20`, `driver-mongo/src/exports/control.ts:7` |
| `Document` | type-only | Generic shape of BSON docs returned by listIndexes / listCollections / aggregate; also the index keyspec type. | `adapter-mongo/src/core/command-executor.ts:13`, `adapter-mongo/src/core/introspect-schema.ts:9`, `adapter-mongo/src/core/marker-ledger.ts:9` |
| `UpdateFilter` | type-only | Type the update-doc payload for marker-ledger CAS writes (`updateOne` filter expressions). | `adapter-mongo/src/core/marker-ledger.ts:9` |
| `ObjectId` | value (class) | Round-trip codec: decode wire `ObjectId` to hex string, encode user string back to `ObjectId`. Only mongodb value class used outside `MongoClient` in our own source. | `adapter-mongo/src/core/codecs.ts:9` |
| `MongoServerError` | value (class) | Catch + special-case `error.code === 26` (NamespaceNotFound) when listing indexes. | `adapter-mongo/src/core/command-executor.ts:13,79` |
| `Binary`, `Decimal128`, `Long`, `Timestamp` | value (classes) | **Re-exported only**; not consumed in our source. Re-export keeps the BSON value classes on `@prisma-next/mongo/bson` so users don't have to add `mongodb` as a direct dep when authoring contracts that materialise these types. | `mongo/src/exports/bson.ts:1` |

#### Test-only symbol usage

Tests use the same value classes — `MongoClient`, `ObjectId`,
`MongoServerError` — to spin up real (memory-server-backed) connections
and assert behaviour. No new symbols appear only in tests. Tests live in
`adapter-mongo/test/`, `driver-mongo/test/`, `mongo-runtime/test/`,
`mongo-orm/test/integration/`, `target-mongo/test/`, `test/integration/test/`,
and the three example test trees.

### Driver APIs called on those symbol instances

Sweeping the call sites in `driver-mongo/src/mongo-driver.ts` and
`adapter-mongo/src/core/**`, we exercise (non-exhaustive but a complete
list of distinct call-site verbs):

- `new MongoClient(uri, options)` with `driverInfo`, `serverSelectionTimeoutMS`, `connectTimeoutMS` (`driver-mongo/src/exports/control.ts:39-43`)
- `client.connect()`, `client.close()`, `client.db(name)`
- `db.collection(name)`, `db.createCollection(name, options)`, `db.listCollections().toArray()`, `db.command({ collMod, ... })`
- `collection.insertOne / insertMany / updateOne / updateMany / deleteOne / deleteMany / findOneAndUpdate / findOneAndDelete / aggregate / createIndex / dropIndex / drop / listIndexes()`
- `aggregate(pipeline)` returning an async-iterable cursor that we `yield*` over (`driver-mongo/src/mongo-driver.ts:147-151`)
- `findOneAndUpdate(..., { upsert, returnDocument, sort })`, `findOneAndDelete(..., { sort })` (`driver-mongo/src/mongo-driver.ts:121-145`)
- `new ObjectId(stringValue)`, `objectId.toHexString()`
- `instanceof MongoServerError` + reading `.code` (`adapter-mongo/src/core/command-executor.ts:79`)

We do not currently touch: change streams, transactions / sessions
(`ClientSession`, `withTransaction`), GridFS, AWS auth, CSFLE/QE,
auto-encryption options, cursor `.stream({ transform })`,
`MongoClient.options.metadata` / `additionalDriverInfo` /
`extendedMetadata`, `MONGODB-CR`, `useNewUrlParser`,
`useUnifiedTopology`. (Confirmed by grep for these identifiers in
`packages/` and `examples/`.)

### Re-exports on our public API surface (commitments to users)

Two distinct public commitments to the `mongodb` shape:

1. **`@prisma-next/mongo/bson` barrel**
   (`packages/3-extensions/mongo/src/exports/bson.ts:1`) — re-exports
   `Binary`, `Decimal128`, `Long`, `MongoClient`, `ObjectId`,
   `Timestamp` directly from `'mongodb'`. Documented entry point in
   `package.json` `exports` map.
2. **`@prisma-next/mongo/runtime` — `mongoClient?` option**
   (`packages/3-extensions/mongo/src/runtime/mongo.ts:55`) — declares
   `readonly mongoClient?: import('mongodb').MongoClient`. The whole
   `MongoBindingOptions` interface, plus the `mongo()` factory's
   accepted-args signature, are typed against this. Users who pass
   their own `MongoClient` must hand us an instance from the same
   driver major we resolve internally.

Both are load-bearing for the support-policy decision: changing the
driver major changes the **shape of types we hand users** and the
**concrete classes they need to construct**. Mixing majors in a single
process is unsafe (`instanceof` checks across realms break, BSON class
identity drifts).

---

## Section 3 — `mongodb` v6 → v7 (→ v8) breaking-change surface

Source: official v7.0.0 release notes
(`https://github.com/mongodb/node-mongodb-native/releases/tag/v7.0.0`,
published 2025-11-06) plus the v7.1.x / v7.2.x notes scanned on
`https://github.com/mongodb/node-mongodb-native/releases`. **v8 does not
exist**: latest published major is **v7.2.0 (2026-04-17)**. The "v8"
column below is a no-op — flagged so the design discussion treats v8 as
hypothetical, not a present blocker.

Severity legend:

- **blocker** — touches a symbol or call site we use; needs code
  changes.
- **maintenance** — deprecation we should track; doesn't block adoption
  today.
- **trivial** — touches an area we don't use, or no effective change to
  our call sites.
- **infra** — touches build / install / Node.js / peer-deps rather than
  call sites.

### Breaking changes introduced in v7.0.0

| # | Change | Touches our symbols? | Severity |
| --- | --- | --- | --- |
| B1 | **Minimum Node.js is v20.19.0**; TS target raised to ES2023; native `Symbol.asyncDispose` on `MongoClient` / `ClientSession` / `ChangeStream` / cursors. | Indirect: root `package.json` declares `engines.node >=24` (the `>=20` figure in the brief is out of date), so we satisfy the floor with margin. | **infra** |
| B2 | **`bson` and `mongodb-connection-string-url` bumped to v7.0.0.** BSON re-exports inherit BSON v7 breaking changes. | **Yes** — `Binary`, `Decimal128`, `Long`, `ObjectId`, `Timestamp` re-exported from `@prisma-next/mongo/bson`. Any BSON v7 breaking-change in those classes propagates to our users without our awareness. We need to read the BSON v7 release notes (separate page) before committing. | **blocker** (until BSON v7 review done) |
| B3 | **Optional peer deps bumped**: `@mongodb-js/zstd@^7`, `kerberos@^7`, `mongodb-client-encryption@^7`. | We do not install or document these. | trivial |
| B4 | **`@aws-sdk/credential-providers` is now required for `MONGODB-AWS`.** | We don't use AWS auth. | trivial |
| B5 | **Explicit URI-embedded credentials no longer accepted with `MONGODB-AWS`.** | Same as B4. | trivial |
| B6 | **`Db.dropCollection` returns `false` on `NamespaceNotFound` instead of throwing.** | We call `collection.drop()` (`adapter-mongo/src/core/command-executor.ts:58`) but the behavioural change is "no longer throws"; current code does not special-case the throw, so behaviour shifts from "throw" to "return false". Need to audit whether any caller relies on the throw. | **blocker** (small audit) |
| B7 | **`aggregate` with `writeConcern` + `explain` now throws `MongoServerError` instead of a client-side error.** | We call `aggregate` (`driver-mongo/src/mongo-driver.ts:149`) without `writeConcern`/`explain`. | trivial |
| B8 | **All encryption errors subclass `MongoError`.** | We don't use encryption. | trivial |
| B9 | **`PoolRequstedRetry` error label renamed to `PoolRequestedRetry`.** | We don't read this label. | trivial |
| B10 | **Change streams no longer filter `$changeStream` stage options** (server now validates). | We don't use change streams. | trivial |
| B11 | **Cursors no longer have a default `batchSize: 1000` for `getMore`.** Cursors will round-trip more often unless callers set `batchSize`. | We iterate cursors via `aggregate(...)` (`driver-mongo/src/mongo-driver.ts:149`); we never set `batchSize`. Behaviour shift is a perf delta (more `getMore` calls); not a correctness break. | **maintenance** (consider configuring `batchSize`) |
| B12 | **`AutoEncryptionOptions` filename type-narrowing (`mongocryptdSpawnPath`, `cryptSharedLibPath`).** | We don't use auto-encryption. | trivial |
| B13 | **`MongoClient.connect()` runs a handshake regardless of credentials** (fail-fast for misconfig). | We call `client.connect()` (`driver-mongo/src/mongo-driver.ts:34`, `driver-mongo/src/exports/control.ts:45`). New behaviour is *more* fail-fast, surfaces auth/loadBalanced misconfig at connect time. Possible test surprise if a test relied on lazy errors. | **maintenance** |
| B14 | **`MongoClient.close()` no longer sends `endSessions` if topology lacks session support.** | We call `client.close()` (`driver-mongo/src/mongo-driver.ts:71`, `mongo-control-driver.ts:24`). No behavioural impact on our path. | trivial |
| B15 | **Cursor / ChangeStream `stream(transform)` removed.** | We don't call `.stream(transform)`. | trivial |
| B16 | **`MONGODB-CR` auth removed.** | We don't use it. | trivial |
| B17 | **`MongoClient.options.{additionalDriverInfo, metadata, extendedMetadata}` made internal.** | We set `driverInfo` (the *public* option) at construction (`driver-mongo/src/exports/control.ts:42`, `driver-mongo/src/mongo-driver.ts:33`). `driverInfo` (the constructor option) is unaffected; the removed surface was `MongoClient.options.additionalDriverInfo`. We do not read `client.options.*` anywhere. | trivial |
| B18 | **`CommandOptions.noResponse` removed.** | Not used. | trivial |
| B19 | **Assorted deprecated types/options removed:** `FindOptions<TSchema>` generic dropped; `FindOneOptions.{batchSize, limit, noCursorTimeout}`; `MongoClientOptions.{useNewUrlParser, useUnifiedTopology}`; `CreateCollectionOptions.autoIndexId`; `ServerCapabilities`; `CommandOperationOptions.retryWrites`; `ClientSession.transaction`; `Transaction`; `CancellationToken`; `ResumeOptions`; `CloseOptions`; `ClientMetadataOptions`; `ReadPreference.minWireVersion`; `GridFSFile.{contentType,aliases}`. | None of these names appear in our `src/` or `test/` trees (verified by grep). | trivial |

### v7.1.0 / v7.1.1 / v7.2.0 — additive

The minor releases scanned (`HISTORY.md` excerpts on
`https://github.com/mongodb/node-mongodb-native/blob/HEAD/HISTORY.md`)
introduce no further public-API breakage. Notable additive features:

- v7.2.0: `runtimeAdapters` for dependency-injecting Node-specific
  modules (`os`, web-crypto-based crypto). Experimental.
- v7.2.0: `ChangeStream.bufferedCount()`.
- v7.2.0: Intelligent Workload Management client options
  (`maxAdaptiveRetries`, `enableOverloadRetargeting`).

None of these block adoption.

### v8.x

**No release published as of 2026-05-22.** MongoDB has not signalled a
v8 timeline on the releases page or in `HISTORY.md`. The ticket's framing
of "support 7 or 8" should therefore be read as **"unblock the major
beyond 6 — currently that's 7, and prepare so the next major can land
without a second blocker."** The artifact does not enumerate hypothetical
v8 breaking changes; they are unknowable from current sources.

### Node.js floor cross-check

- v6.x minimum supported Node: 16.20.1 (per published v6 release notes).
- v7.x minimum supported Node: **20.19.0** (B1 above).
- Root `package.json` declares `"engines": { "node": ">=24" }` (see
  `package.json:engines`). All three example apps under `examples/`
  declare `"engines": { "node": ">=24" }` too. The brief's claim of
  `>=20` is outdated — our actual floor is well above v7's requirement.
  **No engine mismatch** when moving to v7.

---

## Section 4 — Support-policy decision matrix

Three policy candidates to compare in the design discussion:

| Policy | Code changes required | Test surface required | User-migration story | Maintenance cost ongoing |
| --- | --- | --- | --- | --- |
| **A. Pin to v8 only** (drop v6) — purely hypothetical today: v8 doesn't exist. Treat as "pin to whichever single major is latest, currently v7". | (For v7 today:) Bump catalog `mongodb` to `^7.0.0`. Audit `collection.drop()` for the B6 semantic change (was-throw → now-false). Re-read BSON v7 release notes to confirm `Binary`/`Decimal128`/`Long`/`ObjectId`/`Timestamp` re-exports are safe. Consider configuring an explicit `batchSize` on cursors (B11, perf). Drop stale `mongodb` declarations from `target-mongo` and `family-mongo` while we're in the file. | Single-track test matrix as today. Memory-server v11.1.0 already bundles driver 7.x, so the test environment will become *more consistent* (one driver major in the install graph, not two). | All users on v6 break at the next upgrade. They must (a) take Node ≥20.19.0 (we already require ≥24, so no extra constraint), (b) reflect any BSON-v7 class shape changes in their own code, (c) accept the small set of B-list semantic shifts (B6 `drop()` no longer throwing, B11 cursor batch-size default removed). | Lowest. One driver major in flight; one BSON major; no runtime version-detection. Same shape as today's pin, just on a newer floor. We re-cut the same release per major bump. |
| **B. Peer-range `^6 \|\| ^7 \|\| ^8`, we ship a compatible-with-all surface** | Move `mongodb` from `dependencies` → `peerDependencies` in every runtime-consumer package (`driver-mongo`, `adapter-mongo`, `mongo`) with the union range, plus a matching `peerDependenciesMeta` entry if optional. Keep one of the majors in `devDependencies` for tests. Rewrite or stop re-exporting the `bson` barrel (cross-major value classes don't pass `instanceof`); replace with a documented "import directly from `mongodb`" path for users. For the `mongoClient?: MongoClient` typed option, switch to a structural type (or accept `unknown` + runtime validation) so types compile against any of v6/v7. Audit each call site for cross-major behavioural diffs (B6, B11, plus any future v8 deltas). | Multi-track: test against v6 *and* v7 (and v8 when it exists). Realistically a CI matrix dimension or duplicated workspace catalog entries. Memory-server companion has to be selected per matrix cell — v11.x bundles driver 7.x internally, v10.x bundled v6.x; this becomes the matrix axis. | Smoothest for existing v6 users — they keep their pin. New users pick a major. We must document the support window per major and an EOL policy. Cross-major BSON class identity remains a footgun we'd warn about. | Highest. Every breaking-change in any in-range major lands on us. Doubles or triples CI cost. Every internal refactor of `adapter-mongo` / `driver-mongo` has to be checked against all in-range majors. Realistically a 1–2 day cost per minor release plus a multi-day cost per major release. |
| **C. Users supply their own driver via `peerDependencies`; we don't bundle** | Same as B for `peerDependencies` shape, but pick a single major (probably v7) as the version range and tighten over time. Drop the `Binary`/`Decimal128`/`Long`/`Timestamp`/`ObjectId` re-exports — users import them directly from `mongodb`. Keep `MongoClient`-typed option (`mongoClient?:`) but document explicitly that the version must match the peer range. Drop stale-deps in `target-mongo` and `family-mongo`. | Single-track on the chosen major. Memory-server pins itself in `devDependencies`. | Existing v6 users get a clear "bump your direct mongodb dep" instruction; we publish a one-time migration note. New users install `mongodb` themselves (same shape as `react-dom`, `pg`, etc.). | Low–medium. We pick one major at a time; bumping the peer range is an opt-in user action, not a forced upgrade. Removing the `bson` re-export is a one-time user-API churn but afterwards we own zero BSON commitments. |

### Decision-relevant cross-references

- **`target-mongo` / `family-mongo` stale runtime deps.** Section 1 row 3
  and row 4. Drop these regardless of which policy we adopt — they
  unnecessarily constrain users.
- **Memory-server / driver coexistence.** Section 1 closing note.
  Whichever policy lands, the catalog pair `mongodb-memory-server@11.1.0`
  + `mongodb@^6.16.0` is already inconsistent (memory-server v11 carries
  its own driver 7.x); fixing the driver pin will resolve this side
  effect.
- **`@prisma-next/mongo/bson` re-export.** Section 2 "Re-exports on our
  public API surface" item 1. Under policy B this barrel must go (cross-
  major BSON value classes are not interchangeable via `instanceof`).
  Under policies A and C, the barrel is fine but it locks our published
  driver major to whatever users `instanceof` against.
- **`mongoClient?: import('mongodb').MongoClient` option.** Section 2
  item 2. Same constraint as the `bson` barrel — under B the type has to
  become structural; under A or C the type pins the major.
