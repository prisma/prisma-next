## Requirements

### Summary

Add `prisma-next db update` as the contract-driven schema reconciliation command for already-adopted databases.

The command must:

- Require an existing DB marker (missing marker fails with clear `db init` guidance).
- Plan from live schema + desired contract, not from authoring lifecycle hints.
- Allow lossy operations for now (including destructive/widening classes where supported).
- Reuse existing migration runner safety and audit semantics (lock, checks, marker, ledger).

### Functional requirements

1. **CLI command**
   - Add `prisma-next db update`.
   - Support `--db`, `--config`, `--plan`, `--json [format]`, `-q`, `-v`, `-vv`, `--timestamps`, `--color/--no-color`.
   - Reject `--json ndjson` (object-only output, same as `db init`).

2. **Marker-gated behavior**
   - If marker is missing, fail with actionable fix: run `prisma-next db init`.
   - If marker exists, use marker `{storageHash, profileHash, contractJson}` as origin source of truth.

3. **Planning behavior**
   - Input:
     - desired contract from emitted `contract.json`,
     - live schema from introspection,
     - operation policy that allows additive + widening + destructive.
   - Planner must emit deterministic operation ordering and stable IDs.
   - No reliance on `@deprecated`/`@deleted` hints in this iteration.

4. **Execution behavior**
   - In apply mode, attach plan origin from marker to enforce marker-origin compatibility in runner.
   - Keep runner execution checks enabled (precheck/postcheck/idempotency).
   - Preserve runner lock/transaction/verification semantics.
   - On success, marker and ledger are written through existing runner behavior.

5. **Output and errors**
   - Match existing CLI style and structured error envelope conventions.
   - Provide clear error mapping for:
     - missing marker,
     - planning conflicts,
     - runner failures (including marker-origin mismatch and policy violations).

### Tests

- Add failing-first CLI integration tests for:
  - help/registration,
  - plan and apply happy paths,
  - missing marker failure,
  - JSON output shape,
  - unsupported JSON format (`ndjson`).
- Add failing-first planner tests for widening/destructive scenarios and policy gating.

### Documentation

- Add `docs/commands/db-update.md`.
- Update CLI README with `db update` usage, behavior, outputs, and error codes.
- Update architecture docs for `db update` strategy and explicitly state no lifecycle hint dependency in this phase.

### Non-goals

- Introducing `@deprecated`/`@deleted` planning semantics.
- Contract-to-contract planner interface redesign.
- Full environment-history policy framework.
- Non-SQL family support.
