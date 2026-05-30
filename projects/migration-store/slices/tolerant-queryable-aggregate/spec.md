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

**Post-review refinement (round 2).** "Behaviour preserved + tolerant/queryable" is necessary but not sufficient: the thesis also requires that the foundation be *structurally whole* before slice 2 adds three more readers to it — one integrity vocabulary with no hidden throw, one mapping spine, and each slice-1 consumer querying the model **once**. The first round delivered the behaviour but left that structure half-built (see [`reviews/pr-626/`](reviews/pr-626/)). Round 2 (D5–D10) closes the gap. This does not pull slice-2 work forward — `list`/`graph`/`log` re-pointing and the `loadMigrationPackages` deletion remain slice 2 — it corrects the premise that let those be deferred (a *sound* foundation), so slice 2 stays pure net-deletion.

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

Round-2 (post-review) done conditions:

- [ ] `reconstructGraph` / `graph()` never throws — duplicate-migration-hash is a represented `duplicateMigrationHash` violation; the `IntegrityViolation` completeness claim is true and pinned by a test.
- [ ] Exactly one `IntegrityViolation → PN-MIG-CHECK-*` mapper and one `→ 5001/5002` mapper; no kind mapped in two places; `readMigrationsDir` problems widen into the union rather than being re-derived.
- [ ] `migration check` runs a single integrity engine (`checkIntegrity()`); `COVERED_BY_LEGACY_CHECKS` + the hand-rolled app-space pass deleted; net deletion at the command.
- [ ] Every slice-1 consumer (`migrate`, `status`, `new`, `show`) loads the aggregate **once** and queries it — no post-construction `readMigrationsDir` / `loadMigrationPackages` re-read; integrity refusal precedes `--to`/`--from` resolution; `checkIntegrity()` is visible at each refusal site (no "gate" naming).
- [ ] `migration new` refuses only on the package-corruption subset (not unrelated cross-space drift), covered by a test.
- [ ] Integrity-engine and tolerant readers no longer swallow catastrophic I/O or engine faults silently.
- [ ] Self-edge user-facing wording (catalogue row, `why`/`fix`, glossary) is framed around data-invariant presence, not "no data operation".

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

### Dispatch 2: tolerant queryable aggregate + `checkIntegrity()` + intra-package engine re-point

- **Outcome:** `loadContractSpaceAggregate` has the tolerant signature `{ migrationsDir, deserializeContract, appContract }` (the live `appContract` is caller-supplied compiled PSL — always present; the app `headRef` is synthesised from `appContract.storage.storageHash`); `ContractSpaceMember` / `ContractSpaceAggregate` carry raw `packages` + `refs` + nullable `headRef` + lazy `graph()` / `contract()` + query methods (`listSpaces` / `hasSpace` / `space` / `spaces`), `app` + `extensions` retained; `checkIntegrity(opts?)` returns the full violation set (no bail), config/contract checks gated by the opts. The **intra-`@prisma-next/migration-tools` apply/verify engine** (planner / verifier / strategies / `project-schema-to-space` + their tests) is re-pointed onto the new member shape — this is atomic with the member-shape change, so it rides here, not in D3. Both D1 transitional shims removed. Unit tests cover construction tolerance, lazy facets, and the integrity query (incl. a multi-violation no-bail case).
- **Builds on:** D1's pure primitives + violation vocabulary.
- **Hands to:** The tolerant queryable model API + `checkIntegrity()` that consumers gate on; `@prisma-next/migration-tools` green on the new model.
- **Focus:** `aggregate/{types,loader}.ts` + integrity surface + the intra-package apply/verify engine. **Out:** the **CLI-package** consumers (`check` / `status` / `show` / `db verify` / the CLI aggregate-loader wrapper) → D3; integration tests → D4. CLI package may stay red until D3.

### Dispatch 3: re-point the CLI-package consumers onto the model + explicit gate

- **Outcome:** `migration check` (reports ALL violations at once), `db verify`, `migration status`, `migration show`, and the CLI aggregate-loader wrapper all construct the tolerant aggregate and gate via `checkIntegrity()`; `5001` / `5002` / `PN-MIG-CHECK-001..006` envelopes + `meta.violations[]` preserved. Workspace typecheck + package tests green.
- **Builds on:** D2's model API + `checkIntegrity()` (and the intra-package engine already on the new shape).
- **Hands to:** All current aggregate / load-throw consumers on the one model; behaviour preserved modulo self-edge tolerance + check-reports-all.
- **Focus:** the named CLI commands + the CLI wrapper. **Out:** `list` / `graph` / `log` (slice 2).

### Dispatch 4: cross-consumer integrity integration tests

- **Outcome:** A self-edge / hash-mismatch / orphan-space-dir project fixture is exercised across consumer classes — `show` tolerates-and-renders; `check` reports all three at once; apply / verify refuse with the structured violation. Any transient dispatch-internal scaffolding (e.g. checked wrappers) removed; net-deletion confirmed at re-pointed sites.
- **Builds on:** D3's re-pointed consumers.
- **Hands to:** Slice DoD met — the tolerant queryable model + integrity query, proven across consumer classes.
- **Focus:** integration test fixtures + assertions; final cleanup pass. **Out:** new behaviour.

### Round 2 (post-review re-scope) — deliver the foundation *correctly*

D1–D4 landed the tolerant queryable model and opened PR #626. Review ([`reviews/pr-626/`](../../slices/tolerant-queryable-aggregate/reviews/pr-626/)) — architect, principal-engineer, and the author's 15 inline notes — found the foundation **functionally** delivered but **structurally** under-delivered against the slice's own cross-cutting requirements: the error model never collapsed to one spine, "one model queried once" was not honoured at the consumers, integrity had a vocabulary hole (duplicate-migration-hash still throws from a facet advertised pure), and the consumer boundary hid `checkIntegrity()` behind "gate" naming.

This re-scope corrects the slice boundary's premise. The original rationale deferred `list`/`graph`/`log` to slice 2 because they "only add consumers to a sound foundation." The foundation was not sound; hardening it now keeps slice 2 a true pure-net-deletion follow-up instead of multiplying the debt across three more readers. **Slice 1 now means: deliver the foundation correctly.** Decisions settled with the operator (2026-05-30) and recorded in [`reviews/pr-626/code-review.md`](reviews/pr-626/code-review.md) § Operator review: (1) `migration new`'s gate narrows to the package-corruption subset; (2) add a `duplicateMigrationHash` violation kind and make `graph()` genuinely pure; (3) rename `requireContracts` → `checkContracts`; (4) re-export the integrity vocabulary from `/aggregate` and drop the standalone subpath; (5) move slice-1 consumers off `command-helpers.loadMigrationPackages` but keep the function (its deletion is slice 2, once `list`/`graph`/`log` move off it).

Hard chain: **D5 → D6 → D7 / D8 / D9**. D10 runs in parallel.

#### Dispatch 5: integrity vocabulary made whole + surface tightened

- **Outcome:** `reconstructGraph` (and `graph()`) is genuinely pure — a duplicate `migrationHash` is represented as a new `duplicateMigrationHash` `IntegrityViolation` kind, not a throw; the JSDoc "every structural problem the model can carry" is now true. The integrity-engine `catch {}` swallows (`headRefPresentInGraph`, the `loadAggregateIntegrityViolations` / `detectPackageCorruption` builders) narrow so a real engine fault surfaces loudly instead of degrading to "no violations". `requireContracts` → `checkContracts`. `IntegrityViolation` / `IntegrityQueryOptions` / `DeclaredExtensionEntry` are re-exported from `@prisma-next/migration-tools/aggregate`; the standalone `/integrity-violation` subpath is dropped (`package.json` + `tsdown.config.ts`). `meta.violations[]` emits the union's own `kind`s.
- **Builds on:** D1–D4's tolerant model + violation vocabulary.
- **Hands to:** A complete, self-contained integrity vocabulary with no hidden throw and no swallow — the spine D6 maps and D7/D8/D9 consume.
- **Focus:** `migration-graph.ts`, `integrity-violation.ts`, `check-integrity.ts`, `exports/aggregate.ts`, `package.json`, `tsdown.config.ts`; closes SD01, SD02, SD04, F04. **Out:** the consumer-facing mappers (D6) and call-site re-pointing (D7/D8/D9).

#### Dispatch 6: one mapper per catalogue

- **Outcome:** exactly one shared `IntegrityViolation → PN-MIG-CHECK-*` mapper and one `IntegrityViolation → 5001/5002` mapper, each reused by every consumer; `readMigrationsDir` problems **widen** into `IntegrityViolation` rather than being re-derived (`loadProblemToViolation` / `packageLoadProblemToViolation` collapse); the inline magic-string `{ pnCode, where, why, fix }` literals route through the shared mapper / constructor functions. The same violation kind is mapped in exactly one place per output catalogue.
- **Builds on:** D5's whole vocabulary + renamed opts.
- **Hands to:** A single mapping spine — the "so many error-shaped objects" lattice reduced to one translation per user-facing catalogue.
- **Focus:** `contract-space-aggregate-loader.ts`, `migration-check.ts` (mapper only), `check-integrity.ts`; closes SD11, F07, W4, W13, W15. **Out:** deleting the two-path `check` engine (D7).

#### Dispatch 7: `migration check` becomes a thin renderer over `checkIntegrity()`

- **Outcome:** `migration check` renders `aggregate.checkIntegrity({ declaredExtensions, checkContracts: true })` plus only the genuinely per-target snapshot checks that cannot be relocated (`005`/`006`); `COVERED_BY_LEGACY_CHECKS`, `isAppSpaceLegacyCovered`, the hand-rolled app-space `readMigrationsDir` pass, and the dedup are deleted. **Net deletion at the command.** `check` reports all violations across all spaces with no second engine.
- **Builds on:** D6's single mapper.
- **Hands to:** One integrity engine behind the flagship consumer; the net-deletion DoD met at `migration check`.
- **Focus:** `migration-check.ts`; closes §6, F12, F06, W3, W5. **Out:** other consumers (D8/D9).

#### Dispatch 8: gating consumers on one aggregate, loaded once, `checkIntegrity()` visible

- **Outcome:** `migrate`, `migration status`, and `migration new` each load the `ContractSpaceAggregate` **once** and query it — no `readMigrationsDir` / `loadMigrationPackages` re-read after construction; `detectPackageCorruption` is inverted to accept an already-loaded aggregate; the two domain steps are legible at each refusal site (load → `checkIntegrity(opts)`), with `gate` naming removed; the integrity refusal is hoisted **above** any `--to` / `--from` resolution; `migration new`'s gate narrows to the package-corruption subset and is covered by a test. These three move off `command-helpers.loadMigrationPackages` (the function stays for slice 2).
- **Builds on:** D5 (vocabulary/opts) + D6 (shared mapper).
- **Hands to:** Every gating consumer on one model, loaded once, refusing correctly and legibly.
- **Focus:** `migrate.ts`, `migration-status.ts`, `migration-new.ts`; closes F01, F02, F08, F13, SD12, W2, W6, W7, W9, W10, W11. **Out:** `migration show` (D9).

#### Dispatch 9: re-point `migration show` onto the aggregate

- **Outcome:** `migration show` loads the aggregate once and queries `space(id)` → `.packages` / `.graph()` / `.contract()` / `.refs`, replacing all three `readMigrationsDir` call sites; the "skip the aggregate, read the dir directly" deferral (which contradicted the slice spec) is removed; `problems` are no longer silently dropped — `show` renders regardless per the per-command policy, with partial-omission handled explicitly. Closes AC7's `show` gap.
- **Builds on:** D5 + D6 (and the load-once pattern established in D8).
- **Hands to:** `migration show` reading through the one model — the last slice-1 reader on the aggregate.
- **Focus:** `migration-show.ts`; closes F09, W8, AC7. **Out:** `list`/`graph`/`log` (slice 2).

#### Dispatch 10: correctness / vocabulary / test / doc tail

- **Outcome:** the tolerant head-ref / ref readers re-throw catastrophic I/O (`EACCES` / `EIO` / unknown codes) instead of swallowing it as `refUnreadable` (F11); recovery `fix` hints no longer point at `prisma-next migrate` for faults `migrate` now refuses (F10); the self-edge vocabulary is reframed around **data-invariant presence** — the `PN-MIG-CHECK-007` row, the `why`/`fix` strings, and the glossary stop saying "no data operation / applies nothing" (SD10/W1); the mongo `toSpaceMember` shim is built via `createContractSpaceMember`, deleting the `as unknown as ContractSpaceMember` cast and the dead `migrations` field (F03); a package-level test asserts `db verify`'s per-member verifier receives the resolved contract value, not the thunk (F05); the `io.test.ts` invalid-JSON test is renamed (CR); the duplicated `**Scope.**` heading + `PN-CHECK-005`/`PN-MIG-CHECK-005` spelling are fixed (SD08/SD09); cheap lexical polish (SD03/SD05/SD06/SD07) applied where it doesn't ripple.
- **Builds on:** D5 (so SD10 wording matches the kind set) — otherwise independent; runs in parallel with D7–D9.
- **Hands to:** The small-issue tail cleared; the cross-consumer matrix extended where a new behaviour (duplicate-hash representation, narrowed swallows) needs pinning.
- **Focus:** `loader.ts`, `contract-space-aggregate-loader.ts`, `migration-check.ts` (strings), the subsystem doc + glossary, `mongo-target/control-target.ts`, `db-verify` tests, `io.test.ts`; closes SD03, SD05–SD10, F03, F05, F10, F11. **Out:** structural changes (covered by D5–D9).
