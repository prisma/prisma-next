# Changelog

The rolling, newest-first index of Prisma Next releases. Each entry mirrors the release's committed notes file under [`docs/releases/`](docs/releases/) (the body of its GitHub Release) under a `## v<version>` header — see [`docs/releases/README.md`](docs/releases/README.md) for the convention and authoring template.

Changelog tracking starts at **v0.12.0**, the first release cut after this convention landed. For **v0.11.0 and earlier**, see the [GitHub Releases](https://github.com/prisma/prisma-next/releases) page — historical notes are not backfilled here.

<!-- New release entries go here, newest first, each mirroring docs/releases/v<version>.md under a `## v<version>` header. -->

## v0.13.0

This release makes namespaces a first-class part of the query surface, adds cross-contract foreign keys to the SQL ORM, makes many-to-many a validatable contract shape, introduces a per-object control policy (`@@control`) that decides what Prisma manages, ships domain enums backed by storage value-sets, and gives the migration CLI a unified graph-tree view across `list` / `log` / `status` / `show`. Telemetry also flips from opt-in to opt-out. A few changes require a one-time contract re-emit — all are covered by the linked upgrade recipes.

### Breaking changes

- **Telemetry is now opt-out** — anonymous CLI telemetry is collected by default and you opt out, where previously you opted in. Set `PRISMA_NEXT_DISABLE_TELEMETRY=1` (or `DO_NOT_TRACK=1`) to turn it off. See [`docs/Telemetry.md`](https://github.com/prisma/prisma-next/blob/v0.13.0/docs/Telemetry.md) for what is collected and every opt-out signal. ([#676](https://github.com/prisma/prisma-next/pull/676))

- **MTI variant tables materialize a base-PK link column** — a PSL `@@base(Parent, "tag")` variant that carries its own `@@map` (and is therefore stored in its own table) now emits a base-PK link column in storage: the variant table gains a copy of the base table's primary-key column(s), a primary key over them, and a cascading foreign key (`ON DELETE CASCADE`) referencing the base table's primary key. Previously the variant table held only the variant-specific columns with no primary key and no link to its base. This changes the emitted `contract.json` / `contract.d.ts` and the contract's `storageHash`. Re-emit your contract, then plan and apply the matching migration. Variants that share the base table (no own `@@map`) are unaffected. See the [0.12→0.13 upgrade recipe](https://github.com/prisma/prisma-next/blob/v0.13.0/skills/upgrade/prisma-next-upgrade/upgrades/0.12-to-0.13/). ([#669](https://github.com/prisma/prisma-next/pull/669))

  Before (emitted `contract.json`, variant table `bug`):

  ```json
  "bug": {
    "columns": {
      "severity": { "codecId": "pg/text@1", "nullable": false }
    }
  }
  ```

  After:

  ```json
  "bug": {
    "columns": {
      "id": { "codecId": "sql/char@1", "nullable": false },
      "severity": { "codecId": "pg/text@1", "nullable": false }
    },
    "primaryKey": { "columns": ["id"] },
    "foreignKeys": [
      {
        "name": "bug_id_fkey",
        "columns": ["id"],
        "references": { "table": "task", "columns": ["id"] },
        "onDelete": "cascade"
      }
    ]
  }
  ```

- **Contract storage IR moved to a namespace envelope** — the SQL/Mongo storage IR is now keyed by namespace (`storage.namespaces.<ns>.entries.<kind>`), and cross-references are explicit `{ namespace, model }` objects in `domain`. Consumer impact is mechanical: re-emit with `prisma-next contract emit` to pick up the new shape. No codemod or source change is required, but the contract's `storageHash` changes, so plan and apply a migration afterward. ([#715](https://github.com/prisma/prisma-next/pull/715))

- **Extension authors: codec-resolution SPI takes a leading `namespaceId`** — `CodecDescriptorRegistry.codecRefForColumn(table, column)` is now `codecRefForColumn(namespaceId, table, column)`, and the free `codecRefForStorageColumn(storage, table, column)` is now `codecRefForStorageColumn(storage, namespaceId, table, column)` (both in `@prisma-next/sql-relational-core`). Thread the namespace the table lives in through every call site that stamps `codec` onto AST nodes. There is no codemod — the right namespace is call-site-specific. See the [0.12→0.13 extension-author recipe](https://github.com/prisma/prisma-next/blob/v0.13.0/skills/extension-author/prisma-next-extension-upgrade/upgrades/0.12-to-0.13/). ([#715](https://github.com/prisma/prisma-next/pull/715))

  Before:

  ```ts
  const ref = descriptors.codecRefForColumn('document', 'embedding');
  ```

  After:

  ```ts
  const ref = descriptors.codecRefForColumn('public', 'document', 'embedding');
  ```

- **Extension authors: empty `typeParams` stripped from `storage.types`** — the canonicalizer now omits `typeParams` from `storage.types` entries when it is an empty object (e.g. a `types { Uuid = String @db.Uuid }` named-type alias). Runtime behaviour is unchanged, but the emitted `contract.json` and its `storageHash` differ. If your extension shipped a `contract.json` with `"typeParams": {}`, re-emit and re-pin your migration baselines. See the [0.12→0.13 extension-author recipe](https://github.com/prisma/prisma-next/blob/v0.13.0/skills/extension-author/prisma-next-extension-upgrade/upgrades/0.12-to-0.13/). ([#753](https://github.com/prisma/prisma-next/pull/753))

### Features

- **Namespace-aware DSL/ORM surface** — the typed query and ORM surface now exposes namespaced accessors so models in different namespaces are addressed explicitly and two same-named tables in different namespaces no longer collide. Additive — existing single-namespace code is unchanged. ([#720](https://github.com/prisma/prisma-next/pull/720))

- **Many-to-many is now a validatable contract shape** — `N:M` relations carrying a `through` junction descriptor are now a first-class, validatable part of the contract (they previously failed validation). The ORM runtime surface for M:N — `.include()` across the junction, `some`/`every`/`none` filters, and junction writes — is not wired up yet and lands in a follow-up release; nested M:N mutations currently throw. ([#669](https://github.com/prisma/prisma-next/pull/669), [#678](https://github.com/prisma/prisma-next/pull/678))

- **Cross-contract foreign keys** — a relation field can reference a model owned by another contract space (e.g. `supabase:auth.AuthUser`), with named-type aliases (`types { Uuid = String @db.Uuid }`) for database-native column types. The planner and verifier resolve the cross-space reference and emit the foreign key, including cascading deletes. See the [0.12→0.13 upgrade recipe](https://github.com/prisma/prisma-next/blob/v0.13.0/skills/upgrade/prisma-next-upgrade/upgrades/0.12-to-0.13/) for the authoring pattern. ([#745](https://github.com/prisma/prisma-next/pull/745), [#752](https://github.com/prisma/prisma-next/pull/752), [#756](https://github.com/prisma/prisma-next/pull/756), [#765](https://github.com/prisma/prisma-next/pull/765))

  ```prisma
  types {
    Uuid = String @db.Uuid
  }

  namespace public {
    model Profile {
      id       String @id @default(uuid())
      username String
      userId   Uuid   @unique
      user     supabase:auth.AuthUser @relation(fields: [userId], references: [id], onDelete: Cascade)
      @@map("profile")
    }
  }
  ```

- **Per-object control policy (`@@control`)** — a model or other contract object can declare whether Prisma manages its schema, and a contract can set a `defaultControlPolicy`. Migration DDL generation and schema verification react to each object's policy, so you can keep externally-owned objects out of Prisma's managed surface. ([#717](https://github.com/prisma/prisma-next/pull/717), [#711](https://github.com/prisma/prisma-next/pull/711))

- **Domain enums with storage value-sets** — enums are now a domain concept backed by storage value-sets. On Postgres, `enum` blocks lower to a native enum type (`CREATE TYPE … AS ENUM`); SQL targets without native enum support approximate the allowed values with check constraints. ([#750](https://github.com/prisma/prisma-next/pull/750), [#755](https://github.com/prisma/prisma-next/pull/755))

- **Unified migration graph view in the CLI** — `migration list`, `log`, `status`, and `show` now render the migration history as a consistent graph tree with colored lanes, a `--legend`, and one schema-locked `--json` shape across the read commands. `migrate --show` previews the migration path read-only before you apply it. ([#706](https://github.com/prisma/prisma-next/pull/706), [#704](https://github.com/prisma/prisma-next/pull/704), [#705](https://github.com/prisma/prisma-next/pull/705), [#735](https://github.com/prisma/prisma-next/pull/735), [#741](https://github.com/prisma/prisma-next/pull/741), [#767](https://github.com/prisma/prisma-next/pull/767))

- **Readable per-migration ledger** — the migration apply ledger is now a per-migration journal, read back as one flat chronological table by `migration log`. ([#665](https://github.com/prisma/prisma-next/pull/665), [#704](https://github.com/prisma/prisma-next/pull/704))

- **`db.transaction()` on the SQLite facade** — `@prisma-next/sqlite` gains a facade-level transaction API (`db.transaction(async (tx) => …)`), mirroring the Postgres facade. ([#737](https://github.com/prisma/prisma-next/pull/737))

- **Declarative SPI for extension-contributed PSL blocks** — extensions can declare top-level PSL blocks declaratively, and `contract infer` round-trips them through a generic PSL printer. ([#753](https://github.com/prisma/prisma-next/pull/753), [#754](https://github.com/prisma/prisma-next/pull/754), [#757](https://github.com/prisma/prisma-next/pull/757))

- **`@prisma-next/extension-supabase`** — a new extension package and an `examples/supabase` walking skeleton that wires a cross-contract foreign key from an app model to Supabase's `auth` schema. ([#746](https://github.com/prisma/prisma-next/pull/746), [#765](https://github.com/prisma/prisma-next/pull/765))

- **STI variants can declare their own fields** — a PSL `@@base(Parent, "tag")` variant with no own `@@map` (single-table inheritance) may now declare its own scalar fields. Each is materialized as a (nullable) column on the shared base table, and the variant no longer emits a stray shadow table. Previously such a contract failed to emit with `references non-existent column`. Existing contracts re-emit identically. ([#669](https://github.com/prisma/prisma-next/pull/669))

- **Backward cursor pagination** — `OrderByItem.reverse()` flips an order-by direction for fetching the previous page. ([#671](https://github.com/prisma/prisma-next/pull/671))

- **Postgres JSON defaults emit a `::jsonb` / `::json` cast** — JSON column defaults now carry the explicit cast in generated DDL. ([#763](https://github.com/prisma/prisma-next/pull/763))

### Fixes

- Constraintless foreign keys are skipped in offline schema projection. ([#744](https://github.com/prisma/prisma-next/pull/744))
- Storage-sort comparison is now collation-independent. ([#721](https://github.com/prisma/prisma-next/pull/721))

## v0.12.0

Namespaces become first-class: un-namespaced Postgres models now live in `public`, the application plane is symmetric with storage, and every cross-namespace reference is explicit. This release also ratifies a version-support policy (Node 24+), simplifies runtime marker verification, closes MongoDB validators by default, and adds raw SQL to the typed builder. Several contract-shape changes require a one-time re-emit — most are mechanical and covered by the linked upgrade recipes.

### Breaking changes

- **Supported-version floors raised** — the supported floor for each dependency is now the latest GA release we test against: Node.js `>=24` (declared in every package's `engines`), TypeScript `>=5.9`, PostgreSQL `17`, and MongoDB `8.0`. Bump your runtime and toolchain to meet these floors before upgrading. ([#659](https://github.com/prisma/prisma-next/pull/659))
- **Un-namespaced Postgres models default to `public`** — models without an explicit namespace now emit under the `public` namespace instead of the `__unbound__` sentinel (`postgres-unbound-schema` → `postgres-schema`); explicit `namespace unbound { … }` still round-trips to `__unbound__`. Re-emit your contract so `contract.json` / `contract.d.ts` pick up the new namespace key. See the [0.11→0.12 upgrade recipe](https://github.com/prisma/prisma-next/blob/v0.12.0/skills/upgrade/prisma-next-upgrade/upgrades/0.11-to-0.12/). ([#662](https://github.com/prisma/prisma-next/pull/662))

  Before (emitted `contract.json`):

  ```json
  "storage": {
    "namespaces": {
      "__unbound__": { "id": "__unbound__", "kind": "postgres-unbound-schema" }
    }
  }
  ```

  After:

  ```json
  "storage": {
    "namespaces": {
      "public": { "id": "public", "kind": "postgres-schema" }
    }
  }
  ```

- **Symmetric domain plane** — models and value objects moved from flat `contract.models` / `contract.valueObjects` to `contract.domain.namespaces.<ns>`, and emitted `contract.d.ts` exports `Models` via `ContractModelsMap<Contract>` instead of `Contract['models']`. Re-emit your contract; consumers reading the flat shape must adopt the namespaced helpers. See the [0.11→0.12 upgrade recipe](https://github.com/prisma/prisma-next/blob/v0.12.0/skills/upgrade/prisma-next-upgrade/upgrades/0.11-to-0.12/) (extension authors: the [extension-author recipe](https://github.com/prisma/prisma-next/blob/v0.12.0/skills/extension-author/prisma-next-extension-upgrade/upgrades/0.11-to-0.12/) also covers the removal of the `@prisma-next/contract/testing` subpath — test factories now live in `@prisma-next/test-utils`). ([#653](https://github.com/prisma/prisma-next/pull/653))

  Before (consuming emitted `contract.d.ts`):

  ```ts
  type Models = Contract['models'];
  ```

  After:

  ```ts
  type Models = ContractModelsMap<Contract>;
  ```

- **Cross-namespace references are explicit `{ namespace, model }` pairs** — emitted contract roots and `relation.to` now carry an explicit `{ namespace, model }` object (namespace branded as `NamespaceId`) rather than a bare model-name string. Re-emit your contract, and update any code that read `relation.to` (or a root) as a string to read `.model` / `.namespace`. ([#600](https://github.com/prisma/prisma-next/pull/600))

  Before (consuming emitted `contract.d.ts`):

  ```ts
  // relation.to was a bare model-name string
  readonly to: 'User';
  ```

  After:

  ```ts
  // relation.to is now an explicit { namespace, model }
  readonly to: { readonly namespace: 'public' & NamespaceId; readonly model: 'User' };
  ```

- **`capabilities` removed from `defineContract`** — the `capabilities` field on the first argument of `defineContract({ … }, …)` is gone; capabilities are now contributed automatically by target components and the extension packs in `extensionPacks`. Delete the `capabilities: { … }` block from every call site and re-emit. See the [0.11→0.12 upgrade recipe](https://github.com/prisma/prisma-next/blob/v0.12.0/skills/upgrade/prisma-next-upgrade/upgrades/0.11-to-0.12/). ([#574](https://github.com/prisma/prisma-next/pull/574))

  Before:

  ```ts
  export const contract = defineContract(
    {
      extensionPacks: { pgvector },
      capabilities: { postgres: { lateral: true, jsonAgg: true } },
    },
    ({ field, model }) => {
      // … model definitions …
    },
  );
  ```

  After:

  ```ts
  export const contract = defineContract(
    { extensionPacks: { pgvector } },
    ({ field, model }) => {
      // … model definitions …
    },
  );
  ```

- **`verifyMarker` replaces `verify` / `RuntimeVerifyOptions`** — the SQL runtime's `verify: { mode, requireMarker }` option is replaced by `verifyMarker?: 'onFirstUse' | false` (default `'onFirstUse'`), and the runtime no longer throws on contract-marker drift — it emits one `warn`-level log line per runtime instance and proceeds. The `RuntimeVerifyOptions` export is removed in favour of `VerifyMarkerOption`. Migrate `verify` call sites and switch fail-fast verification to the `db-verify` CLI. See the [0.11→0.12 upgrade recipe](https://github.com/prisma/prisma-next/blob/v0.12.0/skills/upgrade/prisma-next-upgrade/upgrades/0.11-to-0.12/). ([#592](https://github.com/prisma/prisma-next/pull/592))

  Before:

  ```ts
  const runtime = createRuntime({
    stackInstance,
    context,
    driver,
    verify: { mode: 'onFirstUse', requireMarker: false },
  });
  ```

  After:

  ```ts
  const runtime = createRuntime({
    stackInstance,
    context,
    driver,
    // verifyMarker omitted — 'onFirstUse' is the default; pass `false` to skip
  });
  ```

- **Migration manifest closed; `labels`/`hints` removed** — the on-disk `migration.json` schema is now closed and no longer carries `labels` or `hints`; a manifest still holding either key fails to load with `INVALID_MANIFEST`. Both fields also leave the content-addressed migration identity, so `migrationHash` changes. Run the colocated codemod to strip the keys and recompute each hash. See the [0.11→0.12 upgrade recipe](https://github.com/prisma/prisma-next/blob/v0.12.0/skills/upgrade/prisma-next-upgrade/upgrades/0.11-to-0.12/). ([#615](https://github.com/prisma/prisma-next/pull/615))
- **MongoDB emits closed `$jsonSchema` validators by default** — every emitted object schema (collection validators, nested objects, and `oneOf` branches) now carries `additionalProperties: false`, and each non-variant Mongo model must resolve to an `objectId` `_id` before emit succeeds. Re-emit your Mongo contracts and apply the open→closed validator change (the planner classifies it as destructive). See the [0.11→0.12 upgrade recipe](https://github.com/prisma/prisma-next/blob/v0.12.0/skills/upgrade/prisma-next-upgrade/upgrades/0.11-to-0.12/). ([#637](https://github.com/prisma/prisma-next/pull/637))
- **`mongodb` is now a user-supplied peer dependency** — `@prisma-next/driver-mongo`, `@prisma-next/adapter-mongo`, and `@prisma-next/mongo` no longer bundle `mongodb`; install `mongodb@^7` yourself as a peer dependency. ([#597](https://github.com/prisma/prisma-next/pull/597))
- **`.distinct(cols)` now collapses to one row per group** — `.distinct(cols)` on the SQL ORM `Collection` (and on nested `.include(…)`) now keeps a single representative row per `(cols)` group, matching Prisma semantics; previously it did not collapse when the projection carried other distinguishing columns. No call-site change is required, but query results change — review any logic or fixtures that relied on the old non-collapsing output. Extension authors implementing `ExprVisitor` / exhaustive `expr.kind` switches must handle the new `WindowFuncExpr` variant — see the [extension-author recipe](https://github.com/prisma/prisma-next/blob/v0.12.0/skills/extension-author/prisma-next-extension-upgrade/upgrades/0.11-to-0.12/). ([#576](https://github.com/prisma/prisma-next/pull/576))
- **In-repo CipherStash extension removed** — `@prisma-next/extension-cipherstash` is no longer published from this repo; CipherStash's encrypted-field support now ships from CipherStash's own repository as `@cipherstash/prisma-next`. Depend on that package instead. ([#650](https://github.com/prisma/prisma-next/pull/650))

### Features

- Customize where the contract emitter writes via `outputPath` in `prisma-next.config.ts` or `--output-path` on `prisma-next contract emit`. ([#584](https://github.com/prisma/prisma-next/pull/584))
- Raw SQL in the typed query builder (`rawSql`) for Postgres and SQLite, so escape-hatch expressions compose with the rest of the builder. ([#594](https://github.com/prisma/prisma-next/pull/594))
- `migration list` rewritten to show the complete migration set, ref/graph context, and multi-space output instead of only the migrations along a single chain. ([#603](https://github.com/prisma/prisma-next/pull/603))
- `migration graph --tree` renders a condensed annotated-tree view of the migration topology. ([#658](https://github.com/prisma/prisma-next/pull/658))
- Roll back migrations without editing contract source: reverse edges are now plannable and applyable via `--to`. ([#635](https://github.com/prisma/prisma-next/pull/635))
- Single-query include aggregates in the SQL ORM client — counts and aggregates on included relations are fetched in one query rather than fanning out. ([#596](https://github.com/prisma/prisma-next/pull/596))
- `planExecutionId` on `RuntimeMiddlewareContext`, a fresh per-`execute()` identity letting middleware correlate `beforeExecute` and `afterExecute` for the same call. ([#605](https://github.com/prisma/prisma-next/pull/605))
- Mongo middleware can rewrite query parameters in `beforeExecute` before they are encoded, restoring parity with the SQL param-mutator seam. ([#652](https://github.com/prisma/prisma-next/pull/652))
- `emptyContract({ target })` lets contract-space extensions that contribute only migration invariants (e.g. installing a Postgres extension) omit a contract source instead of hand-authoring an empty one. ([#651](https://github.com/prisma/prisma-next/pull/651))

### Fixes

- Mongo: optional fields that are `undefined` are omitted when deserializing `createIndex`, instead of being written out. ([#580](https://github.com/prisma/prisma-next/pull/580))
- Foreign-key referential actions (`onDelete` / `onUpdate`) are now preserved in the schema IR. ([#608](https://github.com/prisma/prisma-next/pull/608))
- Mongo `db update`: adding an optional field to an existing model now applies cleanly — the validator-widening op is classified and applied correctly instead of being gated or dropped. ([#624](https://github.com/prisma/prisma-next/pull/624))
- The dev→ship transition is fixed: the first `migration plan` after `db update` now succeeds via ref-paired snapshots and an auto-baseline on an empty graph. ([#582](https://github.com/prisma/prisma-next/pull/582))
- `prisma-next init` scaffolds into the canonical `src/prisma/` layout, matching the rest of the framework, so fresh projects start in the expected shape. ([#581](https://github.com/prisma/prisma-next/pull/581))
- In-process contracts built with `defineContract` and passed to `createExecutionContext` now carry the same adapter + driver capability matrix as CLI-emitted contracts. ([#602](https://github.com/prisma/prisma-next/pull/602))

### New contributors

- [@xxiaoxiong](https://github.com/xxiaoxiong) made their first contribution in [#580](https://github.com/prisma/prisma-next/pull/580)
- [@medz](https://github.com/medz) made their first contribution in [#608](https://github.com/prisma/prisma-next/pull/608)
