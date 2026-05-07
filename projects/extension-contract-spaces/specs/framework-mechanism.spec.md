# Summary

Implementation contract for the **contract-space mechanism** in the framework: per-space planner / runner / verifier, the `contractSpace` extension-descriptor field, the marker schema migration, the pinned per-space artefact layout, codec lifecycle hooks, and the per-space `db init` / `db update` flows. Drives [Milestones M1 + M2](../plan.md#milestones) of the project plan. Reads on top of [the project spec](../spec.md) — this document captures API shapes, file-system contracts, and edge-case handling that don't belong in the spec.

**Parent project spec:** [`projects/extension-contract-spaces/spec.md`](../spec.md) — design rationale, FRs, NFRs, ACs.

# Description

The project spec settles the design. This sub-spec locks down the implementation contracts a maker needs before touching the codebase:

- The exact TS types added to `SqlControlExtensionDescriptor` and `CodecControlHooks`.
- The marker-schema migration SQL.
- The on-disk file paths the framework reads / writes per space.
- The canonicalization rules pinned files use to be byte-equivalent across machines.
- The integration points for codec hooks in the emitter and for per-space pathfinding in `db init` / `db update`.

Implementation order follows the plan's task ordering ([T1.1…T1.10, T2.1…T2.5](../plan.md#milestones)). Each task in the plan references one or more sections here.

# Requirements

## 1. Extension descriptor: `contractSpace` field

Add an optional `contractSpace` field to `SqlControlExtensionDescriptor`:

```ts
// packages/2-sql/9-family/src/core/migrations/types.ts
export interface ExtensionContractRef {
  readonly hash: string;
  readonly invariants: readonly string[];
}

export interface ExtensionContractSpace {
  readonly contractJson: ContractJson;                     // canonical JSON value, in-memory
  readonly migrations: readonly MigrationPackage<unknown>[]; // each = manifest + ops + contract.json snapshot
  readonly headRef: ExtensionContractRef;
}

export interface SqlControlExtensionDescriptor<TTargetId extends string>
  extends ControlExtensionDescriptor<'sql', TTargetId> {
  // existing fields …
  readonly contractSpace?: ExtensionContractSpace;
}
```

Behaviour:

- An extension descriptor without `contractSpace` is treated as a non-schema extension (codec-only, query-ops-only). Today's behaviour preserved.
- A descriptor with `contractSpace` is loaded into the per-space pipeline at authoring time only (see § 3).
- `MigrationPackage` is the existing shape from `@prisma-next/framework-components/control` (`{ manifest, ops, contractSnapshot }`). Reused as-is.

## 2. Marker schema migration (T1.1)

Promote `prisma_contract.marker` from a single-row table to N-row, keyed by `space`:

```sql
-- Idempotent (uses IF [NOT] EXISTS guards). Safe to re-run.
ALTER TABLE prisma_contract.marker
  ADD COLUMN IF NOT EXISTS space text NOT NULL DEFAULT 'app';

UPDATE prisma_contract.marker
  SET space = 'app'
  WHERE space IS NULL OR space = '';

-- Drop the old single-row PK (today's `id` constant) and re-key by space.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'marker_pkey'
  ) THEN
    ALTER TABLE prisma_contract.marker DROP CONSTRAINT marker_pkey;
  END IF;
END$$;

ALTER TABLE prisma_contract.marker
  ADD CONSTRAINT marker_pkey PRIMARY KEY (space);

-- The old `id` column is no longer load-bearing. Drop it for cleanliness.
ALTER TABLE prisma_contract.marker
  DROP COLUMN IF EXISTS id;
```

Open implementation question: where does this run? Two options:

- **(A) Framework-internal migration** — a hard-coded migration applied before any user / extension migrations on every framework boot, idempotent on already-migrated databases.
- **(B) Inline in `db init` / `db update`** — the verifier detects pre-migration shape and applies the change as part of the same transaction as the first user migration.

Recommendation: **(A)** — keeps the marker promotion outside of any user-initiated transaction; runs deterministically on every framework start. The per-space verifier (§ 4) can then assume the new shape unconditionally.

Validation: shadow-DB preflight per ADR 029. Multi-process concurrency: rely on Postgres's transactional DDL — concurrent runs serialize on the table lock.

## 3. Per-space planner (T1.3) and emitter wiring (T1.6, T1.7, T1.8)

The planner gains a per-space loop:

```ts
interface SpacePlanInput {
  readonly spaceId: string;             // 'app' | extension space id
  readonly priorContract: ContractJson | null;  // null = first emit for this space
  readonly newContract: ContractJson;
}

interface SpacePlanOutput {
  readonly spaceId: string;
  readonly migrationPackages: readonly MigrationPackage<unknown>[];  // 0 or more
}

function planAllSpaces(inputs: readonly SpacePlanInput[]): readonly SpacePlanOutput[];
```

For app-space: `priorContract` comes from `<projectRoot>/migrations/<latest>/contract.json` (today's behaviour); `newContract` comes from the just-emitted root `<projectRoot>/contract.json`.

For each loaded extension space: `priorContract` comes from `<projectRoot>/migrations/<space-id>/contract.json` (pinned mirror) if it exists, else `null`; `newContract` comes from the descriptor's `contractSpace.contractJson`. When prior == new (byte-equal after canonicalization), emit zero migration packages and skip pinned-file write (no-op).

**Layout convention (γ).** The emitter writes:

| Artefact | Path |
|---|---|
| App-space migration directory | `<projectRoot>/migrations/<migration-name>/` |
| App-space current contract | `<projectRoot>/contract.json` (today; unchanged) |
| Per-extension migration directory | `<projectRoot>/migrations/<space-id>/<migration-name>/` |
| Per-extension current contract (pinned) | `<projectRoot>/migrations/<space-id>/contract.json` |
| Per-extension current typings (pinned) | `<projectRoot>/migrations/<space-id>/contract.d.ts` |
| Per-extension head ref (pinned) | `<projectRoot>/migrations/<space-id>/refs/head.json` |

Migration names inside a per-extension subdirectory **preserve the names the extension author chose** — no renaming. The per-extension subdirectory must be a valid filesystem name; space identifiers are constrained to `[a-z][a-z0-9_-]{0,63}`.

**Emission helper (T1.7).** A shared helper takes an in-memory `MigrationPackage` and writes `manifest.json`, `ops.json`, and `contract.json` to a target directory. Already exists for app-space; extend (or wrap) to accept an arbitrary target directory.

**Pinned artefact emission (T1.8).** A new helper invoked once per loaded extension space at the end of `migrate`:

```ts
function emitPinnedSpaceArtefacts(
  spaceId: string,
  contractSpace: ExtensionContractSpace,
  projectRoot: string,
): Promise<void>;
```

Writes `contract.json`, `contract.d.ts`, `refs/head.json` under `<projectRoot>/migrations/<spaceId>/`. Always-overwrite (the framework owns these files). Canonicalization rules:

- `contract.json`: reuse the existing canonical-JSON serializer used for hashing (so byte-equivalence with the descriptor's `contractJson` holds across runs).
- `contract.d.ts`: reuse the existing `.d.ts` emitter from the contract package.
- `refs/head.json`: canonical JSON of `{ "hash": ref.hash, "invariants": [...sorted] }` — invariants sorted alphabetically for determinism.

**Drift detection (T1.9).** Before computing `priorContract` for a space:

- Read pinned `<projectRoot>/migrations/<space-id>/contract.json` (if exists) → call this `pinnedContract`.
- Compute `descriptorHash = hash(descriptor.contractSpace.contractJson)` and `pinnedHash = hash(pinnedContract)`.
- If `descriptorHash !== pinnedHash` and the user did not bump (i.e. they ran `migrate` without intending to advance the extension): surface a non-fatal warning naming the extension and the diff direction. The migration emit proceeds normally — the warning is informational. (`migrate` is the canonical way to materialise extension bumps; the warning just confirms the bump is being captured this run.)

## 4. Per-space runner (T1.4) and verifier (T1.5)

**Runner.** Reads only the user's repo. For each loaded space:

```ts
interface SpaceApplyInput {
  readonly spaceId: string;
  readonly migrationDirectory: string;            // either projectRoot/migrations or .../<space-id>
  readonly currentMarkerHash: string | null;      // null = no marker row yet
  readonly currentMarkerInvariants: readonly string[];
  readonly path: readonly MigrationPlanOperation<unknown>[];   // from per-space planner / findPathWithDecision
}
```

Cross-space ordering: all extension-space inputs concatenated first (in alphabetical-by-spaceId order), app-space input last. Single transaction wraps the entire concatenation. After successful apply:

- Each space's marker row is created (if absent) or updated (if present) with the new `(hash, invariants)`.
- The `space` column carries the space id.

**Verifier.** Reads only the user's repo. Algorithm:

1. Discover loaded spaces from `extensionPacks` + `'app'`. Result: `loadedSpaces: ReadonlySet<string>`.
2. Read app-space `contract.json` from `<projectRoot>/contract.json`.
3. For each `extension space` in `loadedSpaces`:
   - Read pinned `<projectRoot>/migrations/<space-id>/contract.json`. Reject (FR6 case b) if missing — error message: `"Extension '<space-id>' is declared in extensionPacks but has not been emitted; run 'prisma-next migrate'"`.
4. Sort the `(spaceId, contract)` pairs alphabetically by `spaceId`. Aggregate to a single in-memory `expected schema`.
5. List `<projectRoot>/migrations/` subdirectories. For each directory `D`:
   - If `D` matches a migration-name pattern (timestamp-prefixed) — it's an app-space migration; skip.
   - Else, treat `D` as a space identifier. If `D` is not in `loadedSpaces`, reject (FR6 case c) — error: `"Orphan pinned directory 'migrations/<D>/' for an extension not in extensionPacks; remove the directory or re-add the extension"`.
6. Read all marker rows. For each row's `space`:
   - If `space` is not in `loadedSpaces`, reject (FR6 case a) — error: `"Orphan marker row for space '<space>' (no longer in extensionPacks); remediation: manually delete the row from prisma_contract.marker"`.
7. Compare each marker row's `(hash, invariants)` to the corresponding space's pinned contract hash + applied invariants. Reject mismatches per space with a strict-mode error.
8. Compare the aggregate expected schema against the live database (today's strict-mode logic, applied to the union).

Determinism: the alphabetical sort in (4) and the deterministic listing in (5) and (6) make the verifier's behaviour identical regardless of `extensionPacks` declaration order (NFR6).

## 5. Codec lifecycle hook (T2.1, T2.2)

Extend `CodecControlHooks`:

```ts
type FieldEvent = 'added' | 'dropped' | 'altered';

interface FieldEventContext {
  readonly priorTable?: TableIR;   // present for 'dropped' and 'altered'
  readonly newTable?: TableIR;     // present for 'added' and 'altered'
  readonly priorField?: FieldIR;   // present for 'dropped' and 'altered'
  readonly newField?: FieldIR;     // present for 'added' and 'altered'
}

interface CodecControlHooks<TTargetDetails = unknown> {
  // … existing hooks …
  readonly onFieldEvent?: (
    event: FieldEvent,
    ctx: FieldEventContext,
  ) => readonly MigrationPlanOperation<TTargetDetails>[];
}
```

Hook contract:

- **Synchronous.** The emitter must be able to assemble the migration JSON without awaiting hooks.
- **App-space scope only.** `priorTable` and `newTable` are scoped to the application's contract; the hook never sees extension-space IR. This is enforced by API shape — the hook signature has no parameter for cross-space context.
- **`'altered'` semantics.** Fires when a field exists in both `priorTable` and `newTable` and any field property has changed *except* `codecId`. Codec-id changes are a v1 non-goal (see project spec § Non-goals).
- **Return value.** `MigrationPlanOperation<TTargetDetails>[]`. Each op must carry its own `invariantId`. Returned ops are inlined into the app-space migration's `ops.json`, alongside the user's own structural ops.

**Wiring (T2.2).** In the app-space emitter's per-field diff loop:

- For each field added → run `onFieldEvent('added', { newTable, newField })` on the *new* field's codec. If hook absent, skip.
- For each field dropped → run `onFieldEvent('dropped', { priorTable, priorField })` on the *prior* field's codec.
- For each field present in both → if any property other than `codecId` differs, run `onFieldEvent('altered', { priorTable, newTable, priorField, newField })` on the new field's codec.
- Concatenate hook-returned ops into the app-space migration's `operations` array. Order: structural ops first, then codec-emitted ops grouped by triggering event (added → dropped → altered). Within a group, deterministic by `(tableName, fieldName)` then by op index.

## 6. `db init` / `db update` per-space (T2.3, T2.4)

Both flows reduce to: for each loaded space, run `findPathWithDecision(currentMarker, ref.hash, effectiveRequired)` per ADR 208, then apply the union of paths in the cross-space ordering convention.

```ts
interface SpacePathInput {
  readonly spaceId: string;
  readonly currentMarkerHash: string | null;
  readonly currentMarkerInvariants: readonly string[];
  readonly targetRef: ExtensionContractRef;   // for app-space: read from projectRoot
  readonly migrationGraph: MigrationGraph;     // for app-space: synthesized from contract IR if no migrations on disk
}

function planAllSpacePaths(inputs: readonly SpacePathInput[]): readonly SpaceApplyInput[];
```

For app-space: `targetRef` is read from `<projectRoot>/refs/head.json` (or computed inline from the current `contract.json` for greenfield); `migrationGraph` is loaded from `<projectRoot>/migrations/`. If no migrations on disk, the existing synthetic-edge model emits a `∅ → head` edge from the contract IR (today's `db init` behaviour).

For each extension space: `targetRef` is read from the pinned `<projectRoot>/migrations/<space-id>/refs/head.json`; `migrationGraph` is loaded from `<projectRoot>/migrations/<space-id>/`. **No descriptor access.** Synthesis is not used — extension spaces always walk their explicit graph.

`effectiveRequired = targetRef.invariants − currentMarkerInvariants` per ADR 208.

Concatenate all `SpaceApplyInput`s in the cross-space ordering convention and pass to the runner (§ 4).

## 7. Synthetic test extension (T1.10)

Location: `packages/3-extensions/test-contract-space/`. Mirrors `packages/3-extensions/pgvector/`'s package shape (`package.json`, `tsdown.config.ts`, `vitest.config.ts`, `tsconfig.json`, `src/`, `test/`, `README.md`).

`package.json`:

- `"name": "@prisma-next/extension-test-contract-space"`
- `"private": true`
- Same dependencies stanza as pgvector.

`src/exports/control.ts`: a descriptor exposing `contractSpace`:

- One composite type (e.g. `test_box` with two int fields) declared in `contract.json`.
- One baseline migration (op: `CREATE TYPE test_box AS (x int, y int)`; invariantId `test-contract-space:create-test_box-v1`).
- `headRef = { hash: <hash of contract.json>, invariants: ['test-contract-space:create-test_box-v1'] }`.

The test extension is consumed by integration tests in M1 to exercise:

- Per-space planner / runner / verifier.
- Pinned-artefact emission (TC-25, TC-29).
- Drift detection (TC-30).
- Orphan-marker / orphan-pinned-dir rejection (TC-22, TC-27, TC-28).
- No-descriptor verify (TC-26) via a fixture that mock-deletes the test-extension import resolution before invoking `dbInit` / `db apply`.

The extension is private (not published); existence in the workspace is solely to exercise the contract-space machinery against the same module-graph descriptor-import path a real extension would use.

# Acceptance Criteria

Implementation-level acceptance criteria for the framework mechanism:

- [ ] **AM1.** `SqlControlExtensionDescriptor.contractSpace` field present and typed per § 1. `pgvector` and `arktype-json` continue to typecheck (their descriptors don't set the field).
- [ ] **AM2.** Marker schema migration SQL applies idempotently against (a) a fresh `prisma_contract.marker` table, (b) a pre-migration single-row marker, (c) an already-migrated marker. Shadow-DB preflight passes.
- [ ] **AM3.** Per-space planner (`planAllSpaces`) returns the same shape regardless of `extensionPacks` declaration order (deterministic alphabetical sort).
- [ ] **AM4.** Per-space runner concatenates inputs as extensions-first-then-app-space and applies all in a single transaction. Mid-apply failure rolls back all spaces.
- [ ] **AM5.** Per-space verifier rejects all three orphan / missing cases (orphan marker, declared-but-unmigrated, orphan pinned dir) with the error messages specified in § 4.
- [ ] **AM6.** Pinned per-space artefacts (`contract.json`, `contract.d.ts`, `refs/head.json`) are written under `migrations/<space-id>/` with byte-equivalent canonical content. Re-running `migrate` against an unchanged descriptor produces no file-system change (idempotent).
- [ ] **AM7.** Drift detection: bumping a descriptor's `contractJson` without running `migrate` produces a clear warning on the next `migrate` invocation. Warning is non-fatal; emit proceeds.
- [ ] **AM8.** Codec hook fires for `'added'`, `'dropped'`, `'altered'` events with the contract specified in § 5. `'altered'` does *not* fire when only `codecId` changes.
- [ ] **AM9.** `db init` per-space: on a fresh database with the synthetic test extension, both spaces are initialised in a single transaction; marker rows for `app` and `test-contract-space` exist with expected hashes.
- [ ] **AM10.** `db update` per-space: bumping the synthetic test extension's `headRef` advances only its space's marker, leaving app-space untouched.
- [ ] **AM11.** With the synthetic test extension's package directory removed (`rm -rf packages/3-extensions/test-contract-space/dist`), `dbInit` and `db apply` succeed reading only the user's repo. `migrate` fails (descriptor not importable) — that's expected and informative.

# Other Considerations

## Performance (NFR5)

The per-space planner's outer loop is bounded by the number of loaded spaces (typically 1-5 for real apps, never more than ~20 even in monorepo composition). The verifier's aggregation pass is linear in total contract size. Both should be sub-millisecond overhead on top of today's single-space planner / verifier — well within the 5% budget.

## Implementation order (intra-M1)

The plan's task order (T1.1 → T1.10) is correct but not strictly enforced. A reasonable parallel decomposition:

- **Track A** (types + descriptor): T1.2 → T2.1.
- **Track B** (DB + marker): T1.1 → T1.5 (verifier).
- **Track C** (emission): T1.6 → T1.7 → T1.8 → T1.9.
- **Track D** (test extension): T1.10 (depends on Track A's types being in place).

Track B's marker migration (T1.1) blocks all integration tests; T1.1 first.

# References

- [Project spec](../spec.md) — design rationale.
- [Project plan](../plan.md) — tasks and validation gates.
- ADR 197 — Migration packages snapshot their own contract.
- ADR 208 — Invariant-aware migration routing.
- ADR 021 — Contract Marker Storage (modified by T1.1).
- ADR 029 — Shadow-DB preflight (used by T1.1).
- `packages/3-extensions/pgvector/` — reference shape for `packages/3-extensions/test-contract-space/`.

# Open Questions

1. **Marker migration mechanism.** § 2 recommends (A) framework-internal migration; confirm during T1.1 implementation. If (B) is chosen, document why and update the verifier to handle pre-migration marker shape.
2. **Drift detection severity.** § 3 specifies the drift warning as non-fatal informational. Should it be opt-in escalatable to error (e.g. `--strict-drift` flag)? Defer until users report a need.
3. **Pinned `contract.d.ts` regeneration.** The `.d.ts` for an extension is derived from its `contractJson` via the existing `.d.ts` emitter. Confirm the emitter is target-agnostic (or has a sensible default target) so the framework can run it for any extension space without per-extension target wiring. If not, fall back to `// @ts-nocheck` placeholder and surface as a follow-up.
