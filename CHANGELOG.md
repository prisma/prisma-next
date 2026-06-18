# Changelog

The rolling, newest-first index of Prisma Next releases. Each entry mirrors the release's committed notes file under [`docs/releases/`](docs/releases/) (the body of its GitHub Release) under a `## v<version>` header — see [`docs/releases/README.md`](docs/releases/README.md) for the convention and authoring template.

Changelog tracking starts at **v0.12.0**, the first release cut after this convention landed. For **v0.11.0 and earlier**, see the [GitHub Releases](https://github.com/prisma/prisma-next/releases) page — historical notes are not backfilled here.

<!-- New release entries go here, newest first, each mirroring docs/releases/v<version>.md under a `## v<version>` header. -->

## v0.14.0

This release reshapes the enum surface (PSL `enum` is now a domain concept backed by a value-set CHECK constraint, not a native Postgres type), makes the SQL builder always-qualified by namespace, adds native UUID storage on Postgres, ships a new fault-tolerant PSL parser, completes the read side of many-to-many (correlated includes plus `some` / `every` / `none` filters through the junction), and adds a Supabase façade alongside several runtime-class renamings. Most breaking changes have a matching codemod or upgrade recipe.

### Breaking changes

- **PSL `enum` becomes the domain enum** — an `enum` block now authors a text-class column whose value set is enforced by a CHECK constraint, not a native `CREATE TYPE … AS ENUM`. Each block must declare `@@type("<codec-id>")` (typically `pg/text@1`) and map members to database values with `Name = "value"`. The transitional `enum2` keyword is retired (rename to `enum` — emitted contract is identical). Native enum machinery is deleted: `enumType(name, values[])` / `enumColumn` from `@prisma-next/adapter-postgres/column-types`, the `pg/enum@1` codec, and adoption of native enum types in `contract infer` are all gone. Databases carrying a native enum type need a one-time converting migration (ALTER column to `text` USING `::text`, add the value-set CHECK, `DROP TYPE`) — `contract infer` refuses native enum types and names them. See the [0.13→0.14 upgrade recipe](https://github.com/prisma/prisma-next/blob/v0.14.0/skills/upgrade/prisma-next-upgrade/upgrades/0.13-to-0.14/) and the [extension-author recipe](https://github.com/prisma/prisma-next/blob/v0.14.0/skills/extension-author/prisma-next-extension-upgrade/upgrades/0.13-to-0.14/). ([#817](https://github.com/prisma/prisma-next/pull/817))

  Before:

  ```prisma
  enum user_type {
    admin
    user
  }
  ```

  After:

  ```prisma
  enum user_type {
    @@type("pg/text@1")
    admin = "admin"
    user  = "user"
  }
  ```

- **Query builder and ORM are always qualified by namespace** — the flat by-bare-name accessors are removed at the builder layer; the Postgres facade exposes the namespaced surface. On Postgres, `db.sql.<table>` becomes `db.sql.<namespace>.<table>` and `db.orm.<Model>` becomes `db.orm.<namespace>.<Model>` (`public` for a standard single-schema project). Direct builder calls (`sql.<table>`, `orm.<Model>`) migrate the same way. SQLite and Mongo are unaffected — their single-namespace facade keeps the flat surface working. No codemod: the correct namespace is the one each table/model is declared in. The generated `contract.d.ts` also drops the flat top-level `export type Models` — read models per-namespace as `Contract['domain']['namespaces']['<namespace>']['models']` and re-emit. See the [0.13→0.14 upgrade recipe](https://github.com/prisma/prisma-next/blob/v0.14.0/skills/upgrade/prisma-next-upgrade/upgrades/0.13-to-0.14/). ([#778](https://github.com/prisma/prisma-next/pull/778))

  Before:

  ```ts
  const users = await db.sql.user.select('id', 'email').build().execute();
  const alice = await db.orm.User.find({ where: { id } });
  ```

  After:

  ```ts
  const users = await db.sql.public.user.select('id', 'email').build().execute();
  const alice = await db.orm.public.User.find({ where: { id } });
  ```

- **UUID field presets renamed by storage encoding** — `field.uuid()` → `field.uuidString()`, `field.id.uuidv4()` → `field.id.uuidv4String()`, `field.id.uuidv7()` → `field.id.uuidv7String()`. The new names describe the `char(36)` storage encoding (the emitted codec, `sql/char@1`, is unchanged). Postgres-native `uuid` columns use the new `field.uuidNative()` / `field.id.uuidv4Native()` / `field.id.uuidv7Native()` presets from `@prisma-next/postgres/contract-builder`. The rename is mechanical — a colocated codemod ships in the [0.13→0.14 upgrade recipe](https://github.com/prisma/prisma-next/blob/v0.14.0/skills/upgrade/prisma-next-upgrade/upgrades/0.13-to-0.14/). ([#810](https://github.com/prisma/prisma-next/pull/810))

  Before:

  ```ts
  id: field.id.uuidv7(),
  externalId: field.uuid(),
  ```

  After:

  ```ts
  id: field.id.uuidv7String(),
  externalId: field.uuidString(),
  ```

- **Postgres migration op factories become methods on `Migration`** — the bare op factory functions previously exported from `@prisma-next/postgres/migration` (and the `@prisma-next/target-postgres/migration` alias) are removed. Each is now a protected method on the `PostgresMigration` base class — call it as `this.<op>(...)`. Positional arguments are replaced by a single options object. A codemod ships in the [0.13→0.14 upgrade recipe](https://github.com/prisma/prisma-next/blob/v0.14.0/skills/upgrade/prisma-next-upgrade/upgrades/0.13-to-0.14/). ([#813](https://github.com/prisma/prisma-next/pull/813))

  Before:

  ```ts
  import { addForeignKey, dropColumn } from '@prisma-next/postgres/migration';

  override get operations() {
    return [
      dropColumn('public', 'user', 'legacyName'),
      addForeignKey('public', 'post', { name: 'post_userId_fkey', columns: ['userId'], references: { schema: 'public', table: 'user', columns: ['id'] } }),
    ];
  }
  ```

  After:

  ```ts
  override get operations() {
    return [
      this.dropColumn({ schema: 'public', table: 'user', column: 'legacyName' }),
      this.addForeignKey({ schema: 'public', table: 'post', foreignKey: { name: 'post_userId_fkey', columns: ['userId'], references: { schema: 'public', table: 'user', columns: ['id'] } } }),
    ];
  }
  ```

- **SQL runtime class renames** — `@prisma-next/sql-runtime` exports `abstract class SqlRuntimeBase` (previously `SqlRuntime`). The bare names `PostgresRuntime` and `SqliteRuntime` are now **interfaces** — the types to depend on in extension and app code. The concrete classes are `PostgresRuntimeImpl` (from `@prisma-next/postgres/runtime`) and `SqliteRuntimeImpl` (from `@prisma-next/sqlite/runtime`). Code that referenced the class names to subclass them switches to the `Impl` names. Code using the facade factories (`postgres(...)`, `sqlite(...)`) is unaffected. ([#806](https://github.com/prisma/prisma-next/pull/806))

- **`createRuntime` removed from `@prisma-next/sql-runtime`** — use the target facade factory (`postgres(...)` / `sqlite(...)`) or construct the target class directly (`new PostgresRuntimeImpl({...})` / `new SqliteRuntimeImpl({...})`). The constructor options match what `createRuntime` accepted, except `stackInstance` is not taken — pass `adapter` directly. App code using the facade factories is unaffected. ([#806](https://github.com/prisma/prisma-next/pull/806))

- **`SqlContractSerializer` no longer accepts Postgres contracts** — the family serializer's entries registry only knows SQL-family built-ins (`table`, `valueSet`) and rejects the Postgres-specific `type` key that every Postgres namespace carries. Migration files and app code that deserialize a Postgres-emitted contract must use `PostgresContractSerializer` from `@prisma-next/target-postgres/runtime`. SQLite and family-only contracts are unaffected. ([#812](https://github.com/prisma/prisma-next/pull/812))

  Before:

  ```ts
  import { SqlContractSerializer } from '@prisma-next/family-sql/ir';
  const contract = new SqlContractSerializer().deserializeContract(json) as Contract;
  ```

  After:

  ```ts
  import { PostgresContractSerializer } from '@prisma-next/target-postgres/runtime';
  const contract = new PostgresContractSerializer().deserializeContract(json) as Contract;
  ```

- **Extension authors: `SqlNamespace.entries` is an open dictionary** — the closed shape (`{ table?, valueSet? }`) is gone. `entries` is now `Readonly<Record<string, Readonly<Record<string, unknown>>>>`, so dot-access like `.entries.table` no longer compiles. Read tables via the `namespaceTables(ns)` helper from `@prisma-next/sql-contract/types`, or via bracket notation `entries['table']`; the concrete class instances still expose typed getters (`ns.table`). See the [extension-author recipe](https://github.com/prisma/prisma-next/blob/v0.14.0/skills/extension-author/prisma-next-extension-upgrade/upgrades/0.13-to-0.14/). ([#812](https://github.com/prisma/prisma-next/pull/812))

### Features

- **Postgres-native UUID storage** — `field.uuidNative()` / `field.id.uuidv4Native()` / `field.id.uuidv7Native()` from `@prisma-next/postgres/contract-builder` author columns backed by the native `uuid` type. The cross-target `*String()` presets continue to emit `char(36)`. ([#810](https://github.com/prisma/prisma-next/pull/810))

- **Many-to-many reads land** — `N:M` relations through a `through` junction can now be eagerly loaded via `include()` (correlated reads, slice 1) and filtered with `some` / `every` / `none` through the junction (slice 2). M:N validation arrived in 0.13; the runtime read surface is wired up in this release. ([#679](https://github.com/prisma/prisma-next/pull/679), [#680](https://github.com/prisma/prisma-next/pull/680))

- **Supabase façade** — `@prisma-next/extension-supabase` ships a `supabase()` façade and `SupabaseRuntime` that composes the cross-contract foreign keys introduced in 0.13 into a runnable extension. ([#792](https://github.com/prisma/prisma-next/pull/792))

- **Fault-tolerant PSL parser** — a new recursive-descent parser produces a full syntax tree (`SourceFile`) even when the input contains errors, so editor integrations can report diagnostics and surface partial structure without bailing on the first failure. ([#795](https://github.com/prisma/prisma-next/pull/795))

- **Custom and parameterized codecs in control-path queries** — adapters now honor custom and parameterized codecs when encoding values on the control path (catalog reads, schema-verification queries, migration-state lookups), matching how user-data queries already handled them. ([#807](https://github.com/prisma/prisma-next/pull/807))

- **`contract infer` writes a `pragma` header** — inferred PSL contracts now carry a `pragma` block recording the inference source and options, so re-running infer or auditing a generated schema is unambiguous. ([#801](https://github.com/prisma/prisma-next/pull/801))

- **Per-namespace typed resolution in the builder** — the emitted `contract.d.ts` TypeMaps nest by namespace, so the query builder and ORM client resolve each namespace's own columns and fields — fixing same-bare-name models declared in more than one namespace. Re-emit picks up the new shape. ([#803](https://github.com/prisma/prisma-next/pull/803))

- **Enum input types are exhaustively typed in the emitted `.d.ts`** — an enum-restricted field's input type renders as the literal member union (matching the output side), so create/update calls are exhaustiveness-checked at compile time. Re-emit picks up the new shape. ([#797](https://github.com/prisma/prisma-next/pull/797))

- **Typed `db.enums.<namespace>.<Name>` accessor** — the emitter generates a `domain` block in `contract.d.ts` that exposes each PSL-authored enum as a literal-typed `ContractEnumAccessor` (`values`, `names`, `members`). `contract.json` is unchanged; re-emit picks up the new types. ([#809](https://github.com/prisma/prisma-next/pull/809))

- **Enum member defaults via `@default(EnumType.Member)`** — the PSL interpreter and contract-ts authoring surface resolve a member default to the corresponding database value literal. ([#808](https://github.com/prisma/prisma-next/pull/808))

### Fixes

- **`sql-orm-client` model accessors typed by selected variant** — accessing a model on the ORM client narrows the result type to the selected variant rather than the union of all variants. ([#790](https://github.com/prisma/prisma-next/pull/790))

- **Emitter emits enum input literals** — fixes a hole where enum-restricted input types fell back to the codec's broad input type instead of the literal member union. ([#797](https://github.com/prisma/prisma-next/pull/797))

- **Un-namespaced Postgres models default to `public`** — un-namespaced models in a Postgres contract correctly default to the `public` namespace per ADR 223; the spurious empty `__unbound__` storage slot is gone. Re-emit picks up the shape change. ([#838](https://github.com/prisma/prisma-next/pull/838))

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
