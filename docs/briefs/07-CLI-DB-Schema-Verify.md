# Brief: CLI — DB Schema Verify

## Problem

`db verify` currently validates only the contract marker (target ID and contract hash). We also need a command that verifies whether the *live database schema* satisfies the emitted contract, independent of any marker table. This is important when:

- A team adopts Prisma Next on an existing database that has no contract marker.
- The database schema has changed outside Prisma Next’s visibility and needs to be checked against the contract.
- The contract has changed and we want to confirm that the schema still satisfies it (without relying on the marker).

## Command

- `prisma-next db schema-verify`
  - Read-only, catalog-based schema verification.
  - Canonical noun → verb shape under the `db` group.

## Behavior

- Loads config via the existing CLI config loader.
- Uses `config.db.url` as the connection string (no shadow DB in v1).
- Loads `contract.json` from:
  - `config.contract.output` if configured, otherwise
  - `src/prisma/contract.json`.
- Validates contract JSON via `config.family.validateContractIR`.
- Delegates schema verification to the control-plane family hook:
  - `config.family.verify.verifySchema(...)`.
  - Family/target/extension own all SQL/catalog semantics and type compatibility rules.

## Strictness

- Default mode is *permissive*:
  - Fail when the contract depends on schema elements that are missing or incompatible.
  - Ignore extra tables/columns/indexes that are not referenced by the contract.
- A `--strict` flag is accepted and propagated but initially stubbed:
  - Families receive `strict: true`.
  - v1 implementation may treat strict mode like permissive mode internally.
  - Future: strict mode will fail on extra schema elements within the managed schema(s).

## Outputs

- Exit codes (per CLI Style Guide):
  - `0`: success (schema satisfies contract).
  - `1`: schema mismatch or runtime error (PN-SCHEMA or PN-RTM codes).
  - `2`: usage/config errors (PN-CLI codes).
- TTY output:
  - On success: `✓ Database schema satisfies contract`.
  - On mismatch: `✖ Contract requirements not met (PN-SCHEMA-0001)` plus a compact list:
    - `Contract requirements not met:`
    - `- table posts: not present`
    - `- table users`
    - `  - column name`
    - `    - type mismatch: expected text, found integer`.
- JSON output (`--json`):
  - Single object with a consistent CLI envelope:

```jsonc
{
  "ok": false,
  "code": "PN-SCHEMA-0001",
  "summary": "Contract requirements not met",
  "contract": { "coreHash": "…", "profileHash": "…" },
  "target": { "expected": "postgres", "actual": "postgres" },
  "schema": {
    "issues": [
      {
        "kind": "missing_table",
        "table": "posts",
        "message": "Table posts is required by the contract but not present."
      },
      {
        "kind": "type_mismatch",
        "table": "users",
        "column": "name",
        "expected": "text",
        "actual": "integer",
        "message": "Column users.name has incompatible type; expected text, found integer."
      }
    ]
  },
  "meta": {
    "configPath": "…",
    "contractPath": "…",
    "strict": false
  },
  "timings": { "total": 57 }
}
```

## Scope & Responsibilities

- Framework CLI:
  - Loads config and contract.
  - Creates a control-plane driver from the configured driver descriptor.
  - Calls the family’s `verifySchema` hook.
  - Normalizes the result into the shared CLI JSON envelope and formats TTY output.
- Family/target/extension:
  - Implement schema introspection and comparison logic.
  - Decide which column types, nullability rules, and constraint shapes are considered compatible.
  - Only read schema objects required by the contract.

## Related design docs

- Main design: `docs/DB-Schema-Verify-and-Sign-Design.md`.
- Control plane executor: `docs/briefs/complete/Control-Plane-Executor.md`.

