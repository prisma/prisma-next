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

Add an optional `contractSpace` field to `SqlControlExtensionDescriptor`. The shape that landed in T1.2 (`5733d8e18`):

```ts
// packages/2-sql/9-family/src/core/migrations/types.ts
import type { Contract } from '@prisma-next/contract/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { MigrationMetadata, MigrationOps } from '@prisma-next/migration-tools/package';

export interface ExtensionContractRef {
  readonly hash: string;
  readonly invariants: readonly string[];
}

export interface ExtensionMigrationPackage {
  readonly dirName: string;            // emit-time directory name; preserved from the extension author
  readonly metadata: MigrationMetadata; // ADR 197 metadata; carries `toContract` snapshot
  readonly ops: MigrationOps;
}

export interface ExtensionContractSpace {
  readonly contractJson: Contract<SqlStorage>;                  // typed in-memory contract
  readonly migrations: readonly ExtensionMigrationPackage[];
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

Notes on the resolved shape (resolved during T1.2 implementation; supersedes earlier draft text in this section):

- **`ExtensionMigrationPackage` is a new in-memory type**, distinct from `@prisma-next/migration-tools/package`'s on-disk `MigrationPackage` (`{ dirName, dirPath, metadata, ops }`). The on-disk type carries `dirPath` because it is post-emission; the in-memory descriptor type omits `dirPath` because at descriptor-construction time the package has not been emitted to a user repo yet. The framework's emitter (T1.7) materializes `ExtensionMigrationPackage` to disk and constructs the corresponding on-disk `MigrationPackage` lazily.
- **`contractJson` is typed as `Contract<SqlStorage>`**, not a loose JSON value. The descriptor lives in the SQL family and the typed shape is more useful at composition time. Serialization to JSON for hashing / on-disk emission is the framework's job (already implemented for app-space contracts), not the descriptor author's.
- **No `contractSnapshot` field on `ExtensionContractSpace`.** Per ADR 197, each migration package's `metadata.toContract` *is* the snapshot; there's no separate snapshot field.

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

Validation: dedicated three-state idempotency tests (fresh / legacy single-row / already-migrated) for both Postgres and SQLite drivers. ADR 029's shadow-DB preflight covers user-DDL paths via the migration runner; the marker promotion runs in `ensureControlTables`, which has always been outside that scope (the original `ensureMarkerTableStatement` and `ensureLedgerTableStatement` were applied directly pre-T1.1). Idempotency tests are stronger evidence than shadow-on-empty would be — they exercise the actual transition states. Multi-process concurrency: rely on Postgres's transactional DDL — concurrent runs serialize on the table lock; SQLite uses `BEGIN EXCLUSIVE`.

## 3. Per-space planner (T1.3) and emitter wiring (T1.6, T1.7, T1.8)

**Helper location.** The producer-side helpers — `planAllSpaces`, the layout convention, and `writeExtensionMigrationPackage` — live in `@prisma-next/migration-tools` (`1-framework`), not in the SQL family. The contract-space concept is target-agnostic per project spec FRs 3-6; placing the helpers in the framework layer lets Mongo (and any future target) reuse them. `pnpm lint:deps` validates that the framework layer carries no target-* references. The SQL family wires them into its CLI / emitter at the consumption site.

The planner gains a per-space loop. The shipped `planAllSpaces` shape is **generic over contract and package types**:

```ts
// @prisma-next/migration-tools/exports/spaces
interface SpacePlanInput<TContract, TPackage> {
  readonly spaceId: string;             // 'app' | extension space id
  readonly priorContract: TContract | null;  // null = first emit for this space
  readonly newContract: TContract;
  // … plus whatever per-space context the family planner needs
}

interface SpacePlanOutput<TPackage> {
  readonly spaceId: string;
  readonly migrationPackages: readonly TPackage[];  // 0 or more
}

function planAllSpaces<TContract, TPackage>(
  inputs: readonly SpacePlanInput<TContract, TPackage>[],
  planSpace: (input: SpacePlanInput<TContract, TPackage>) => SpacePlanOutput<TPackage>,
): readonly SpacePlanOutput<TPackage>[];
```

`planAllSpaces` itself never inspects either type — it sorts inputs alphabetically by `spaceId` (deterministic ordering, AM3), rejects duplicate ids with `MIGRATION.DUPLICATE_SPACE_ID` *before* any callback runs (atomicity), and delegates the per-space planning decision to the family.

The SQL family's call site is the canonical instantiation:

```ts
// somewhere in @prisma-next/family-sql (consumption site, lands in a later round)
planAllSpaces<ContractJson, MigrationPackage<unknown>>(
  inputs,
  (input) => sqlPlanSpace(input),
);
```

A Mongo-family call site would instantiate with `<MongoContractJson, MongoMigrationPackage<unknown>>` against `mongoPlanSpace`; the helper does not need to change.

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

**Emission helper (T1.7).** Shipped as `writeExtensionMigrationPackage(targetDir, pkg)` in `@prisma-next/migration-tools/exports/io`. Takes an in-memory `ExtensionMigrationPackage` (per § 1's resolved shape: `{ dirName, metadata, ops }`) and writes `migration.json`, `ops.json`, and a canonical-JSON `contract.json` snapshot under `<targetDir>/<pkg.dirName>/`. The `migration.json` + `ops.json` writes delegate to the existing app-space `writeMigrationPackage` for byte-parity; the `contract.json` snapshot reuses the existing `canonicalizeJson` helper. Re-emitting the same package across runs / machines produces byte-identical files.

**Layout helper (T1.6).** Shipped as `spaceMigrationDirectory(projectMigrationsDir, spaceId)` in `@prisma-next/migration-tools/exports/spaces`. App-space passes through unchanged (no subdirectory); extension spaces resolve to `<projectMigrationsDir>/<spaceId>`. Validates `spaceId` against `[a-z][a-z0-9_-]{0,63}` and throws `MIGRATION.INVALID_SPACE_ID` for filesystem-unsafe names.

**Pinned artefact emission (T1.8).** Shipped as `emitPinnedSpaceArtefacts(projectMigrationsDir, spaceId, inputs)` in `@prisma-next/migration-tools/exports/spaces`. Framework-neutral primitives signature (same target-agnosticism rationale as R3's generic `planAllSpaces`):

```ts
// @prisma-next/migration-tools/exports/spaces
function emitPinnedSpaceArtefacts(
  projectMigrationsDir: string,
  spaceId: string,
  inputs: {
    readonly contract: unknown;        // any JSON-serialisable value
    readonly contractDts: string;      // pre-rendered; caller's responsibility
    readonly headRef: { readonly hash: string; readonly invariants: readonly string[] };
  },
): Promise<void>;
```

Writes `contract.json`, `contract.d.ts`, `refs/head.json` under `<projectMigrationsDir>/<spaceId>/`. Always-overwrite (the framework owns these files). Rejects app-space and invalid space ids. Canonicalisation rules:

- `contract.json`: passes `inputs.contract` through `canonicalizeJson` so byte-equivalence holds across runs / machines.
- `contract.d.ts`: writes `inputs.contractDts` verbatim. The framework helper does **not** render `.d.ts`; rendering is target / typemap-aware and lives at the consumption site.
- `refs/head.json`: canonical JSON of `{ "hash": headRef.hash, "invariants": [...sorted] }` — invariants sorted alphabetically for determinism.

The SQL family's call site renders `contractDts` via its existing `generateContractDts` helper (which knows the target's typemaps) before invoking the framework helper:

```ts
// somewhere in @prisma-next/family-sql (consumption site, lands in M2)
emitPinnedSpaceArtefacts(projectMigrationsDir, spaceId, {
  contract: contractSpace.contractJson,
  contractDts: generateContractDts(contractSpace.contractJson, /* target typemaps */),
  headRef: contractSpace.headRef,
});
```

A Mongo-family call site would compose its own typemap-aware `.d.ts` renderer the same way.

**Drift detection (T1.9).** Shipped as `detectSpaceContractDrift(spaceId, { descriptorHash, pinnedHash })` (pure 3-discriminant primitive) plus `readPinnedContractHash(projectMigrationsDir, spaceId)` (I/O wrapper) in `@prisma-next/migration-tools/exports/spaces`.

Before computing `priorContract` for a space:

- Read pinned hash via `readPinnedContractHash(...)`. The wrapper reads `<projectMigrationsDir>/<spaceId>/refs/head.json.hash` rather than re-hashing the pinned `contract.json` content. This is operationally equivalent under descriptor self-consistency (T1.8 writes `inputs.headRef.hash` verbatim into `refs/head.json`, and `headRef.hash` is the same hash the descriptor's pipeline produces) and slightly more robust — immune to canonical-JSON pipeline evolution between framework versions. Returns `null` on ENOENT (no pinned file yet — first emit case).
- Compute `descriptorHash = hash(descriptor.contractSpace.contractJson)` from the in-memory descriptor side using the same canonical-JSON pipeline.
- Pass both to `detectSpaceContractDrift(spaceId, { descriptorHash, pinnedHash })`. The helper returns `{ kind: 'noDrift' | 'firstEmit' | 'drift'; spaceId; descriptorHash; pinnedHash }` — pure, no I/O, no warning surface (the SQL-family consumption site formats the warning).
- On `kind === 'drift'`: SQL-family consumption site surfaces a non-fatal warning naming the extension and the diff direction. The migration emit proceeds normally — the warning is informational. (`migrate` is the canonical way to materialise extension bumps; the warning just confirms the bump is being captured this run.)
- On `kind === 'firstEmit'` or `kind === 'noDrift'`: no warning.

**Descriptor self-consistency check (M2 R2).** Shipped as `assertDescriptorSelfConsistency({ extensionId, target, targetFamily, storage, headRefHash })` in `@prisma-next/migration-tools/exports/spaces`. Runs at family-create time (not lazily). Recomputes `hash(canonicalize(...))` over the descriptor's contract content and asserts equality with `headRef.hash`. The implementation strips `storage.storageHash` before recomputing the canonical hash because the authoring-side hash function does not consume its own output (the hash is an *output* of canonicalisation, not an input). Mismatch surfaces `MIGRATION.DESCRIPTOR_HEAD_HASH_MISMATCH` with the offending extension id named in the message — indicates the extension author published an inconsistent descriptor (e.g. `headRef.hash` not regenerated after `contractJson` changed).

**Companion read-side helper (M2 R2).** `readPinnedHeadRef(projectMigrationsDir, spaceId)` returns the full `(hash, invariants)` pair from `refs/head.json` — complements the existing hash-only `readPinnedContractHash`. Same ENOENT-as-null + corrupt-file-error semantics. Used by any verifier path that needs invariants.

**Migrate-time wiring (M2 R2).** Shipped as `runContractSpaceMigratePass(...)` + `formatContractSpaceDriftWarning(...)` in `@prisma-next/cli`. Wired into the SQL-family `migration-plan.ts` flow *before* the app-space no-op check (so an extension bump alone re-pins and warns even when the user's schema hasn't changed). The migrate pass: detects drift per space via `detectSpaceContractDrift`, formats user-facing warnings naming the extension and diff direction, then re-emits pinned artefacts via `emitPinnedSpaceArtefacts`. Locks AM7 end-to-end.

## 4. Per-space runner (T1.4) and verifier (T1.5)

**Helper location.** Both runner-ordering and verifier helpers ship in `@prisma-next/migration-tools/exports/spaces` as **pure target-agnostic primitives** — same convention as R3's producer-side helpers. The transaction wrapping, marker row writes, and live-DB schema compare belong at the SQL-family consumption site (lands in M2 R1). `pnpm lint:deps` validates that `packages/1-framework` carries no target-* references.

**SQL-family runner protocol (M2 R4).** Shipped on `SqlMigrationRunner` (per-target — both Postgres and SQLite implement the same interface). Externally-managed-transaction design (orchestrator decision 11):

- `execute(options)` — single-space entry point. Opens an outer transaction, calls `executeOnConnection`, commits on success / rolls back on failure. **Existing single-space callers see no behaviour change.**
- `executeOnConnection(options)` — runner body without `BEGIN`/`COMMIT`/`ROLLBACK`. Caller owns the transaction lifecycle. Idempotent control-table setup; per-space marker writes via the optional `space?: string` parameter (defaults to `'app'`).
- `executeAcrossSpaces({ driver, perSpaceOptions })` — multi-space entry point. Opens **one** outer transaction and fans out to `executeOnConnection` per space. Failure on any space rolls back every space's writes. Returns `MultiSpaceRunnerResult` with `MultiSpaceRunnerSuccessValue` / `MultiSpaceRunnerFailure` envelope; failure carries `failingSpace` for clean error attribution. **Locks AM4-rollback at runner level.**

**Driver-as-connection convention.** `ControlDriverInstance<'sql', T>` exposes only `driver.query(sql, params)` — there is no separate `connection` object today. The driver IS the connection; this convention pre-dates the contract-spaces project. If a future architectural pass introduces a real connection abstraction, the runner can grow a `runWithinConnection(conn, fn)` lower-level entry point at that time without breaking `executeAcrossSpaces`.

**Schema-verification scope.** `introspect` + `verifySqlSchema` restricted to the `'app'` space only. Extension contract spaces don't own user-facing tables in the live schema; calling `verifySqlSchema` against an extension contract would flag every app-space table as "extra". Per-space verifier integrity (the orphan-marker / hash-mismatch / invariants-mismatch kinds) is covered by `verifyContractSpaces` independently — see § 4 § Verifier.

**`deriveProvidedInvariants` × operationClass orthogonality (M3 R3 amendment).** `deriveProvidedInvariants(ops)` (in `@prisma-next/migration-tools/exports/invariants`) collects invariantIds from **every** op that carries one, regardless of `operationClass`. The original implementation gated on `operationClass === 'data'` because the M1 pass-thinking framed invariants as the post-condition of data ops; M3 R3's first real consumer (cipherstash baseline ops with `operationClass: 'additive'`) made it clear that `operationClass` (planner-policy gate — additive / widening / destructive / data) and `invariantId` (cross-space marker bookkeeping) are orthogonal concerns. Widening to "any op with an invariantId" aligns the framework with this sub-spec's § 7.5 description and keeps the validator (`readMigrationPackage` checks that `metadata.providedInvariants` matches the re-derived set) coherent across both single-space app migrations and per-space extension migrations.

**Runner ordering helper (T1.4).** Shipped as `concatenateSpaceApplyInputs<TOp>(inputs)` in `@prisma-next/migration-tools/exports/spaces`. Pure, generic over per-target op type:

```ts
// @prisma-next/migration-tools/exports/spaces
interface SpaceApplyInput<TOp> {
  readonly spaceId: string;
  readonly migrationDirectory: string;            // either projectRoot/migrations or .../<space-id>
  readonly currentMarkerHash: string | null;
  readonly currentMarkerInvariants: readonly string[];
  readonly path: readonly TOp[];                  // from per-space planner / findPathWithDecision
}

function concatenateSpaceApplyInputs<TOp>(
  inputs: readonly SpaceApplyInput<TOp>[],
): readonly SpaceApplyInput<TOp>[];
```

Cross-space ordering: extensions alphabetical-by-spaceId first, app-space last. Rejects duplicate `spaceId` with `MIGRATION.DUPLICATE_SPACE_ID`. Returns inputs unchanged in identity (referential pass-through) where ordering already matches. The SQL-family consumption site wraps the resulting concatenation in a single transaction and writes per-space marker rows after apply (using the optional `space` parameter on `WriteMarkerInput` landed in T1.1).

**Verifier (T1.5).** Shipped as `verifyContractSpaces(inputs)` + `listPinnedSpaceDirectories(projectMigrationsDir)` in `@prisma-next/migration-tools/exports/spaces`. Pure structural verifier — caller supplies the loaded spaces, the pinned per-space contracts, and the marker rows; the helper returns a deterministic list of violations with actionable remediation strings. Five violation kinds:

- `declaredButUnmigrated`: extension declared in `extensionPacks` but no pinned `contract.json` on disk.
- `orphanMarker`: marker row for a space not in `extensionPacks`.
- `orphanPinnedDir`: pinned directory on disk for a space not in `extensionPacks`.
- `hashMismatch`: marker row's hash differs from pinned contract's hash.
- `invariantsMismatch`: pinned contract's required invariants are not all in the marker row's applied invariants set.

`listPinnedSpaceDirectories` filters dot-prefixed and timestamp-prefixed (`/^\d{8}T\d{4}_/`) directories so it correctly distinguishes pinned space directories from app-space migration directories.

**SQL-family wiring (M2 R2 + R3 split).** The SQL family wires `verifyContractSpaces` into its existing `verify` / `dbInit` paths via:

- **`gatherDiskContractSpaceState(projectMigrationsDir)`** (in `@prisma-next/migration-tools/exports/spaces`) — composes `listPinnedSpaceDirectories` + `readPinnedHeadRef` to produce the input shape `verifyContractSpaces` expects from on-disk state.
- **`runContractSpaceVerifierPrecheck(...)`** (in `@prisma-next/cli`) — target-specific composition that gathers disk state, runs the verifier, and surfaces every offending kind in a single `CliStructuredError` envelope before any database I/O happens. Wired into `db init`, `db verify`, and `db schema --verify` paths.

**Structural-half / marker-half split.** M2 R2 wires the precheck for the three structural violation kinds (`declaredButUnmigrated`, `orphanPinnedDir`, descriptor-vs-pinned `hashMismatch`) — locks AC-16 end-to-end at the CLI surface. M2 R3 wires the marker-dependent kinds (`orphanMarker`, marker-vs-pinned `hashMismatch`, `invariantsMismatch`) via a new `SqlControlAdapter.readAllMarkers(driver)` SPI method (implemented for both Postgres and SQLite; mirrors `readMarker`'s existence-probe-then-select pattern), surfaced through `ControlFamilyInstance.readAllMarkers(...)` (cross-family interface — Mongo bridge surfaces the single legacy marker keyed at `'app'` until per-space Mongo is in scope per spec § Non-goals). New CLI utility `runContractSpaceVerifierMarkerCheck` runs after the `db verify` connection is established and threads marker rows through `verifyContractSpaces`, locking AC-13 to full PASS end-to-end.

**Extension migration-package materialisation (M2 R3).** Shipped as `runContractSpaceExtensionMigrationsPass(...)` in `@prisma-next/cli`. Writes descriptor-shipped packages (`DescriptorMigrationPackage` shape) to `migrations/<spaceId>/<dirName>/` for any package not yet on disk. **Idempotent by existence-check** (skips existing dirs without writing-and-comparing — pre-existing manifest content is byte-untouched). Routed through `planAllSpaces<unknown, DescriptorMigrationPackage>` for deterministic alphabetical ordering + `MIGRATION.DUPLICATE_SPACE_ID` rejection. Closes the M2 R2 deferred `planAllSpaces` consumer-site item. Locks **AM12 (materialisation idempotency)** below.

**Per-package materialisation primitive (M3 R4).** The existence-check + write-if-missing pattern was lifted out of the CLI pass and the cipherstash AM11/AM12 regression test into a single primitive on `@prisma-next/migration-tools/io`:

```ts
// @prisma-next/migration-tools/exports/io
function materialiseExtensionMigrationPackageIfMissing(
  targetDir: string,
  pkg: MigrationPackageContents,
): Promise<{ readonly written: boolean }>;
```

Returns `{ written: true }` on first run (writes manifest + ops + canonical contract.json via `writeExtensionMigrationPackage`), `{ written: false }` when `<targetDir>/<pkg.dirName>/` already exists. Both `runContractSpaceExtensionMigrationsPass` and the cipherstash AM12 test now call this primitive directly — the AC-7 / AM12 by-existence skip semantic lives in one place. The framework-side test suite for the primitive (4 unit tests in `@prisma-next/migration-tools`) covers the same idempotency property the CLI / extension layers used to mirror inline.

**Verifier algorithm** (the conceptual flow the consumption site wires together):

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

Extend `CodecControlHooks`. The shipped shape (M2 R1, commit `f7b083c37`):

```ts
import type { StorageTable, StorageColumn } from '@prisma-next/sql-contract/types';

type FieldEvent = 'added' | 'dropped' | 'altered';

interface FieldEventContext {
  readonly priorTable?: StorageTable;    // present for 'dropped' and 'altered'
  readonly newTable?: StorageTable;      // present for 'added' and 'altered'
  readonly priorField?: StorageColumn;   // present for 'dropped' and 'altered'
  readonly newField?: StorageColumn;     // present for 'added' and 'altered'
}

interface CodecControlHooks<TTargetDetails = unknown> {
  // … existing hooks …
  readonly onFieldEvent?: (
    event: FieldEvent,
    ctx: FieldEventContext,
  ) => readonly MigrationPlanOperation<TTargetDetails>[];
}
```

`FieldEventContext` uses the SQL family's existing concrete IR types (`StorageTable` / `StorageColumn` from `@prisma-next/sql-contract/types`) rather than abstract `TableIR` / `FieldIR` placeholders — matches the convention already used by other `CodecControlHooks` methods.

Hook contract:

- **Synchronous.** The emitter must be able to assemble the migration JSON without awaiting hooks.
- **App-space scope only.** `priorTable` and `newTable` are scoped to the application's contract; the hook never sees extension-space IR. This is enforced by API shape — the hook signature has no parameter for cross-space context.
- **`'altered'` semantics.** Fires when a field exists in both `priorTable` and `newTable` and any field property has changed *except* `codecId`. Codec-id changes are a v1 non-goal (see project spec § Non-goals).
- **Return value.** `MigrationPlanOperation<TTargetDetails>[]`. Each op must carry its own `invariantId`. Returned ops are inlined into the app-space migration's `ops.json`, alongside the user's own structural ops.

**SQLite raw-SQL op factory (M2 R2 amendment).** Codec hooks emit ops at plan time that sit alongside structural DDL. The Postgres adapter already exposes a `rawSql(...)` helper for this; SQLite gained a parallel `RawSqlCall` op shape + `rawSql({ id, label, sql, target })` factory in `@prisma-next/target-sqlite/exports/op-factory-call`. Both factories produce ops with stable shape (`operationClass: 'data'` by default — overridable when the codec needs `additive` / `widening` semantics) so the per-target planner can route them through the same emit path as structural ops. Cipherstash's `cipherstash:string@1` codec consumes the Postgres factory in M3 R2.

**Wiring helper (T2.1).** Shipped as `planFieldEventOperations(options)` in `@prisma-next/family-sql/control` (alongside the codec-control surface). The helper's return type is `SqlMigrationPlanOperation<unknown>[]` — non-generic at the helper boundary because `extractCodecControlHooks` erases target-details to `unknown` at the codec-extraction boundary (pre-existing behaviour). Each target's planner casts the helper's `unknown` results back to its target-details specialisation at the integration site (scoped per-line `.map(...)` cast with an explanatory comment, per `AGENTS.md` typesafety rules); mirrors the existing `storageTypePlanCallStrategy`'s lift pattern. **No public-API surface change for codec authors** — they still type their `onFieldEvent` hook against their lane's target-details.

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

**Schema prune for app-space planning (M2 R5).** The app-space planner is invoked against the *full* introspected live schema, but it owns only the app-space slice — extension-owned tables (declared in extension-space pinned `contract.json`s) are not in the app-space contract IR and would otherwise be flagged as "extras" and emitted as `DROP TABLE` ops by `db update`. To prevent this, the consumer site (`@prisma-next/cli`'s `executePerSpaceDbApply`) prunes the introspected `Schema.storage.tables` of any tables owned by other spaces' contracts (read from on-disk pinned artefacts — no descriptor imports) before passing it to the app-space planner.

This is the planner-side mirror of `strictVerification: false` on the runner-side per-space verifier (§ 4): both layers enforce **disjoint per-space ownership** at different pipeline stages. Implementation duck-types on `Schema.storage.tables` — checks each shape boundary and falls through gracefully (returns input unchanged) on mismatch, so future SQL conventions are not broken silently.

Strict-mode correctness preserved: genuine app-space orphans (tables in the live schema that no contract owns) are not in `ownedByOthers` and survive the prune, so the planner still flags them as extras in the app-space slice.

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
- [ ] **AM2.** Marker schema migration SQL applies idempotently against (a) a fresh `prisma_contract.marker` table, (b) a pre-migration single-row marker, (c) an already-migrated marker. Verified by dedicated integration tests on both Postgres and SQLite drivers.
- [ ] **AM3.** Per-space planner (`planAllSpaces`) returns the same shape regardless of `extensionPacks` declaration order (deterministic alphabetical sort).
- [ ] **AM4.** Per-space runner concatenates inputs as extensions-first-then-app-space and applies all in a single transaction. Mid-apply failure rolls back all spaces.
- [ ] **AM5.** Per-space verifier rejects all three orphan / missing cases (orphan marker, declared-but-unmigrated, orphan pinned dir) with the error messages specified in § 4.
- [ ] **AM6.** Pinned per-space artefacts (`contract.json`, `contract.d.ts`, `refs/head.json`) are written under `migrations/<space-id>/` with byte-equivalent canonical content. Re-running `migrate` against an unchanged descriptor produces no file-system change (idempotent).
- [ ] **AM7.** Drift detection: bumping a descriptor's `contractJson` without running `migrate` produces a clear warning on the next `migrate` invocation. Warning is non-fatal; emit proceeds.
- [ ] **AM8.** Codec hook fires for `'added'`, `'dropped'`, `'altered'` events with the contract specified in § 5. `'altered'` does *not* fire when only `codecId` changes.
- [ ] **AM9.** `db init` per-space: on a fresh database with the synthetic test extension, both spaces are initialised in a single transaction; marker rows for `app` and `test-contract-space` exist with expected hashes.
- [ ] **AM10.** `db update` per-space: bumping the synthetic test extension's `headRef` advances only its space's marker, leaving app-space untouched.
- [ ] **AM11.** With the synthetic test extension's package directory removed (`rm -rf packages/3-extensions/test-contract-space/dist`), `dbInit` and `db apply` succeed reading only the user's repo. `migrate` fails (descriptor not importable) — that's expected and informative.
- [ ] **AM12.** Extension migration-package materialisation at `migrate` time is idempotent: re-running `migrate` against a repo whose pinned `migrations/<spaceId>/<dirName>/` directories already exist leaves their contents byte-untouched (verified by existence-check, not write-and-compare). Added M2 R3.

## R4 design choice — runner single-tx restructure (informational)

R3 deferred SQL-family runner single-tx wiring (AM4-rollback) to R4 because both Postgres and SQLite runners currently open their own `BEGIN`/`COMMIT` *inside* `runner.execute(...)`, and restructuring to support a multi-space outer transaction is itself a multi-thousand-LOC architectural slice.

Reviewer-recommended approach: **externally-managed transaction** (not savepoints). Add a new entry point `runner.executeOnConnection(connection, plan)` while the existing `runner.execute(driver, plan)` becomes a thin `withTransaction(driver, conn => executeOnConnection(conn, plan))` wrapper. Existing single-space callers see no behaviour change; the multi-space caller (the new SQL-family per-space runner wiring) opens the outer transaction once and calls `executeOnConnection` per space inside it.

Rationale: savepoints would require the runner to know whether it's nested — a control-flow concern that leaks across an otherwise clean boundary, plus an "am I nested?" branch that needs its own test coverage. Both Postgres and SQLite already model transactions as connection-scoped; the externally-managed-tx restructure leverages existing target capabilities cleanly.

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
- ADR 029 — Shadow-DB preflight (covers user-DDL only; T1.1 runs inside `ensureControlTables` which is outside that scope, validated by idempotency tests instead).
- `packages/3-extensions/pgvector/` — reference shape for `packages/3-extensions/test-contract-space/`.

# Open Questions

1. **Marker migration mechanism.** § 2 recommends (A) framework-internal migration; confirm during T1.1 implementation. If (B) is chosen, document why and update the verifier to handle pre-migration marker shape.
2. **Drift detection severity.** § 3 specifies the drift warning as non-fatal informational. Should it be opt-in escalatable to error (e.g. `--strict-drift` flag)? Defer until users report a need.
3. **Pinned `contract.d.ts` regeneration.** The `.d.ts` for an extension is derived from its `contractJson` via the existing `.d.ts` emitter. Confirm the emitter is target-agnostic (or has a sensible default target) so the framework can run it for any extension space without per-extension target wiring. If not, fall back to `// @ts-nocheck` placeholder and surface as a follow-up.
