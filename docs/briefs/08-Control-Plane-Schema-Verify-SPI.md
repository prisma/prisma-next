# Brief: Control Plane — Schema Verify SPI

## Problem

The framework CLI must remain target-agnostic and avoid embedding SQL/catalog logic. At the same time, `db schema-verify` needs rich schema comparison:

- Table and column presence.
- Column type compatibility and nullability.
- Index/unique/foreign key/primary key expectations.
- Extension-backed types (e.g., pgvector).

We need a single, composable SPI that allows each target family to implement schema verification behind a stable interface.

## Family SPI Extension

- Extend `FamilyDescriptor.verify` with a monolithic schema verification hook:

```ts
family.verify.verifySchema?: (options: {
  readonly driver: ControlPlaneDriver;
  readonly contractIR: unknown;
  readonly target: TargetDescriptor;
  readonly adapter: AdapterDescriptor;
  readonly extensions: ReadonlyArray<ExtensionDescriptor>;
  readonly strict: boolean;
  readonly startTime: number;
  readonly contractPath: string;
  readonly configPath?: string;
}) => Promise<VerifyDatabaseSchemaResult>;
```

Where `VerifyDatabaseSchemaResult` mirrors the CLI envelope:

```ts
interface VerifyDatabaseSchemaResult {
  readonly ok: boolean;
  readonly code?: string; // PN-SCHEMA-0001 for mismatches
  readonly summary: string;
  readonly contract: { coreHash: string; profileHash?: string };
  readonly target: { expected: string; actual?: string };
  readonly schema: { issues: readonly SchemaIssue[] };
  readonly meta?: { contractPath: string; configPath?: string; strict: boolean };
  readonly timings: { total: number };
}

interface SchemaIssue {
  readonly kind:
    | 'missing_table'
    | 'missing_column'
    | 'type_mismatch'
    | 'nullability_mismatch'
    | 'primary_key_mismatch'
    | 'foreign_key_mismatch'
    | 'unique_constraint_mismatch'
    | 'index_mismatch'
    | 'extension_missing';
  readonly table: string;
  readonly column?: string;
  readonly indexOrConstraint?: string;
  readonly expected?: string;
  readonly actual?: string;
  readonly message: string;
}
```

## Responsibilities

- Family/target/extension:
  - Re-validate and narrow `contractIR` to family-specific types.
  - Use `ControlPlaneDriver` to query catalog tables / information schema.
  - Compute `SchemaIssue[]` for all contract-dependent structures:
    - Missing tables or columns.
    - Incompatible column SQL types or nullability.
    - Missing or incompatible indexes and constraints.
    - Missing extension-backed types needed for contract columns.
  - Decide what “compatible” means for the specific target (e.g., numeric subtypes, varchar lengths).
  - Return `ok: true` only when all contract requirements are satisfied.
  - Respect `strict` when implemented:
    - In strict mode, optionally treat extra schema elements as issues (e.g., `kind: 'extra_table'` once added).

- Framework CLI:
  - Must not import SQL or catalog types directly.
  - Treat `verifySchema` as an opaque operation with a structured result.
  - Surface family errors and schema issues via PN codes and CLI style guide conventions.

## v1 Strictness

- `strict` is wired through but not required to change behavior in v1:
  - Families can treat `strict` as a no-op initially.
  - Future iterations can add strict checks for:
    - Extra tables/columns/indexes in managed schemas.
    - Stricter type equality (instead of family-level compatibility).

## Error Codes

- Schema mismatch:
  - `PN-SCHEMA-0001` — “Contract requirements not met”.
  - Used whenever `ok: false` due to schema issues; `schema.issues` contains specifics.
- Missing SPI implementation:
  - CLI raises a `PN-CLI-*` error when `family.verify.verifySchema` is undefined; we do not support running `db schema-verify` without a family implementation.

## Notes

- Keep schema verification logic in migration/tooling plane packages (e.g., SQL family CLI tooling).
- Avoid runtime-plane imports or codec registries; use contract IR + manifests + catalog metadata only.
- Scope catalog queries to the schema objects that the contract depends on to minimize cost and permissions.

