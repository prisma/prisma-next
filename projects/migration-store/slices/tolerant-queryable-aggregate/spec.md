# Slice: tolerant-queryable-aggregate

_Parent project `projects/migration-store/`. Outcome contributed: the one model becomes tolerant + queryable, and integrity becomes a query — the foundation every read command will lean on._

## At a glance

Separate **build** from **judge** in `@prisma-next/migration-tools`'s contract-space model: make `reconstructGraph` pure and `readMigrationsDir` tolerant, move `loadContractSpaceAggregate` to the disk-only tolerant signature with lazy `graph()` / `contract()` facets + query methods, and expose integrity as a `checkIntegrity()` query returning the full violation set. Re-point the consumers that previously gated on load-time throws — `migration check`, the apply path, `db verify`, and the two existing aggregate readers (`status`, `show`) — onto the model + an explicit integrity gate, behaviour-preserving.

## Chosen design

The decided design is in the project spec — [`projects/migration-store/spec.md` § Design](../../spec.md). This slice implements that design in full **except** the three read commands not yet on the aggregate (`list` / `graph` / `log`), which are slice 2 ([TML-2716](https://linear.app/prisma-company/issue/TML-2716)).

Concretely, this slice delivers:

- `reconstructGraph` builds pure structure — the `errorSameSourceAndTarget` throw (`migration-graph.ts:53-57`) is removed; a `from === to` self-edge is representable, not fatal.
- `readMigrationsDir` is tolerant: `hashMismatch` / `providedInvariantsMismatch` become represented violations with the package **retained**; unparseable / missing / schema-invalid manifests become `packageUnloadable` with the package **omitted**. No throw on disk content.
- `loadContractSpaceAggregate({ migrationsDir, deserializeContract })` — disk-only, never throws on disk content; per-space raw `packages` + user-authored `refs` + nullable `headRef`; lazy memoised `graph()` / `contract()`; query methods `listSpaces` / `hasSpace` / `space` / `spaces`; `app` + `extensions` retained for existing consumers.
- `checkIntegrity(opts?)` returns the full `IntegrityViolation[]` (no first-failure bail); config/contract-dependent checks gated by `declaredExtensions` / `requireContracts`.
- Consumers re-pointed onto the model + explicit gate: `migration check` (now reports ALL violations at once), the apply path (`compute-extension-space-apply-path.ts`), `db verify`, `migration status`, `migration show`. CLI `mapLoadAggregateError` → `IntegrityViolation` mapping preserves `5001` / `5002` / `PN-MIG-CHECK-001..006`.

## Coherence rationale

One reviewable thesis: **validation moves out of the load path (throws) into a `checkIntegrity()` query, and the model becomes tolerant + queryable — behaviour preserved.** The split between this slice and slice 2 is forced by the spec's atomicity constraints: the self-edge throw may be removed only where it is re-acquired (check / apply / verify), and the `loadContractSpaceAggregate` signature change is atomic with apply / verify construction. Those constraints pull the foundation + its current consumers into one PR; they do not pull in `list` / `graph` / `log`, which only *add* consumers and are pure net-deletion follow-up.

## Scope

**In:** `packages/1-framework/3-tooling/migration/src/migration-graph.ts`, `io.ts`, `aggregate/{types,loader}.ts` (+ new integrity surface); the CLI aggregate-loader wrapper (`packages/1-framework/3-tooling/cli/src/utils/contract-space-aggregate-loader.ts`), `migration-check`, the apply path, `db verify`, `migration status`, `migration show`; unit tests for the primitives + model + integrity query; cross-consumer integration tests (self-edge / hash-mismatch / orphan-dir).

**Out:** `migration list` / `graph` / `log` (slice 2). No new on-disk format, ref semantics, or marker shape. No rewrite of apply / verify planning beyond relocating the gate + switching construction.

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
|---|---|---|
| `migration check` first-failure bail (`migration-check.ts:140-166`) | Must change to report-all | The visible symptom the slice fixes; pin with a multi-violation fixture. |
| `reconstructGraph` callers beyond check | Re-point all | Full set per project spec § Blast radius: `migration-new`, `migration-show` (×3), `command-helpers.loadMigrationPackages`, `aggregate/loader` (×2), `compute-extension-space-apply-path`. `migration-new` / `command-helpers` callers that are *list/graph/log*-only stay on their current path until slice 2. |
| CLI error envelopes `5001` / `5002` + `PN-MIG-CHECK-*` | Preserve verbatim | `mapLoadAggregateError` must keep code + `meta.violations[]` shape. |

## Slice-specific done conditions

- [ ] Existing command output / `--json` / structured errors unchanged, **except** the intended self-edge tolerance change (readers render it; it surfaces as a structured violation only where integrity is asked).
- [ ] Integration tests assert self-edge / hash-mismatch / orphan-dir behaviour across consumer classes: `show` tolerates-and-renders; `check` reports all at once; apply / verify refuse with the structured violation.
- [ ] Net deletion (or net-neutral) at the re-pointed consumer call sites; any growth flagged in review.

## Open Questions

None. The design is settled in the project spec; this slice implements it.

## References

- Parent project: [`projects/migration-store/spec.md`](../../spec.md), [`design-notes.md`](../../design-notes.md)
- Linear issue: [TML-2715](https://linear.app/prisma-company/issue/TML-2715)
- Subsystem: [`docs/architecture docs/subsystems/7. Migration System.md`](../../../../docs/architecture%20docs/subsystems/7.%20Migration%20System.md)
- ADR: [ADR 212 — Contract spaces](../../../../docs/architecture%20docs/adrs/ADR%20212%20-%20Contract%20spaces.md)

## Dispatch plan

### Dispatch 1: tolerant primitives + integrity vocabulary

- **Outcome:** `reconstructGraph` builds pure structure (no self-edge throw); `readMigrationsDir` is tolerant — returns retained packages + a list of represented load-time problems (`hashMismatch` / `providedInvariantsMismatch` retained; `packageUnloadable` omitted) instead of throwing on disk content; the `IntegrityViolation` union exists. Unit tests pin tolerance + purity. Internal migration-tools callers updated only as far as needed to compile; CLI consumers may be temporarily red (driven green by D3).
- **Builds on:** The spec's chosen design.
- **Hands to:** A pure `reconstructGraph`, a tolerant `readMigrationsDir` returning `{ packages, problems }`, and the `IntegrityViolation` value vocabulary.
- **Focus:** `migration-graph.ts`, `io.ts`, the new violation types. **Out:** the aggregate, `checkIntegrity()`, consumer re-pointing.

### Dispatch 2: tolerant queryable aggregate + `checkIntegrity()`

- **Outcome:** `loadContractSpaceAggregate` has the disk-only tolerant signature; `ContractSpaceMember` / `ContractSpaceAggregate` carry raw `packages` + `refs` + nullable `headRef` + lazy `graph()` / `contract()` + query methods (`listSpaces` / `hasSpace` / `space` / `spaces`), `app` + `extensions` retained; `checkIntegrity(opts?)` returns the full violation set (no bail), config/contract checks gated by the opts. Unit tests cover construction tolerance, lazy facets, and the integrity query.
- **Builds on:** D1's pure primitives + violation vocabulary.
- **Hands to:** The tolerant queryable model API + `checkIntegrity()` that consumers will gate on.
- **Focus:** `aggregate/{types,loader}.ts` + integrity surface. **Out:** consumer re-pointing, integration tests.

### Dispatch 3: re-point the load-throw consumers onto the model + explicit gate

- **Outcome:** `migration check` (reports ALL violations at once), the apply path (`compute-extension-space-apply-path.ts`), `db verify`, `migration status`, `migration show`, and the CLI aggregate-loader wrapper all construct the tolerant aggregate and gate via `checkIntegrity()`; `5001` / `5002` / `PN-MIG-CHECK-001..006` envelopes + `meta.violations[]` preserved. Workspace typecheck + package tests green.
- **Builds on:** D2's model API + `checkIntegrity()`.
- **Hands to:** All current aggregate / load-throw consumers on the one model; behaviour preserved modulo self-edge tolerance + check-reports-all.
- **Focus:** the named CLI commands + apply/verify paths + the CLI wrapper. **Out:** `list` / `graph` / `log` (slice 2).

### Dispatch 4: cross-consumer integrity integration tests

- **Outcome:** A self-edge / hash-mismatch / orphan-space-dir project fixture is exercised across consumer classes — `show` tolerates-and-renders; `check` reports all three at once; apply / verify refuse with the structured violation. Any transient dispatch-internal scaffolding (e.g. checked wrappers) removed; net-deletion confirmed at re-pointed sites.
- **Builds on:** D3's re-pointed consumers.
- **Hands to:** Slice DoD met — the tolerant queryable model + integrity query, proven across consumer classes.
- **Focus:** integration test fixtures + assertions; final cleanup pass. **Out:** new behaviour.
