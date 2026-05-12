# Summary

Bring the **Mongo family** to parity with the SQL family on contract spaces — the per-space planner / runner / verifier mechanism specified in [ADR 212 — Contract spaces](../../docs/architecture%20docs/adrs/ADR%20212%20-%20Contract%20spaces.md) and shipped on the SQL family under [TML-2397](https://linear.app/prisma-company/issue/TML-2397). After this work lands, a Mongo-side extension can declare a `ContractSpace<MongoContract<MongoStorage>>` and have its schema contributions planned, applied, verified, and pinned through the same machinery the SQL family uses today.

The cross-space atomicity model is the only architectural decision unique to Mongo: **per-space marker-level atomicity**, gated on post-apply `db verify`. Documented in [Subsystem 10 — MongoDB Family](../../docs/architecture%20docs/subsystems/10.%20MongoDB%20Family.md).

# Context

## At a glance

[ADR 212](../../docs/architecture%20docs/adrs/ADR%20212%20-%20Contract%20spaces.md) introduced contract spaces and the SQL family shipped them under [TML-2397](https://linear.app/prisma-company/issue/TML-2397). The canonical types — `ContractSpace<TContract>`, `ContractSpaceHeadRef`, `MigrationPackage` — live in `@prisma-next/framework-components/control` and are family-agnostic by construction. The framework-neutral helpers — loader, aggregate planner, aggregate verifier, `concatenateSpaceApplyInputs`, `emitContractSpaceArtefacts`, `assertDescriptorSelfConsistency`, `detectSpaceContractDrift`, `projectSchemaToSpace` — live in `@prisma-next/migration-tools` and are target-agnostic by design. The CLI's aggregate `loader → planner → applyAggregate` pipeline already routes through Mongo identically to SQL.

What's missing is the Mongo *family-side* participation in those pipelines:

- The Mongo descriptor surface has no `contractSpace?` field.
- The Mongo marker doc is single-document keyed by `_id: 'marker'` with no `space`.
- `MongoFamilyInstance.readMarker` throws if `space !== APP_SPACE_ID`.
- `mongoTargetDescriptor.executeAcrossSpaces` short-circuits to `MONGO_MULTI_SPACE_UNSUPPORTED` if `perSpaceOptions.length !== 1`.
- `projectSchemaToSpace` (the per-member projection used by the aggregate planner's synth strategy and the aggregate verifier's `schemaCheck`) duck-types `storage.tables`; Mongo's `MongoSchemaIR` is `collections`-keyed, so the projector falls through and Mongo aggregates would silently treat every other-member's collection as an orphan.
- The aggregate loader's disjointness extractor extracts table names; Mongo aggregates would silently disable disjointness checking.
- `emitContractSpaceArtefacts` writes `contract.json` and `refs/head.json` (target-agnostic) but the per-space `contract.d.ts` is family-aware and not yet wired for Mongo.

## Problem

A future Mongo-side extension that wants to contribute schema (collections, indexes, validators) has no honest seam. It can ship a runtime codec, but it cannot declare a `contractSpace`. The blast radius if we don't close this is the same as the cipherstash situation pre-ADR 212: extensions wedge schema into the user's database via runtime escape hatches and the verifier can't see what they did.

The asymmetry between SQL and Mongo is also a maintenance liability — every framework-neutral helper carries the assumption that Mongo participates as a single-member aggregate, and every test or doc that says "the contract-spaces mechanism" has to caveat "(SQL only for now)".

This work is a **port, not a redesign.** All the architectural decisions are already made and recorded in [ADR 212](../../docs/architecture%20docs/adrs/ADR%20212%20-%20Contract%20spaces.md). The only Mongo-specific call is the cross-space atomicity model, captured below and documented in [Subsystem 10 — MongoDB Family](../../docs/architecture%20docs/subsystems/10.%20MongoDB%20Family.md).

## Approach

### Cross-space atomicity model

**Per-space marker-level atomicity, gated on post-apply `db verify`. Resumable, not transactional.**

This is the single architectural decision unique to Mongo. [ADR 212](../../docs/architecture%20docs/adrs/ADR%20212%20-%20Contract%20spaces.md) specifies the SQL family's atomicity model: `executeAcrossSpaces` opens one outer transaction on the connection, calls `executeOnConnection` per space inside it, and a failure on any space rolls back every space's writes via the outer `ROLLBACK`. Mongo cannot offer that contract — see "Why not a session transaction" below — so the port replaces the *transactional* cross-space envelope with a *resumable* one that gives the same end-state (every space at its expected head or recoverable to it) without claiming an atomicity it cannot deliver.

The single-space Mongo runner already implements verify-gated marker atomicity at the per-space level: it introspects the database after applying ops, runs `verifyMongoSchema`, and only advances the marker (CAS `updateMarker` or `initMarker`) plus writes the ledger entry on `verifyResult.ok === true`. If verify fails the runner returns `SCHEMA_VERIFY_FAILED` and the marker stays at the prior hash. The multi-space port composes this per-space behaviour without an outer transaction:

- Each space iterates in cross-space order (extensions alphabetical, app last — the existing convention from `concatenateSpaceApplyInputs`).
- Each space applies its ops, introspects, projects the live schema to its slice via `projectSchemaToSpace`, verifies the projection against its contract, advances its own marker on pass.
- Space N failing leaves spaces 1..N−1 advanced and spaces N..M unattempted. The aggregate runner returns a `MultiSpaceRunnerFailure` carrying `failingSpace`. Re-running `db update` / `migration apply` reads each marker, finds spaces 1..N−1 already at-head (no-op skip), retries N onward — **resumable, not transactional.**

**Why not a session transaction.** Mongo cannot wrap most DDL operations (`createCollection`, `createIndex`, `collMod`, `setValidation`) in a session transaction at all. Even on replica-set deployments where transactions are available, DDL ops bypass them. We cannot offer cross-space rollback without restricting the design to data-transformation ops only — which is not what extensions need.

**Data-transformation carve-out.** Ops with `operationClass === 'data'` go through the regular query path (`adapter.lower → driver.execute`) and *can* in principle be wrapped in a session transaction on replica-set deployments. This is a per-space-internal property: it could provide intra-space atomicity for data ops in the future, not cross-space rollback. Out of scope for this work; recorded as a follow-up.

**Why not standalone Mongo support.** Standalone Mongo deployments lack session transactions entirely; the per-space marker-level atomicity is the strongest guarantee available across the deployment matrix we support. Replica-set users gain no cross-space property under this design — they may gain a future opt-in for per-space-internal data-op atomicity.

### Marker doc shape

The marker collection (`_prisma_migrations`) gains a `space`-keyed shape:

- Pre-port: single doc, `{_id: 'marker', storageHash, profileHash, ..., invariants?}`.
- Post-port: one doc per space, `{_id: <spaceId>, space: <spaceId>, storageHash, profileHash, ..., invariants?}` (the `_id` and `space` carry the same value; keeping both makes the schema readable and lets future code key purely on `space` if `_id` ever needs to change shape).

**Idempotent legacy upgrade**: detect a doc with `_id: 'marker'` (and no `space` field) on first marker access; rewrite it in-place to `{_id: 'app', space: 'app', ...}`. Mirrors the SQL family's `LEGACY_MARKER_SHAPE` precheck pattern from [TML-2397 M1-cleanup](../extension-contract-spaces/plan.md#milestone-1-cleanup-m1-design-review-remediation--satisfied-head-ac2157d72) (T-cleanup.4 — non-mutating detection followed by upgrade write). Three-state idempotency tests cover: fresh DB / legacy doc / already-upgraded.

Ledger entries gain a `space` field too. Keying by `(space, edgeId)` — the same edgeId may legitimately recur across spaces for a synthetic ∅→head edge.

### Descriptor surface

`MongoControlExtensionDescriptor` gains:

```ts
import type { ContractSpace } from '@prisma-next/framework-components/control';
import type { MongoContract, MongoStorage } from '@prisma-next/mongo-contract';

export interface MongoControlExtensionDescriptor<TTargetId extends string>
  extends ControlExtensionDescriptor<'mongo', TTargetId> {
  readonly contractSpace?: ContractSpace<MongoContract<MongoStorage>>;
}
```

`MongoFamilyInstance` integrates `assertDescriptorSelfConsistency` over each extension's `(contractSpace.contractJson, contractSpace.headRef.hash)`, mirroring the SQL family. Stale descriptor head refs fail fast at family-instance construction.

### Multi-space runner

`MongoMigrationRunner.execute` already takes a `MigrationPlan` whose `spaceId` is in scope. The port:

- Threads `space` through `MarkerOperations.readMarker(space)` / `initMarker(space, ...)` / `updateMarker(space, expectedFrom, ...)` / `writeLedgerEntry(space, ...)`.
- Replaces the implicit "marker" id with the plan's `spaceId`.

`mongoTargetDescriptor.executeAcrossSpaces`:

- Drops the `length !== 1` rejection.
- Iterates `perSpaceOptions` in declaration order (the caller pre-sorts via `concatenateSpaceApplyInputs`).
- Per-space: runner.execute → on `ok`, carry the success forward; on `notOk`, return `MultiSpaceRunnerFailure { ...failure, failingSpace: thisSpace }` immediately. Earlier-advanced spaces' marker writes are *not* rolled back.
- On full success, returns the cross-space envelope `{ perSpaceResults: [{ space, value }, ...] }`.

**Rehydrated ops carry no codec dependency.** The Mongo runner consumes ops re-read from disk (`migrations/<space-id>/<dirName>/ops.json`) and must not look up a codec instance at execute time. Every value an op needs at execute time — connection-bound primitives, JSON-Schema fragments, index specs, op bodies, parameter values — is serialised into the op record at plan/emit time. This mirrors the SQL family's contract today and is a hard property to preserve through the port: a stack with no codec runtime instances loaded must still be able to execute a previously-emitted Mongo migration plan against a live database.

### Schema projection generalisation

`projectSchemaToSpace` (in `@prisma-next/migration-tools/aggregate`) currently duck-types `storage.tables: Record<string, ...>` and `schema.tables`. Two structural shapes need projecting in this codebase:

- SQL: `tables: Record<string, ...>` on both contract storage and SqlSchemaIR.
- Mongo: `collections: Record<string, ...>` on `MongoStorage`, and `collections: ReadonlyArray<MongoSchemaCollection>` on `MongoSchemaIR` (note: array, not record).

Two viable shapes — both end up in the spec as acceptable; choice is a low-stakes implementation call:

- **Option A (extractor callbacks):** caller passes `extractClaimedNames(contract): readonly string[]` and `pruneSchema(schema, ownedByOthers): unknown`. Migration-tools provides default extractors for SQL and Mongo; the aggregate planner / verifier wire the right pair via the family instance.
- **Option B (duck-type both shapes in one body):** `projectSchemaToSpace` learns the union; falls through unchanged for unrecognised shapes.

Both preserve the duck-typing fall-through guarantee. Option A is more extensible (a future family wires its own extractor); Option B is fewer moving parts. Implementer's call at the round.

The same generalisation applies to the loader's `extractTableNames` disjointness check (must extract Mongo collection names for Mongo aggregates).

### On-disk pinned artefacts

`emitContractSpaceArtefacts` already writes `contract.json` (canonical-JSON, target-agnostic) and `refs/head.json` (target-agnostic). The remaining family-aware piece is `contract.d.ts`:

- SQL family wires its renderer through the CLI's `runContractSpaceExtensionMigrationsPass` / equivalent — the caller passes a rendered string in.
- Mongo's `.d.ts` renderer lives in `@prisma-next/family-mongo` (or wherever its public types-emitter sits today; reconnaissance during implementation).

The port: wire Mongo's renderer into the same emit pass the SQL family uses. Byte-equivalence is preserved — the contract.d.ts file is canonical TypeScript output of a deterministic renderer; rerunning is a no-op.

The aggregate loader's pinned-contract reads (`readContractSpaceContract`, `readContractSpaceHeadRef`, `listContractSpaceDirectories`) are already target-agnostic and consume the JSON files only.

### Synthetic Mongo extension fixture

Mirror the SQL family's `test/integration/test/contract-space-fixture/`:

- A Mongo descriptor exposing `contractSpace`: one collection (`feature_flags` or similar), one index, a JSON-Schema validator, baseline migration, head ref.
- Drives the e2e test plan: `migration plan` against an aggregate including this fixture → produces app-space + extension-space migration directories → `migration apply` → marker collection has rows for `app` and `<fixtureId>` with the expected hashes → `db verify` passes.

### Subsystem doc 10 update

`docs/architecture docs/subsystems/10. MongoDB Family.md` gains a "Contract spaces" subsection covering:

- The mechanism in one paragraph (cross-reference Subsystem 7 for the framework-neutral pieces).
- The Mongo-specific atomicity model verbatim, with the data-transformation carve-out called out as a deferred refinement.
- Pointer to TML-2408's PR for the implementation history.

Subsystem 7 (Migration System) gains a one-liner cross-reference: "Mongo's per-space atomicity model is documented in Subsystem 10 — § Contract spaces."

# Requirements

## Functional Requirements

- **FR1.** `MongoControlExtensionDescriptor` carries an optional `contractSpace?: ContractSpace<MongoContract<MongoStorage>>` field. Mirrors `SqlControlExtensionDescriptor` shape.
- **FR2.** The Mongo marker collection's documents are keyed by `(_id: <spaceId>, space: <spaceId>)`. The collection holds zero, one, or N documents — one per space that has been applied at least once.
- **FR3.** The Mongo marker readers / writers (`readMarker`, `readAllMarkers`, `initMarker`, `updateMarker`, `writeLedgerEntry`) take a `space` parameter and operate on that space's row only.
- **FR4.** Pre-existing single-doc markers (`{_id: 'marker', ...}`) are upgraded in-place to `{_id: 'app', space: 'app', ...}` on first access. Detection is non-mutating; upgrade writes are idempotent. The framework never blocks on a legacy marker — the upgrade is automatic.
- **FR5.** `MongoFamilyInstance.readMarker(space)` operates on any space, not just app-space. `readAllMarkers` returns the full multi-space marker map.
- **FR6.** `MongoFamilyInstance` runs `assertDescriptorSelfConsistency` over each extension's `contractSpace` at family-instance construction. Stale descriptor head refs fail fast.
- **FR7.** `mongoTargetDescriptor.executeAcrossSpaces` accepts any number of `perSpaceOptions` (≥ 1) and iterates them in caller-supplied order. Per-space failure short-circuits the aggregate; the response carries `failingSpace`.
- **FR8.** Each space's marker advance is gated on post-apply `verifyMongoSchema` against the live database, projected to that space's slice via `projectSchemaToSpace` (or the generalised equivalent). Verify failure leaves the marker at its prior hash.
- **FR9.** Cross-space failure leaves earlier-advanced spaces' markers in place. Re-running `db update` / `migration apply` resumes from the per-space markers.
- **FR10.** `projectSchemaToSpace` supports Mongo's `collections`-keyed contract storage and Mongo's array-shaped `MongoSchemaIR.collections` (or the loader / planner / verifier wires use a Mongo-specific extractor with the same observable behaviour).
- **FR11.** The aggregate loader's disjointness check extracts collection names from Mongo contract members, with the same observable behaviour as the SQL `tables` extractor.
- **FR12.** `emitContractSpaceArtefacts` writes per-extension Mongo `contract.d.ts` files using the Mongo target's existing `.d.ts` renderer, byte-equivalent on reruns.
- **FR13.** A synthetic Mongo extension fixture exercises the full path end-to-end: declare → plan → apply → verify, with multi-space marker rows and per-space schema projections.

## Non-Functional Requirements

- **NFR1.** No user-facing semantic change for users with no Mongo-side contract-space extensions. Existing single-space Mongo apps continue to behave identically; the marker upgrade is silent.
- **NFR2.** The atomicity model is publicly documented in `docs/architecture docs/subsystems/10. MongoDB Family.md` (per-space marker-level, gated on post-apply verify, resumable, no cross-space rollback). Subsystem 7 cross-references it.
- **NFR3.** No new external dependencies; no new ADR (the decision lives in the subsystem doc — small enough to live there, and it's a Mongo-only refinement of the contract-spaces architecture established in TML-2397).
- **NFR4.** Validation gates (`pnpm typecheck`, `pnpm test:packages`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm lint:deps`, `pnpm build`) are green at every commit on the branch.
- **NFR5.** Rehydrated migration ops MUST NOT require instantiated codecs at execute time. Everything the runner needs to execute an op is serialised into the op record on disk. A stack instantiated without any codec runtimes (the typical migration-only deployment posture) must still be able to run a previously-emitted Mongo plan to completion. The port preserves this property and is exercised by an integration test that runs a Mongo aggregate apply with a stack containing no codec runtime instances.

## Non-goals

- **Codec lifecycle hooks for Mongo.** The hook contract ([ADR 213](../../docs/architecture%20docs/adrs/ADR%20213%20-%20Codec%20lifecycle%20hooks.md)) is target-neutral, but wiring it into the Mongo planner needs a concrete consumer to design against. Deferred until a Mongo extension materialises with codec-driven schema needs. NFR5 still applies: any future Mongo codec hook must serialise everything its emitted ops need into the op record so rehydrated ops carry no codec dependency at execute time.
- **Cross-space transaction support on replica-set deployments.** Even where transactions are available, Mongo DDL bypasses them. Cross-space rollback is not architecturally available; recorded in the subsystem doc rather than left as a TODO.
- **Per-space data-op session transactions.** Could provide intra-space atomicity for `operationClass === 'data'` ops on replica sets. Recorded as a follow-up; no consumer requesting it.
- **TML-2397 close-out tasks** (parent project's `projects/extension-contract-spaces/` removal). Independent lifecycle.

# Acceptance Criteria

- [ ] **AC1** (FR1, FR6). `MongoControlExtensionDescriptor` accepts a `contractSpace` field, and stale `headRef.hash` values fail at `createMongoFamilyInstance` time with the existing `MIGRATION.DESCRIPTOR_HEAD_HASH_MISMATCH` error code.
- [ ] **AC2** (FR2, FR3, FR4). On a fresh DB: marker writes produce `{_id: 'app', space: 'app', ...}`. On a DB with a legacy `{_id: 'marker', ...}` doc: first marker access non-mutatingly detects the legacy shape and (idempotently) rewrites it to `{_id: 'app', space: 'app', ...}`. Three-state idempotency test (fresh / legacy / already-upgraded) green.
- [ ] **AC3** (FR5, FR7). `MongoFamilyInstance.readMarker` accepts any space id and returns that space's marker (or `null`). `mongoTargetDescriptor.executeAcrossSpaces` accepts ≥ 2 `perSpaceOptions` and iterates them.
- [ ] **AC4** (FR8, FR9). With a synthetic two-space aggregate where the extension's plan succeeds but the app's plan triggers a `verifyMongoSchema` failure: extension marker is advanced, app marker stays at its prior hash, the response carries `failingSpace: 'app'`. Re-running `executeAcrossSpaces` with the corrected app plan applies only the app space (extension is at-head, no-op skip) and the run succeeds.
- [ ] **AC5** (FR10, FR11). An aggregate with one Mongo app contract + one Mongo extension contract: disjointness check correctly identifies a collision when both contracts declare the same collection. `projectSchemaToSpace` (or its Mongo extractor) correctly removes other-member collections from each per-member projection.
- [ ] **AC6** (FR12). After `migration apply` against the synthetic fixture aggregate, `migrations/<fixtureId>/contract.json`, `migrations/<fixtureId>/contract.d.ts`, `migrations/<fixtureId>/refs/head.json` exist with byte-equivalent content to the descriptor's `contractSpace` values; rerunning is a no-op (same bytes).
- [ ] **AC7** (FR13). End-to-end test: synthetic Mongo extension fixture + an app schema → `migration plan` produces app-space + extension-space migration directories → `migration apply` advances both markers → `db verify` (strict mode) passes → introducing a hand-edit to a fixture-owned collection causes `db verify` to fail with the expected per-space remediation hint.
- [ ] **AC8** (NFR1). With no Mongo-side contract-space extension declared (today's posture), all existing Mongo integration / e2e tests pass unchanged.
- [ ] **AC9** (NFR2). `docs/architecture docs/subsystems/10. MongoDB Family.md` carries a "Contract spaces" subsection covering the mechanism summary + the per-space atomicity model + the data-transformation carve-out as a follow-up. Subsystem 7 has the cross-reference.
- [ ] **AC10** (NFR4). All validation gates green at PR merge time.
- [ ] **AC11** (NFR5). Integration test: instantiate a `MongoFamilyInstance` whose stack carries no codec runtime instances, load a previously-emitted aggregate (app + extension), and run `executeAcrossSpaces` to completion against a live `mongodb-memory-server`. Both markers advance; no codec lookup happens during execute.

# Other Considerations

## Security

The marker collection is already owned by the database role with DDL privileges; per-space markers are the same trust shape as the SQL family's per-space marker rows. No new boundary.

## Cost

Marker storage grows from one doc to N docs per loaded space — negligible. Migration JSON sizes grow per emit by per-space op bodies; same shape as the SQL family.

## Observability

Per-space marker docs give operators direct visibility into which space is at which hash. Existing Mongo tests + the e2e fixture test cover the apply / verify paths.

## Data Protection

No PII or sensitive data crosses any new boundary.

## Analytics

Not applicable.

# References

- [ADR 212 — Contract spaces](../../docs/architecture%20docs/adrs/ADR%20212%20-%20Contract%20spaces.md) — the canonical design this work extends to Mongo. Defines `ContractSpace<TContract>` (family-agnostic, in `framework-components/control`), the per-space planner / runner / verifier mechanism, and the SQL family's transactional cross-space apply that this port intentionally diverges from.
- [ADR 213 — Codec lifecycle hooks](../../docs/architecture%20docs/adrs/ADR%20213%20-%20Codec%20lifecycle%20hooks.md) — codec-driven schema contributions; out of scope for this port but defines the property NFR5 protects (rehydrated ops carry no codec dependency).
- [TML-2408 Linear issue](https://linear.app/prisma-company/issue/TML-2408/port-contract-spaces-to-the-mongo-family) — this work.
- [Subsystem 10 — MongoDB Family](../../docs/architecture%20docs/subsystems/10.%20MongoDB%20Family.md) — atomicity model lives here.
- [Subsystem 7 — Migration System](../../docs/architecture%20docs/subsystems/7.%20Migration%20System.md) — framework-neutral mechanism description; gains a Mongo-atomicity cross-reference.
- [ADR 021 — Contract Marker Storage](../../docs/architecture%20docs/adrs/ADR%20021%20-%20Contract%20Marker%20Storage.md) — Mongo marker shape (single doc with optional `invariants`); this work extends it to multi-doc keyed by `space`.

# Open Questions

1. **Schema-prune generalisation: extractor callbacks vs union duck-typing.** Both meet FR10/FR11. Decide at implementation time based on which reads cleaner; capture the choice in the PR description.
2. **Mongo `.d.ts` renderer location.** The Mongo target's existing renderer needs to be exposed through whatever surface `emitContractSpaceArtefacts` consumes for SQL today. Reconnaissance during implementation; no architectural ambiguity.
3. **Subsystem doc placement of the atomicity rule.** Inline in subsystem 10 (current plan), or a small ADR referenced from there? Default: inline. Promote to ADR if the discussion in PR review surfaces sufficient cross-cutting concerns.
