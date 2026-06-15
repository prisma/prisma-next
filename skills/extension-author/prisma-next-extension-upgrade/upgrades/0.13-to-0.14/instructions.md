---
from: "0.13"
to: "0.14"
changes:
  - id: uuid-preset-rename
    summary: |
      The uuid field presets are renamed: `field.uuid()` → `field.uuidString()`,
      `field.id.uuidv4()` → `field.id.uuidv4String()`, `field.id.uuidv7()` →
      `field.id.uuidv7String()`. These names now describe the storage encoding
      (char(36) string). Postgres-native uuid storage uses the new
      `field.uuidNative()` / `field.id.uuidv4Native()` / `field.id.uuidv7Native()`
      presets from `@prisma-next/postgres/contract-builder`.
    detection:
      glob: "**/*.ts"
      contains:
        - "field.uuid()"
        - "field.id.uuidv4()"
        - "field.id.uuidv7()"
      anyMatch: true
    script: uuid-preset-rename.ts
  - id: qualify-flat-builder-accessors
    summary: |
      The builder-layer flat accessors are removed: `@prisma-next/sql-builder`'s `sql()` and
      `@prisma-next/sql-orm-client`'s `orm()` now expose per-namespace facets only. Extension
      code that builds queries by accessing a bare table/model on the builder output
      (`sql.<table>` / `orm.<Model>`) must name the namespace the table/model is declared in:
      `sql.<namespace>.<table>`, `orm.<namespace>.<Model>` (`public` for a standard
      single-schema SQL contract; the late-bound `__unbound__` namespace for an unbound/SQLite
      contract). There is no codemod — the correct namespace is the one each table/model is
      declared in, which is call-site-specific. Extensions that only contribute codecs, types,
      or migrations (and never build queries through `sql`/`orm`) are unaffected.
    detection:
      glob: "**/*.{ts,tsx}"
      contains:
        - "@prisma-next/sql-builder"
        - "@prisma-next/sql-orm-client"
      anyMatch: true
  - id: create-runtime-removed
    summary: |
      `createRuntime` is removed from `@prisma-next/sql-runtime`. Extension code that
      constructed a runtime via `createRuntime(...)` must switch to the target class
      constructor directly: `new PostgresRuntimeImpl({...})` from
      `@prisma-next/postgres/runtime`, or `new SqliteRuntimeImpl({...})` from
      `@prisma-next/sqlite/runtime`. Pass the same options minus the `stackInstance`
      unpacking — supply `adapter` directly instead of `stackInstance.adapter`.
    detection:
      glob: "**/*.{ts,tsx}"
      contains:
        - "createRuntime"
  - id: migration-op-factories-to-methods
    summary: |
      The bare migration op factory functions are removed from
      `@prisma-next/postgres/migration` (and the deprecated
      `@prisma-next/target-postgres/migration` alias). Replace each import and
      call-site with the corresponding method on `this` inside your `Migration`
      subclass. The option shapes changed from positional arguments to a single
      options object.
    detection:
      glob: "**/migration.ts"
      contains:
        - "from '@prisma-next/postgres/migration'"
        - "from '@prisma-next/target-postgres/migration'"
      anyMatch: true
    script: migration-op-factories-to-methods.ts
  - id: namespace-entries-open-dict
    summary: |
      `SqlNamespace.entries` is now an open dictionary typed
      `Readonly<Record<string, Readonly<Record<string, unknown>>>>`. The previously
      closed shape (`{ table?: ..., type?: ..., valueSet?: ... }`) is gone — dot-access
      like `.entries.table` or `.entries.collection` no longer compiles. Read tables via
      the `namespaceTables(ns)` helper from `@prisma-next/sql-contract/types`, or via
      bracket notation `entries['table']`. For typed getter access on the concrete
      class instances use the non-enumerable getters (`ns.table`, `schema.type`,
      `db.collection`). Annotations and type constraints that hard-code the closed shape
      must be widened to the open dict.
    detection:
      glob: "**/*.{ts,tsx}"
      contains:
        - ".entries.table"
        - ".entries.collection"
        - ".entries.type"
        - ".entries.valueSet"
      anyMatch: true
  - id: postgres-contract-serializer
    summary: |
      `SqlContractSerializer` (from `@prisma-next/family-sql/ir`) can no longer
      deserialize Postgres contracts. The family serializer now rejects the `type` entries
      key that every Postgres namespace carries. Extension code that deserializes a
      Postgres-emitted contract via `new SqlContractSerializer().deserializeContract(...)`
      must switch to `new PostgresContractSerializer()` from
      `@prisma-next/target-postgres/runtime`. SQLite and non-Postgres contracts are
      unaffected.
    detection:
      glob: "**/*.{ts,tsx}"
      contains:
        - "SqlContractSerializer"
---

<!--
control-query-extension-codecs: pgvector test files
(planner.behavior.test.ts, planner.contract-to-schema-ir.test.ts,
planner.storage-types.test.ts) were updated to pass an explicit
`PostgresControlAdapter` to `createPostgresMigrationPlanner`, which now
requires an adapter argument. Internal test harness change only — no
extension-author API change. Incidental substrate diff only.
-->

<!--
TML-2867: codec-routed DDL defaults. The pgvector extension test files were updated
to await lazy plan operations (`Promise.all(result.plan.operations)`) and to use
`PostgresControlAdapter` instead of the removed `createPostgresAdapter`. The
`packages/3-extensions/postgres re-export test` deletion was already declared by
TML-2859 above. No extension-author API change. Incidental substrate diff only.
-->

<!--
TML-2859: SQLite createTable authoring method. The free `createTable` function from
`@prisma-next/sqlite/migration` is now a protected method on the `SqliteMigration`
base class. The `createTable` re-export test in `packages/3-extensions/sqlite/` was
removed (it asserted the free function was exported, which is no longer true). The
README was updated to reflect the current authoring surface. No extension-author action
beyond what the `sqlite-create-table-method` entry in the 0.12-to-0.13 instructions
already covers. Incidental substrate diff only.
-->


<!--
TML-2785: the sql-orm-client runtime gained M:N correlated include
reads — `.include()` of an N:M relation resolves child rows through the
junction table via a correlated subquery. Internal runtime only; no
extension API or contract-shape change. No extension-author action
required.

TML-2786: the sql-orm-client runtime gained M:N relation filters — a
`where` predicate on an N:M relation lowers to an EXISTS subquery joined
through the junction table. Internal runtime only; no extension API or
contract-shape change. No extension-author action required.

TML-2838: the temporary `--no-memory-protection-keys` test-harness workaround
has been removed from every PGlite-backed vitest config (including
`packages/3-extensions/{postgres,supabase}`) now that the WAL-teardown crash is
fixed upstream in `@prisma/dev` 0.24.12 (which pulls in the
`@prisma/streams-local` worker-termination fix). Test-harness only — no
runtime, contract, or public-API change. Incidental substrate diff only.
-->

<!--
TML-2852: the enum read surface. Additive surface for `enumType`-authored enums.
`@prisma-next/postgres/contract-builder` gains `enumType` / `member` exports (the
Postgres-bound `enumType` constrains member values to the column codec) and the
factory `defineContract` overload threads a top-level `enums` key;
`@prisma-next/sql-orm-client` gains the lane-agnostic `db.enums.<namespace>.<Name>`
runtime accessor map (built from `domain.namespaces[ns].enum`) and value-union
narrowing of enum-restricted fields, plus emit-time narrowing in the emitter from a
field's `valueSet` ref. All additive — existing exports and the framework SPI are
unchanged, PSL `enum` stays native until the cutover, and `fixtures:check` is
byte-identical. No extension-author action. Incidental substrate diff only.
-->

# 0.13 → 0.14 — Extension-author upgrade instructions

## `uuid-preset-rename`

The uuid field preset names now include the storage encoding suffix:

| Before | After |
| --- | --- |
| `field.uuid()` | `field.uuidString()` |
| `field.id.uuidv4()` | `field.id.uuidv4String()` |
| `field.id.uuidv7()` | `field.id.uuidv7String()` |

Apply the rename in any extension test files, contract fixture files, or documentation that uses these presets. The rename is mechanical — run the colocated script or apply the substitutions directly:

```ts
// Before
id: field.id.uuidv7(),
userId: field.id.uuidv4(),
externalId: field.uuid(),

// After
id: field.id.uuidv7String(),
userId: field.id.uuidv4String(),
externalId: field.uuidString(),
```

No change to emitted `contract.json` — both old and new preset names emit the same codec (`sql/char@1`).

## `qualify-flat-builder-accessors`

The query builder (`@prisma-next/sql-builder`) and ORM client (`@prisma-next/sql-orm-client`) are now **always qualified by namespace**. The flat by-bare-name accessors are gone: the value returned by `sql({ … })` / `orm({ … })` is a map of per-namespace facets, so there is no `sql.<table>` and no `orm.<Model>` at the top level. You reach a table or model by naming its namespace.

This affects extension code that *builds queries* through these packages. Extensions that only contribute codecs, native types, or migration operations — and never construct a `sql`/`orm` query — need no change.

### Migrate query-building call sites

Insert the namespace segment after the builder output, naming the namespace each table/model is declared in:

```ts
// Before
const plan = sql.user.select('id', 'email').build();
const row  = await orm.User.find({ where: { id } });

// After — name the namespace (`public` for a standard single-schema SQL contract)
const plan = sql.public.user.select('id', 'email').build();
const row  = await orm.public.User.find({ where: { id } });
```

For an unbound contract (e.g. SQLite, or any target whose entities live in the late-bound namespace) the namespace segment is `__unbound__` — import `UNBOUND_NAMESPACE_ID` from `@prisma-next/framework-components/ir` and index with it (`sql[UNBOUND_NAMESPACE_ID].user`) rather than hard-coding the string. For a multi-namespace contract, name the specific namespace each table/model sits in.

### Validation

This is a type-level change — `pnpm typecheck` (or `pnpm build`) pinpoints every remaining flat access as a compile error (`Property '<table>' does not exist on type 'Db<…>'`). Fix each by inserting the namespace segment, then run your extension's standard `pnpm test`.

## `migration-op-factories-to-methods`

The bare op factory functions previously exported from `@prisma-next/postgres/migration` (and the deprecated `@prisma-next/target-postgres/migration` alias) are removed. Each function is now a protected method on the `PostgresMigration` base class — call it as `this.<method>(...)` inside your extension's `Migration` subclass.

The option shapes also changed: positional arguments are replaced by a single options object.

Remove the bare names from your import and replace each call-site:

| Before (bare function) | After (method) |
| --- | --- |
| `dropColumn(schema, table, column)` | `this.dropColumn({ schema, table, column })` |
| `setNotNull(schema, table, column)` | `this.setNotNull({ schema, table, column })` |
| `setDefault(schema, table, column, defaultSql)` | `this.setDefault({ schema, table, column, defaultSql })` |
| `addPrimaryKey(schema, table, name, columns)` | `this.addPrimaryKey({ schema, table, constraint: name, columns })` |
| `addForeignKey(schema, table, { name, columns, references, onDelete })` | `this.addForeignKey({ schema, table, foreignKey: { name, columns, references, onDelete } })` |
| `addCheckConstraint(schema, table, name, column, values)` | `this.addCheckConstraint({ schema, table, constraint: name, column, values })` |
| `createIndex(schema, table, indexName, columns)` | `this.createIndex({ schema, table, index: indexName, columns })` |
| `installExtension({ id, extensionName, invariantId })` | `this.installExtension({ id, extensionName, invariantId })` |

Example (extension migration):

```ts
// Before
import { installExtension, Migration, MigrationCLI } from '@prisma-next/target-postgres/migration';

override get operations() {
  return [
    installExtension({
      id: 'my-ext.install',
      extensionName: 'my_extension',
      invariantId: MY_INVARIANTS.install,
    }),
  ];
}

// After
import { Migration, MigrationCLI } from '@prisma-next/target-postgres/migration';

override get operations() {
  return [
    this.installExtension({
      id: 'my-ext.install',
      extensionName: 'my_extension',
      invariantId: MY_INVARIANTS.install,
    }),
  ];
}
```

The colocated script applies this transformation automatically. Run it from your extension root:

```bash
pnpm exec tsx node_modules/.skills/prisma-next-extension-upgrade/upgrades/0.13-to-0.14/migration-op-factories-to-methods.ts
```

## `create-runtime-removed`

`createRuntime` is removed from `@prisma-next/sql-runtime`. Construct the target runtime class directly instead.

```ts
// Before
import { createRuntime } from '@prisma-next/sql-runtime';
const runtime = createRuntime({ stackInstance, context, driver, ...opts });

// After — Postgres
import { PostgresRuntimeImpl } from '@prisma-next/postgres/runtime';
const runtime = new PostgresRuntimeImpl({ adapter: stackInstance.adapter, context, driver, ...opts });

// After — SQLite
import { SqliteRuntimeImpl } from '@prisma-next/sqlite/runtime';
const runtime = new SqliteRuntimeImpl({ adapter: stackInstance.adapter, context, driver, ...opts });
```

The options are identical except `stackInstance` is no longer passed: supply `adapter` from `stackInstance.adapter` directly. Depend on the bare-name interfaces (`PostgresRuntime`, `SqliteRuntime`) for type annotations, not the `Impl` classes.

## `namespace-entries-open-dict`

The `entries` property on every namespace class is now an open dictionary:

```ts
// The type is now:
entries: Readonly<Record<string, Readonly<Record<string, unknown>>>>

// Previously it was a closed shape:
entries: {
  table?: Readonly<Record<string, StorageTable>>;
  type?: Readonly<Record<string, PostgresEnumType>>;
  valueSet?: Readonly<Record<string, StorageValueSet>>;
}
```

Dot-access like `.entries.table`, `.entries.collection`, or `.entries.type` no longer compiles. Migrate to one of the two canonical read styles:

**Generic/walker code** — bracket notation:

```ts
// Before
const tables = ns.entries.table;

// After — bracket notation
const tables = ns.entries['table'] as Record<string, StorageTable> | undefined;
```

**Typed family/target code** — use the exported family helpers or the class getters:

```ts
// Using the namespaceTables() helper (for SqlNamespace values)
import { namespaceTables, namespaceValueSets } from '@prisma-next/sql-contract/types';
const tables = namespaceTables(ns);    // Record<string, StorageTable>
const vsets  = namespaceValueSets(ns); // Record<string, StorageValueSet> | undefined

// Using the non-enumerable class getter (for PostgresSchema instances)
const enumTypes = schema.type; // Record<string, PostgresEnumType>

// Using the namespaceCollections() helper (for MongoNamespace values)
import { namespaceCollections } from '@prisma-next/mongo-contract';
const collections = namespaceCollections(ns); // Record<string, MongoCollection>
```

**Type annotations** — widen any closed-shape annotation to the open dict:

```ts
// Before
const ns = namespaces[id] as { entries: { table: Record<string, StorageTable> } };

// After — open dict annotation
const ns = namespaces[id] as { entries: Record<string, Record<string, unknown>> };
// then narrow via the helper:
const tables = namespaceTables(ns);
```

This is a compile-time-only change when using the helpers — no runtime behavior differs. Run `pnpm typecheck` to find all remaining dot-access sites.

## `postgres-contract-serializer`

`SqlContractSerializer` (from `@prisma-next/family-sql/ir`) can no longer deserialize Postgres contracts. Every Postgres namespace carries a `type` key in its `entries`; the family serializer validates entries against a built-in registry (`table`, `valueSet` only) and throws a `ContractValidationError` when it encounters `type`.

Replace with `PostgresContractSerializer` from `@prisma-next/target-postgres/runtime`:

```ts
// Before
import { SqlContractSerializer } from '@prisma-next/family-sql/ir';
const contract = new SqlContractSerializer().deserializeContract(contractJson) as Contract;

// After
import { PostgresContractSerializer } from '@prisma-next/target-postgres/runtime';
const contract = new PostgresContractSerializer().deserializeContract(contractJson) as Contract;
```

Extension code that only uses the target descriptor's serializer (`descriptor.contractSerializer`) is unaffected — the postgres descriptor already exposes a `PostgresContractSerializer` instance. Only code that directly instantiates `SqlContractSerializer` for a Postgres contract needs to change. SQLite and non-Postgres contracts are unaffected.
