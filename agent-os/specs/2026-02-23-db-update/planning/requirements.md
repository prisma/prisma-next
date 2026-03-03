## Requirements

### Summary

Add `prisma-next db update` as the contract-driven schema reconciliation command for existing databases.

The command must:

- Work on any database, whether or not it has been initialized with `db init`. Create the marker table if missing; update the marker regardless of prior content.
- Plan from live schema + desired contract, not from authoring lifecycle hints.
- Allow additive, widening, and destructive operation classes where supported.
- Reuse existing migration runner safety and audit semantics (lock, marker, ledger), with execution checks disabled by default for `db update`.

### Functional requirements

1. **CLI command**
   - Add `prisma-next db update`.
   - Support `--db`, `--config`, `--plan`, `--json [format]`, `-q`, `-v`, `-vv`, `--timestamps`, `--color/--no-color`.
   - Reject `--json ndjson` (object-only output, same as `db init`).

2. **Marker behavior**
   - Marker is optional; create if missing, update regardless of content.
   - The marker is bookkeeping only — not a precondition for `db update`.

3. **Planning behavior**
   - Input:
     - desired contract from emitted `contract.json`,
     - live schema from introspection,
     - operation policy that allows additive + widening + destructive.
   - Planner must emit deterministic operation ordering and stable IDs.
   - No reliance on `@deprecated`/`@deleted` hints in this iteration.

4. **Execution behavior**
   - In apply mode, disable runner execution checks by default (precheck/postcheck/idempotency) for lower per-operation overhead.
   - Preserve runner lock/transaction/verification semantics.
   - On success, marker and ledger are written through existing runner behavior.

5. **Output and errors**
   - Match existing CLI style and structured error envelope conventions.
   - Provide clear error mapping for:
     - planning conflicts,
     - runner failures (including policy violations),
     - destructive changes requiring explicit confirmation.

### Tests

- Add failing-first CLI integration tests for:
  - help/registration,
  - plan and apply happy paths,
  - fresh database without prior db init,
  - JSON output shape,
  - unsupported JSON format (`ndjson`).
- Add failing-first planner tests for widening/destructive scenarios and policy gating.

### Documentation

- Keep `docs/commands/SUMMARY.md` and `docs/commands/README.md` aligned with current `db update` semantics.
- Update CLI README with `db update` usage, behavior, outputs, and error codes.
- Update architecture docs for `db update` strategy and explicitly state no lifecycle hint dependency in this phase.

### Non-goals

- Introducing `@deprecated`/`@deleted` planning semantics.
- Contract-to-contract planner interface redesign.
- Full environment-history policy framework.
- Non-SQL family support.
