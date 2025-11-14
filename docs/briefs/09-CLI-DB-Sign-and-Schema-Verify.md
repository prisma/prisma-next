# Brief: CLI — DB Sign and Schema Verify Integration

## Problem

`db sign` needs to be safe and predictable:

- We should not sign a database whose schema does not satisfy the contract, unless the user explicitly forces it.
- `db sign` should share its verification logic with `db schema-verify` to avoid drift between commands.
- The flow must remain target-agnostic in the framework CLI and push catalog details into the family/target layer.

## Flow

- `prisma-next db sign`:
  - Loads config and contract (same as `db verify` / `db schema-verify`).
  - Runs schema verification first via `verifyDatabaseSchema`:
    - Accepts and propagates `--strict`.
    - Uses the same family SPI (`family.verify.verifySchema`).
  - If `verifyDatabaseSchema.ok === false`:
    - Without `--force`:
      - Do not sign.
      - Exit with non-zero code and surface `PN-SCHEMA-0001` plus the schema issue list.
    - With `--force`:
      - Proceed to write/update the marker.
      - Include `forced: true` and carry schema issues into the sign result.
      - Emit a warning PN code (e.g., `PN-RTM-3199`) in TTY output to indicate signing with drift.

## Behavior

- Marker handling remains as described in existing briefs:
  - Missing marker → insert.
  - Same hash → no-op.
  - Different hash → update (with clear reporting of old → new).
- Schema verification is a prerequisite:
  - The same contract and DB URL are used as for `db schema-verify`.
  - Strictness flag is shared (`--strict`).
- Outputs:
  - Reuse the existing `db sign` result envelope, extended with:

```jsonc
{
  "forced": true,
  "schema": {
    "issues": [ /* SchemaIssue[] from verifyDatabaseSchema */ ]
  }
}
```

## Responsibilities

- Framework CLI:
  - Wire `db sign` to call `verifyDatabaseSchema` before any marker writes.
  - Enforce the `--force` gate for signing when schema issues are present.
  - Surface both schema issues and marker state changes in TTY/JSON.
- Control plane and family:
  - Reuse the same schema verification SPI as `db schema-verify`.
  - Keep marker read/write helpers and schema verification logic separate but composable.

## Related design docs

- Main design: `docs/DB-Schema-Verify-and-Sign-Design.md`.
- DB verify brief: `docs/briefs/complete/02-CLI-DB-Verify.md`.
- DB sign brief: `docs/briefs/03-CLI-DB-Sign.md`.

