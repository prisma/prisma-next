## SQL Schema IR, Extension Verification, and Migration Planning

### Context

The SQL family needs a consistent way to:

- Verify that a live database schema satisfies an emitted SQL contract (`db schema-verify`).
- Eventually plan and apply migrations as a sequence of `MigrationOperation`s over database states.

Today, the SQL family’s `verifySchema` implementation for Postgres:

- Talks directly to `information_schema.*`, `pg_catalog`, and `pg_extension`.
- Performs verification logic in terms of catalog rows and ad‑hoc string comparisons.
- Deduces semantics from codec IDs (e.g. `'pg/int4@1'` → `'int4'`) instead of using explicit metadata.

This works for a first MVP, but it couples verification logic tightly to Postgres, and it makes it hard to:

- Share verification and migration logic across SQL targets.
- Let extension packs contribute precise extension‑specific checks.
- Use the same representation of schema for both verification and planning.

This document proposes a **SQL Schema IR** to decouple “what the schema is” from “how we introspect it”, and to make verification and migration planning operate over this IR instead of raw catalog tables.

### Goals

- Define a **target‑agnostic SQL schema IR** that:
  - Represents the relational structures we care about (tables, columns, nullability, PK/FK, uniques, indexes).
  - Attaches codec IDs and explicit **native DB type** for each column.
  - Is **extensible** in a disciplined way so targets and extension packs can hang additional metadata without bloating core.
- Refactor SQL family verification (`verifySchema`) to:
  - Run over `SqlSchemaIR` + contract, not against raw Postgres catalogs.
  - Delegate extension‑specific checks to **extension packs** via a small hook, not hard‑coded in the family.
  - Stop inferring DB types from codec IDs; instead, use explicit codec/column metadata.
- Provide a foundation for a **migration planner** that treats `SqlSchemaIR` instances as nodes in a graph and `MigrationOperation`s as edges.

### Non‑Goals

- Designing the full migration planner in detail (we only outline its relationship to `SqlSchemaIR`).
- Encoding every target‑specific catalog nuance in core IR.
- Handling non‑SQL families (document, key‑value, etc.).

---

## SQL Schema IR

### Core Structure

At the heart of the design is a small, relational IR that can represent the schema for any SQL target:

```ts
type SqlSchemaIR = {
  readonly tables: Record<string, SqlTableIR>;
  readonly extensions: readonly string[];      // logical extension ids or DB extension names
  readonly annotations?: SqlAnnotations;       // extensible global metadata
};

type SqlTableIR = {
  readonly name: string;
  readonly columns: Record<string, SqlColumnIR>;
  readonly primaryKey?: readonly string[];
  readonly foreignKeys: readonly SqlForeignKeyIR[];
  readonly uniques: readonly SqlUniqueIR[];
  readonly indexes: readonly SqlIndexIR[];
  readonly annotations?: SqlAnnotations;       // table‑level metadata
};

type SqlColumnIR = {
  readonly name: string;
  readonly typeId: string;                     // codec id, e.g. 'pg/int4@1'
  readonly nativeType?: string;                // explicit DB type, e.g. 'integer', 'vector'
  readonly nullable: boolean;
  readonly annotations?: SqlAnnotations;       // column‑level metadata
};

type SqlForeignKeyIR = {
  readonly columns: readonly string[];
  readonly referencedTable: string;
  readonly referencedColumns: readonly string[];
  readonly name?: string;
  readonly annotations?: SqlAnnotations;
};

type SqlUniqueIR = {
  readonly columns: readonly string[];
  readonly name?: string;
  readonly annotations?: SqlAnnotations;
};

type SqlIndexIR = {
  readonly columns: readonly string[];
  readonly name?: string;
  readonly unique: boolean;
  readonly annotations?: SqlAnnotations;
};

type SqlAnnotations = {
  readonly [namespace: string]: unknown;       // namespaced extensibility
};
```

Key properties:

- **Family‑level**: This IR is owned by the SQL family, not any concrete target.
- **Relational core only**: Just the structures needed for verification and migration: tables, columns, constraints, indexes, extensions.
- **Codec‑aware, but not codec‑driven**:
  - `typeId` carries the full codec ID (`'pg/int4@1'`, `'pg/vector@1'`, etc.).
  - `nativeType` is an explicit DB type string (e.g. `'integer'`, `'vector'`, `'timestamp with time zone'`).
  - No behavior is derived from parsing `typeId` string structure.
- **Extensible** via namespaced `annotations` fields at the schema, table, column, and index/constraint levels.

### Explicit Native DB Types

Instead of inferring DB types from codec IDs, we will rely on explicit metadata originating from codec definitions:

```ts
// Example shape; exact location may live in codec type definitions
type CodecMeta = {
  readonly db?: {
    readonly sql?: {
      readonly postgres?: {
        readonly nativeType: string;   // 'integer', 'text', 'vector', 'timestamp with time zone', ...
      };
      // future SQL targets here
    };
  };
};
```

When the SQL family assembles codecs (from target + adapter + extensions), it can look up this metadata for each `typeId` and use it to populate `SqlColumnIR.nativeType` during introspection:

- `typeId: 'pg/int4@1'` + Postgres codec metadata → `nativeType: 'integer'`.
- `typeId: 'pg/vector@1'` (pgvector) → `nativeType: 'vector'`.

Verification and planning then use `nativeType` as the ground truth for DB types, not the codec ID string.

This satisfies:

- **Explicit over implicit**: packs must declare native DB types; naming conventions are not relied on for behavior.
- **Target‑specific but localized**: e.g. codec metadata for Postgres lives in Postgres/pgvector packs, not in framework or generic family code.

### Extensions and Annotations

The `extensions` array and `annotations` bags give targets and packs room to add non‑core metadata without polluting core IR:

- `extensions` can contain logical extension IDs or DB extension names (e.g. `['vector', 'postgis']` for Postgres).
- `annotations` can be used as:
  - `schema.annotations.pg`: Postgres‑level metadata.
  - `table.annotations.pgvector`: pgvector‑specific hints (e.g. default distance metric).
  - `column.annotations.pgvector`: per‑column extension config (dimensions, metric).

Each pack owns its namespace (aligned with ADR‑104 style namespacing) and may read/write only under that key. Core verification and planning ignore annotations they don’t understand.

---

## Target‑Specific Introspection

### Introspector Interface

We introduce a per‑target introspector responsible for translating **real DB catalogs** into `SqlSchemaIR`:

```ts
interface SqlSchemaIntrospector {
  introspect(driver: ControlPlaneDriver, contract?: SqlContract): Promise<SqlSchemaIR>;
}
```

For Postgres, `introspectPostgresSchema` is the only place that knows about target‑specific catalog tables:

- `information_schema.tables`, `information_schema.columns`.
- `information_schema.table_constraints`, `key_column_usage`, `constraint_column_usage`.
- `pg_index`, `pg_class`, `pg_namespace`.
- `pg_extension`.

It is responsible for:

- Discovering tables and columns, PK/FK/unique/index structures.
- Mapping columns to `nativeType` (e.g. using `data_type` and `udt_name` for user‑defined types).
- Optionally populating `extensions` (e.g. from `pg_extension.extname`).
- Attaching target‑specific annotations (`pg`, `pgvector`, etc.) under namespaced keys.

The SQL family’s verification and planning logic operate purely over `SqlSchemaIR`, and do not talk to catalog tables directly.

### Other SQL Targets

Other SQL targets (e.g. MySQL, SQL Server) implement their own introspectors that also produce `SqlSchemaIR`. They can:

- Use whatever catalogs or APIs are appropriate for their engine.
- Populate `nativeType` and `annotations` as they see fit.
- Reuse the same family‑level verification and planning logic, because that logic is expressed in terms of the IR.

---

## Verification Over SqlSchemaIR

### Family‑Level `verifySchema`

The SQL family’s `verifySchema` hook (used by `db schema-verify`) will be refactored to take:

- The validated **contract IR** for the SQL family.
- A `SqlSchemaIR` produced by the target’s introspector.
- The set of configured **extension descriptors**.

In pseudocode:

```ts
export async function verifySchema(options: {
  driver: ControlPlaneDriver;
  contractIR: SqlContract;
  target: TargetDescriptor;
  adapter: AdapterDescriptor;
  extensions: readonly ExtensionDescriptor[];
  strict: boolean;
  startTime: number;
  contractPath: string;
  configPath?: string;
}): Promise<VerifyDatabaseSchemaResult> {
  const schemaIR = await targetIntrospector.introspect(options.driver, options.contractIR);

  const issues: SchemaIssue[] = [];

  // 1. Contract vs schema IR: tables, columns, types, nullability, constraints, indexes
  issues.push(...compareContractAgainstSchema(options.contractIR, schemaIR, options.strict));

  // 2. Extension packs: extension‑specific checks over IR (+ driver if needed)
  for (const ext of options.extensions) {
    if (!ext.verifySchema) continue;
    const extIssues = await ext.verifySchema({
      driver: options.driver,     // optional, for deeper checks
      contractIR: options.contractIR,
      schemaIR,
      strict: options.strict,
    });
    issues.push(...mapExtensionIssues(extIssues));
  }

  return buildVerifyResult(issues, options, schemaIR);
}
```

The core comparison function, `compareContractAgainstSchema`, operates on the IR:

- Tables: missing/extra tables (according to strictness).
- Columns: presence, `typeId` and `nativeType` compatibility, nullability.
- PK/FK: sets of columns and referenced tables.
- Unique constraints and indexes: sets of columns.

It does **not** parse codec IDs or query catalogs directly.

### Extension‑Level Verification Hooks

To avoid hard‑coding extension checks (e.g. pgvector) in the family, each extension descriptor may optionally expose a `verifySchema` hook:

```ts
interface ExtensionSchemaVerifierOptions {
  readonly driver: ControlPlaneDriver;
  readonly contractIR: SqlContract;
  readonly schemaIR: SqlSchemaIR;
  readonly strict: boolean;
}

interface ExtensionSchemaIssue {
  readonly kind: string;
  readonly message: string;
  readonly table?: string;
  readonly column?: string;
  readonly detail?: Record<string, unknown>;
}

interface ExtensionDescriptor {
  // existing fields...
  readonly verifySchema?: (
    options: ExtensionSchemaVerifierOptions,
  ) => Promise<readonly ExtensionSchemaIssue[]>;
}
```

Examples:

- **pgvector** can check that:
  - `vector` appears in `schemaIR.extensions` (or in some `annotations.pg.extensions` bag).
  - All `pg/vector@1` columns have compatible `nativeType` and dimension/metric configuration if annotated.
  - Required vector indexes are present (via `schemaIR.tables[table].indexes` + `annotations.pgvector`).

- A future **PostGIS** extension could verify that:
  - The `postgis` extension is installed.
  - Geometry/geography columns have the expected SRID and type.

The SQL family’s `verifySchema` simply aggregates extension issues into its own `SchemaIssue` list; it does not know anything about pgvector or PostGIS semantics.

This gives us:

- **Target‑specific logic but localized** inside the pack that owns it.
- A clear way for extensions to express “extension presence/health” as part of schema verification.

---

## Migration Planner Over SqlSchemaIR

### States and Transitions

We want the migration planner to operate as a path search over the space of **database schemas**, with:

- **Nodes**: instances of `SqlSchemaIR` (possibly with additional metadata for versioning).
- **Edges**: `MigrationOperation`s that transform one IR into another.

Conceptually:

```ts
interface MigrationOperation {
  readonly id: string;
  readonly targetFamily: 'sql';

  // Apply operation to schema IR; may error if preconditions are not met
  apply(ir: SqlSchemaIR): SqlSchemaIR;

  // Optionally: precondition checks and cost heuristics
  checkPreconditions?(ir: SqlSchemaIR): void;
  estimateCost?(from: SqlSchemaIR, to: SqlSchemaIR): number;

  // Lowering to concrete DDL for a given target (Postgres, MySQL, etc.)
  toDDL(target: TargetDescriptor): readonly string[];
}
```

The planner:

- Starts from a **current schema IR** (introspected DB schema).
- Has a **desired schema IR** derived from the contract (and possibly extension annotations).
- Explores sequences of operations (edges) that transform current → desired, using search algorithms (A*, Dijkstra, or domain‑specific strategies) guided by:
  - Structural differences between IRs.
  - Operation costs and preconditions.

### Using SqlSchemaIR for Planning

`SqlSchemaIR` is a suitable abstraction for planning because:

- It captures the **structural aspects** migrations care about: tables, columns, types, constraints, indexes, extensions.
- It is **compact and regular**, making it easy to diff and apply transformations.
- It is **extensible**, so extension packs can participate in planning:
  - A pgvector pack might introduce a `CreateVectorIndex` operation that reads its own annotations and adds index entries into the IR under its namespace.

Because operations are defined over IR, not raw SQL:

- The same operations can be reused across targets where semantics align.
- Lowering to concrete DDL is done per target (in `toDDL`), not in core planning logic.

---

## Next Steps

### 1. Introduce SqlSchemaIR Types

- Add the `SqlSchemaIR`, `SqlTableIR`, `SqlColumnIR`, `SqlForeignKeyIR`, `SqlUniqueIR`, `SqlIndexIR`, and `SqlAnnotations` types in a shared SQL package (e.g. `packages/sql/contract` or a new `packages/sql/schema-ir`).
- Keep the IR intentionally small and generic.
- Wire up type exports so both the SQL family verifier and future migration code can use them.

### 2. Refine Codec / Column Metadata

- Extend codec type definitions (in SQL + Postgres + extension packs) to include explicit `nativeType` metadata per target.
- Ensure contract building and family assembly preserve `typeId` and `nativeType` in a way the introspector can access.
- Remove or deprecate any implicit logic that derives behavior from codec ID string structure.

### 3. Implement Postgres Introspector → SqlSchemaIR

- Extract the existing Postgres catalog queries used by `verifySchema` into a dedicated `introspectPostgresSchema(driver)` function that returns `SqlSchemaIR`.
- Populate:
  - `tables`, `columns`, PK/FK/uniques/indexes.
  - `nativeType` for each column using `data_type`/`udt_name`.
  - `extensions` from `pg_extension` (or via annotations under `pg` namespace).
- Ensure this is the only place that contains Postgres‑specific SQL for schema introspection.

### 4. Refactor SQL Family `verifySchema` to Use IR

- Change the SQL family’s `verifySchema` implementation to:
  - Call the Postgres introspector to obtain `SqlSchemaIR`.
  - Compare contract vs IR instead of contract vs raw catalog rows.
  - Produce `SchemaIssue`s solely from IR + contract + extension hooks.
- Keep the external SPI (`FamilyDescriptor.verify.verifySchema`) stable; only the internal implementation changes.

### 5. Add Extension‑Level `verifySchema` SPI

- Extend `ExtensionDescriptor` with an optional `verifySchema` hook that receives:
  - `driver`, `contractIR`, `schemaIR`, `strict`.
- Update the SQL family `verifySchema` to:
  - Call each extension’s `verifySchema` hook (if present).
  - Map extension‑level issues into family‑level `SchemaIssue`s (e.g. `extension_missing`, `index_mismatch`, etc.).
- Implement a first concrete example in `@prisma-next/extension-pgvector`:
  - Check for `vector` in `schemaIR.extensions` (or `annotations.pg.extensions`).
  - Optionally check presence/shape of vector indexes.

### 6. Align `db schema-verify` CLI with IR‑based Results

- Ensure the CLI’s `db schema-verify` command is still emitting the same envelope (`VerifyDatabaseSchemaResult`) but built from the IR‑based verifier.
- Confirm that:
  - JSON/human output remain consistent.
  - Exit codes and error mappings (PN‑SCHEMA‑0001, etc.) are unchanged from a consumer perspective.

### 7. Design Migration Operation Interface Over SqlSchemaIR

- Define `MigrationOperation` interfaces that operate on `SqlSchemaIR`.
- Identify the minimal initial set of operations:
  - `CreateTable`, `DropTable`.
  - `AddColumn`, `AlterColumn`, `DropColumn`.
  - `AddPrimaryKey`, `DropPrimaryKey`, `AddForeignKey`, `DropForeignKey`.
  - `AddIndex`, `DropIndex`.
- Specify how operations:
  - Transform `SqlSchemaIR` (`apply`).
  - Check preconditions (`checkPreconditions`).
  - Lower to target DDL (`toDDL` for Postgres).

### 8. Prototype a Simple Planner Using SqlSchemaIR

- Implement a simple planner that:
  - Diffs current IR vs desired IR.
  - Proposes a greedy or rule‑based sequence of `MigrationOperation`s to reconcile the differences.
- Keep it intentionally small and focused on correctness over optimality.
- Use this to validate that `SqlSchemaIR` is sufficient for planning.

### 9. Iterate and Generalize

- Once Postgres is working end‑to‑end:
  - Introduce a second SQL target (even in a limited fashion) to validate that `SqlSchemaIR` and operation interfaces are truly target‑agnostic.
  - Refine `annotations` usage and extension hooks based on real extension packs (pgvector, PostGIS).
- Use findings to refine this doc into a formal ADR if needed.


