# Spec — Contract-space aggregate

- **Origin:** M2 R6 R2 design discussion (recorded in this branch's chat transcript). The architectural concerns were first surfaced in [`reviews/pr-438/system-design-review.md`](../reviews/pr-438/system-design-review.md) (round 1) and refined into a settled design over six rounds.
- **Linear ticket:** TML-2397 (the project this amends).
- **Branch to introduce:** new branch off the amended M2 head — `tml-2397-contract-space-aggregate` — that lands before M3 (cipherstash).
- **Stack to rebase:** M3 / M4 / M5 (`tml-2397-cipherstash-contract-space`, `tml-2397-pgvector-contract-space`, `tml-2397-remove-database-dependencies-and-closeout`) all rebase onto the new aggregate branch's head.
- **Findings closed by this slice:** F00 (typed aggregate), F05 (`targetId` placeholder), F09 (duplicated `buildContractSpaceVerifierError`), F15 (`__migrations` smuggling), F23 (aggregate-aware schema verification). Subsumes F30 (`PerSpace` evolutionary naming) — those symbols are deleted, not renamed.
- **Findings preserved as-is:** F11 (per-space `ensureControlTables` invocation; not architectural). F07 (Postgres CLI per-space e2e) is restated against the new pipeline at the end of this slice.

## At a glance

The current contract-space orchestrator (`executePerSpaceDbApply`) realises space-symmetry *behaviourally* but leaves the *data heterogeneous*: the app's contract and extensions' pinned contracts arrive at different stages of the load pipeline, the resolver list is constructed inside the orchestrator, `targetId` is patched onto extension plans after the app plan exists, schema verification operates on a single contract instead of the union, and three different verifier helpers (precheck, marker-check, drift) live in three files with three callers.

This slice replaces the loose `(contract, extensionContractSpaces, migrationsDir)` triple with a typed `ContractSpaceAggregate`, produced once by a loader. Every downstream consumer (planner, verifier, runner) operates on the aggregate. CLI commands become ~10-line pipelines.

```ts
type ContractSpaceAggregate = {
  readonly targetId: string;                           // ambient, from config
  readonly app: ContractSpaceMember;
  readonly extensions: readonly ContractSpaceMember[]; // sorted alphabetically by spaceId
};

type ContractSpaceMember = {
  readonly spaceId: string;
  readonly contract: Contract;                         // validated, target-typed
  readonly headRef: {
    readonly hash: string;                             // desired contract's storage hash
    readonly invariants: readonly string[];            // declared on head.json
  };
  readonly migrations: HydratedMigrationGraph;         // possibly empty
};

type HydratedMigrationGraph = {
  readonly graph: MigrationGraph;                                    // existing, from migration-tools
  readonly packagesByMigrationHash: ReadonlyMap<string, MigrationPackage>;
};
```

Three new components, all in a new export `@prisma-next/migration-tools/aggregate`:

- **Loader** (`loadContractSpaceAggregate`) — owns all file I/O. Folds in today's layout precheck, integrity checks, drift detection, and the disjointness check. Drift is fatal.
- **Aggregate planner** (`planAggregate`) — per-space `MigrationPlan` map matching the existing `executeAcrossSpaces` runner contract. Strategy per space: graph-walk (when authored invariants must be satisfied and a graph is available) or synth (when caller policy says ignore-graph, or invariants are empty); fails fast with `extensionPathUnsatisfiable` if neither strategy can produce a satisfying path.
- **Aggregate verifier** (`verifyAggregate`) — bundled `markerCheck` + `schemaCheck` with per-space pre-projection (closes F23) and aggregate-level orphan detection.

A CLI command collapses to:

```ts
// db-init.ts after the refactor — illustrative
export async function executeDbInit(input: ExecuteDbInitOptions): Promise<DbInitResult> {
  const loaded = await loadContractSpaceAggregate({
    config: input.config,
    projectRoot: input.projectRoot,
    migrationsDir: input.migrationsDir,
  });
  if (loaded.kind === 'err') return loaded;

  const planned = await planAggregate(loaded.value.aggregate, currentDBState, {
    ignoreGraphFor: new Set([loaded.value.aggregate.app.spaceId]),
  });
  if (planned.kind === 'err') return planned;

  if (input.mode === 'plan') return ok({ kind: 'plan', perSpace: planned.value.perSpace });
  return runner.executeAcrossSpaces(toRunnerInput(planned.value));
}
```

What we are **explicitly not doing** in this slice:

- Forcing `db init` / `db update` to walk a pinned app-space graph. The "synthesise on the fly from the contract IR" daily-driver behaviour stays; it's expressed as the synth strategy of the aggregate planner, selected via `callerPolicy.ignoreGraphFor` for the app member.
- Modelling extension-extension dependencies. The aggregate's `app + extensions` shape is sufficient until extensions take dependencies on each other (currently a non-goal for the project — see `spec.md` § "explicitly not doing").
- A warnings channel on the loader. Drift, layout, integrity, and disjointness violations are all fatal. If a "warn don't fail" mode is needed later, it's an additive change to the loader's options.
- Hoisting the per-space `ensureControlTables` invocation out of `executeOnConnection` (F11). Idempotent and not on the hot path.

## Required reading (in order)

1. **[`reviews/pr-438/system-design-review.md`](../reviews/pr-438/system-design-review.md)** — the originating round-1 critique and the F00 / F23 architectural concerns.
2. **[`reviews/pr-438/code-review.md`](../reviews/pr-438/code-review.md)** — the M2 R6 R2 review log. The findings this slice closes (F00, F05, F09, F15, F23, F30) are detailed there.
3. **The current per-space orchestrator:** [`packages/1-framework/3-tooling/cli/src/control-api/operations/db-apply-per-space.ts`](../../../packages/1-framework/3-tooling/cli/src/control-api/operations/db-apply-per-space.ts) — the entire file is deleted by this slice; understand what it currently does (resolver-list construction, strategy dispatch via `makeAppResolver` / `makeExtensionResolver`, the `targetId` placeholder + patch, `pruneSchemaByOtherSpaceContracts`, span IDs, idempotency handling).
4. **The current verifier helpers:**
   - [`packages/1-framework/3-tooling/cli/src/utils/contract-space-verifier-precheck.ts`](../../../packages/1-framework/3-tooling/cli/src/utils/contract-space-verifier-precheck.ts) — folded into loader step 2.
   - [`packages/1-framework/3-tooling/cli/src/utils/contract-space-verifier-marker-check.ts`](../../../packages/1-framework/3-tooling/cli/src/utils/contract-space-verifier-marker-check.ts) — folded into aggregate verifier's `markerCheck`.
   - [`packages/1-framework/3-tooling/cli/src/utils/contract-space-migrate-pass.ts`](../../../packages/1-framework/3-tooling/cli/src/utils/contract-space-migrate-pass.ts) (drift detection) — folded into loader step 5.
5. **The migration-tools spaces primitives** (the foundation this slice builds on; do not modify):
   - [`packages/1-framework/3-tooling/migration/src/exports/spaces.ts`](../../../packages/1-framework/3-tooling/migration/src/exports/spaces.ts) and the helpers it re-exports (`verifyContractSpaces`, `gatherDiskContractSpaceState`, `concatenateSpaceApplyInputs`, `emitPinnedSpaceArtefacts`, `detectSpaceContractDrift`, `readPinnedContractHash`, `listPinnedSpaceDirectories`).
   - [`packages/1-framework/3-tooling/migration/src/migration-graph.ts`](../../../packages/1-framework/3-tooling/migration/src/migration-graph.ts) and [`packages/1-framework/3-tooling/migration/src/graph.ts`](../../../packages/1-framework/3-tooling/migration/src/graph.ts) — `MigrationGraph`, `MigrationEdge`, `reconstructGraph`. Already eagerly hydrated; the loader uses these.
   - [`packages/1-framework/3-tooling/migration/src/package.ts`](../../../packages/1-framework/3-tooling/migration/src/package.ts) — `MigrationPackage` (already integrity-checked at read time per the type's invariant).
   - [`packages/1-framework/3-tooling/migration/src/compute-extension-space-apply-path.ts`](../../../packages/1-framework/3-tooling/migration/src/compute-extension-space-apply-path.ts) — re-pointed as the graph-walk strategy of the aggregate planner.
6. **The runner protocol** (unchanged contract; the planner output already matches it):
   - `executeAcrossSpaces` on `SqlMigrationRunner` — read [`packages/3-targets/3-targets/postgres/src/core/migrations/runner.ts`](../../../packages/3-targets/3-targets/postgres/src/core/migrations/runner.ts) and [`packages/3-targets/3-targets/sqlite/src/core/migrations/runner.ts`](../../../packages/3-targets/3-targets/sqlite/src/core/migrations/runner.ts) to confirm the per-space input shape and `MultiSpaceRunnerFailure.failingSpace` semantics.
7. **Contract / config types** (consumed by the loader):
   - [`packages/1-framework/1-core/contract/src/`](../../../packages/1-framework/1-core/contract/src/) — `Contract`, `validateContract`.
   - [`packages/1-framework/1-core/config/src/config-validation.ts`](../../../packages/1-framework/1-core/config/src/config-validation.ts) — `Config`, `extensionPacks`. Confirms `targetId` is required + consistent across `driver` / `adapter` / `extensionPacks`.
8. **Per-target planner** (the synth strategy delegates to this; do not modify):
   - [`packages/2-sql/9-family/src/core/migrations/`](../../../packages/2-sql/9-family/src/core/migrations/) — `createPlanner(family)`, `MigrationPlanner.plan(...)`. The aggregate planner's synth strategy calls this with the projected schema slice.

## Diagnosis (verify before starting)

Before starting work, verify the current-state claims. If any of these don't reproduce, **stop and report back**:

1. **`executePerSpaceDbApply` exists** at `packages/1-framework/3-tooling/cli/src/control-api/operations/db-apply-per-space.ts` and is the single entry point for `db init` / `db update` (post-M2 consolidation, commit `781dc763c`). The function signature takes `{ contract, extensionContractSpaces, migrationsDir, ... }` as separate arguments.
2. **`targetId` placeholder.** `rg "as unknown as MigrationPlan\['targetId'\]" packages/` returns at least one match in `db-apply-per-space.ts` near the extension resolver's plan construction. The corresponding patch step lives later in the same file (search for `appPlan.targetId`).
3. **`db verify` runs both verifier passes.** [`packages/1-framework/3-tooling/cli/src/commands/db-verify.ts`](../../../packages/1-framework/3-tooling/cli/src/commands/db-verify.ts) calls `runContractSpaceVerifierPrecheck` followed by `runContractSpaceVerifierMarkerCheck`, then `client.schemaVerify` (which calls `verifySqlSchema` against the **app contract only**).
4. **`db init` and `db update` run both verifier passes** (post-M2 consolidation, commit `ec5761619`) but `client.schemaVerify` is not called as a precondition there.
5. **Schema verification is single-contract.** `verifySqlSchema` in `@prisma-next/family-sql/schema-verify` takes one `Contract`. Its callers (currently `db verify` and the runner) pass the app's contract. Tables claimed by extensions appear as `extras` unless the caller pre-prunes via `pruneSchemaByOtherSpaceContracts`. F23 is the open-on-disk symptom of this.
6. **Drift detection is reactive, not load-time.** `runContractSpaceMigratePass` in `cli/src/utils/contract-space-migrate-pass.ts` performs drift detection during `migrate`-time but not as a precondition of `db init` / `db update` / `db verify`. A user with drift between pinned and live descriptor today gets a warning at next `migrate`, not an immediate refusal.
7. **Disjointness is implicit.** No code today fails when two declared contract spaces claim the same table; it's an unwritten invariant of how space contracts are authored.
8. **Existing tests this slice must keep green:**
   - `packages/3-targets/6-adapters/sqlite/test/migrations/db-apply-per-space.cli.test.ts` — multi-space CLI e2e (atomic init, marker advance, codec hook, rollback).
   - `test/integration/test/cli.db-init.contract-space-verifier.test.ts` and `test/integration/test/cli.db-update.contract-space-verifier.test.ts` — AC13 / AC16 locks.
   - `packages/3-targets/3-targets/{postgres,sqlite}/test/migrations/runner.multi-space.{integration.,}test.ts` — runner-level multi-space rollback with `failingSpace` attribution.

If all eight reproduce, proceed.

## Design

### Principle

> The orchestrator (CLI) loads configuration + contract artefacts and assembles a `ContractSpaceAggregate`. Every downstream component (planner, verifier, runner) operates on the aggregate. Knowledge that is loader-only — which member is the app, which contracts came from where, the dep relationship between app and extensions, layout/integrity/drift violations — does not propagate into the aggregate's type. Once the loader emits an aggregate, every member is a peer with the same shape, and the aggregate is internally consistent.

The only place app-vs-extension distinguishability survives downstream is the **caller policy**: the CLI's choice to pass `{ ignoreGraphFor: [aggregate.app.spaceId] }` to the planner so the daily-driver `db init` / `db update` flow continues to synthesise the app's plan from its contract IR rather than walk an authored graph. The aggregate itself stays type-uniform.

This slice generalises the per-space symmetry the M2 consolidation introduced behaviourally (single resolver loop) into the type system.

### Aggregate type

The full type surface — placed in `@prisma-next/migration-tools/aggregate/types.ts`:

```ts
type ContractSpaceAggregate = {
  readonly targetId: string;
  readonly app: ContractSpaceMember;
  readonly extensions: readonly ContractSpaceMember[];
};

type ContractSpaceMember = {
  readonly spaceId: string;
  readonly contract: Contract;                         // validated; uses `targetId`-consistent storage IR
  readonly headRef: {
    readonly hash: string;                             // contract's storage hash (matches contract.storage.storageHash for app; matches refs/head.json for extensions)
    readonly invariants: readonly string[];            // alphabetically sorted, deduplicated
  };
  readonly migrations: HydratedMigrationGraph;
};

type HydratedMigrationGraph = {
  readonly graph: MigrationGraph;                                    // existing — from migration-tools/graph
  readonly packagesByMigrationHash: ReadonlyMap<string, MigrationPackage>;  // ops lookup
};
```

**Invariants the loader enforces at construction:**

1. `targetId` is consistent across `Config.adapter`, `Config.driver`, every entry in `Config.extensionPacks`, and the aggregate's value. (Already enforced by `config-validation.ts`; loader re-asserts.)
2. Every member's `contract.storage.targetId` matches `aggregate.targetId`.
3. `aggregate.extensions` is sorted alphabetically by `spaceId`. (Mirrors today's `concatenateSpaceApplyInputs` ordering.)
4. No two members claim the same storage element (table / type / etc.). Disjointness is an aggregate-level invariant; downstream consumers can assume it.
5. For each extension member: `member.headRef.hash` exists as a node in `member.migrations.graph` (the pinned head ref points at a reachable contract); the on-disk pinned `refs/<hash>/contract.json` matches `member.contract` (drift = none).
6. For the app member: `member.headRef.hash` equals `member.contract.storage.storageHash`. The app's `migrations` is hydrated from the user's authored `migrations/` (or empty if none).
7. Every declared `Config.extensionPacks` entry corresponds to exactly one member in `aggregate.extensions`; no orphan pinned directories under `migrationsDir/`.

### Loader

```ts
type LoadAggregateInput = {
  readonly config: Config;
  readonly projectRoot: string;
  readonly migrationsDir: string;        // <projectRoot>/migrations by convention
};

type LoadAggregateOutput = Result<
  { readonly aggregate: ContractSpaceAggregate },
  LoadAggregateError
>;

type LoadAggregateError =
  | { readonly kind: 'layoutViolation';      readonly violations: readonly LayoutViolation[] }      // declaredButUnmigrated, orphanPinnedDir
  | { readonly kind: 'integrityFailure';     readonly spaceId: string; readonly detail: string }    // hash recomputation failed; pinned head ref points at non-existent contract; package's stored migrationHash != recomputed
  | { readonly kind: 'validationFailure';    readonly spaceId: string; readonly detail: string }    // arktype rejected
  | { readonly kind: 'driftViolation';       readonly spaceId: string; readonly pinnedHash: string; readonly liveHash: string }
  | { readonly kind: 'disjointnessViolation'; readonly element: string; readonly claimedBy: readonly string[] }
  | { readonly kind: 'targetMismatch';       readonly spaceId: string; readonly expected: string; readonly actual: string };
```

Loader runs in this order; **first failure short-circuits**:

1. **Read + validate app contract.** `loadContractFromTs(projectRoot)` (or `<projectRoot>/contract.json` fallback) → `validateContract<Contract>`. Invalid → `validationFailure { spaceId: aggregate.app.spaceId }`.
2. **Layout precheck.** For each `extensionPacks` entry: assert `<migrationsDir>/<spaceId>/refs/head.json` exists and is well-formed; assert `<migrationsDir>/<spaceId>/refs/<headHash>/contract.json` exists. List `<migrationsDir>/*/` and assert every directory corresponds to a declared extension. Bundle violations into a single `layoutViolation` error if any. (This is `runContractSpaceVerifierPrecheck` + `listPinnedSpaceDirectories` + the existing checks moved inside.)
3. **Read + integrity-check each extension's pinned artefacts.** For each extension: read `refs/head.json` (parse, sort `invariants`); read pinned `refs/<headHash>/contract.json`; `validateContract`; assert pinned hash matches `headRef.hash`. Read `migrations/*` packages via existing `readMigrationsDir` (which already integrity-checks every package). Assert every package's hash recomputes correctly. Any failure → `integrityFailure { spaceId, detail }`.
4. **Reconstruct migration graphs** per space via existing `reconstructGraph(packages)`. Build `packagesByMigrationHash` from the same input. Assert `headRef.hash` is in `graph.nodes` (or that `graph.nodes` is empty and `headRef.hash === EMPTY_CONTRACT_HASH`, for an extension with no migrations yet). Failures → `integrityFailure`.
5. **Drift check.** For each extension's *live descriptor* (read from the loaded `Config.extensionPacks` entry's `contractSpace.contractJson`): canonicalise + hash; compare to pinned `refs/head.json.hash`. Mismatch → fatal `driftViolation { spaceId, pinnedHash, liveHash }`. The user's remediation is `pnpm prisma-next migrate` (re-pin).
6. **Target-consistency check.** Each member's `contract.storage.targetId` must equal `aggregate.targetId` (= `Config.adapter.targetId`). Mismatch → `targetMismatch`.
7. **Disjointness check.** Build a `Map<elementId, spaceId[]>` over every member's claimed storage elements (tables, types, enums — anything in `contract.storage`). Any element claimed by more than one member → `disjointnessViolation { element, claimedBy }`.
8. **Construct the aggregate value.** Sort `extensions` alphabetically by `spaceId`. Return `Ok({ aggregate })`.

After step 3 returns, **no descriptor module is touched again for this aggregate's lifetime** — the loader is the sole descriptor-import boundary. This is a strict tightening of today's "no descriptor import on the apply path" property and is testable.

### Aggregate planner

```ts
type AggregatePlannerInput = {
  readonly aggregate: ContractSpaceAggregate;
  readonly currentDBState: {
    readonly markersBySpaceId: ReadonlyMap<string, ContractMarkerRecord | null>;
    readonly schemaIntrospection: SchemaIR;            // raw, full live schema
  };
  readonly familyInstance: ControlFamilyInstance<TFamilyId, unknown>;
  readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<TFamilyId, TTargetId>>;
  readonly callerPolicy: CallerPolicy;
};

type CallerPolicy = {
  readonly ignoreGraphFor: ReadonlySet<string>;        // spaceIds to force synth
};

type AggregatePlannerOutput = Result<AggregatePlannerSuccess, AggregatePlannerError>;

type AggregatePlannerSuccess = {
  readonly perSpace: ReadonlyMap<string, {
    readonly plan: MigrationPlan;                      // already has correct targetId from aggregate
    readonly displayOps: readonly MigrationPlanOperation[];
    readonly strategy: 'graph-walk' | 'synth';
  }>;
  readonly applyOrder: readonly string[];              // [...extSpaceIds (alphabetical), appSpaceId]
};

type AggregatePlannerError =
  | { readonly kind: 'extensionPathUnreachable';    readonly spaceId: string; readonly target: string }
  | { readonly kind: 'extensionPathUnsatisfiable'; readonly spaceId: string; readonly missingInvariants: readonly string[] }
  | { readonly kind: 'appSynthFailure';              readonly reason: string }
  | { readonly kind: 'policyConflict';               readonly spaceId: string; readonly detail: string };  // caller asked to ignore graph for a member that requires graph-walk to satisfy invariants
```

**Strategy selection** — per member, in order; first match wins:

```text
1. If callerPolicy.ignoreGraphFor.has(member.spaceId):
     - If member.headRef.invariants is empty → synth (apply caller's wish).
     - Else                                  → policyConflict { spaceId, detail: "ignoreGraph requested but member declares invariants that require graph-walk: [...]" }.
2. Else if member.migrations.graph is non-empty AND
          findPathWithDecision(graph, currentMarker.hash ?? EMPTY_CONTRACT_HASH, member.headRef.hash, member.headRef.invariants) succeeds:
     → graph-walk.
3. Else if member.headRef.invariants is empty:
     → synth.
4. Else:
     → If graph empty           → extensionPathUnreachable { spaceId, target: member.headRef.hash }.
        If graph reaches target but doesn't cover invariants → extensionPathUnsatisfiable { spaceId, missingInvariants }.
```

**Strategy bodies** (live in `aggregate/strategies/`, both target-agnostic — they delegate):

- **graph-walk** — wraps existing `findPathWithDecision` + `compute-extension-space-apply-path`'s logic. Looks up ops via `member.migrations.packagesByMigrationHash`. Emits a `MigrationPlan` with `targetId = aggregate.targetId`, `origin = currentMarker?.hash ? { storageHash: ... } : null`, `destination = { storageHash: member.headRef.hash }`, `operations = pathOps`, `providedInvariants = pathProvidedInvariants`.
- **synth** — for any member: project the live schema to that member's claimed elements via `projectSchemaToSpace(schemaIntrospection, member)` (the renamed/regeneralised `pruneSchemaByOtherSpaceContracts`); call `familyInstance.createPlanner(...).plan(prunedSchema, member.contract, frameworkComponents)`; emit a `MigrationPlan` with the same envelope as graph-walk's. Used for the app member by default; usable for an extension member if its invariants are empty.

**Output assembly** — collects per-member results into the `perSpace` map; sets `applyOrder` to `[...aggregate.extensions.map(m => m.spaceId), aggregate.app.spaceId]` (the existing alphabetical-extensions-then-app convention, materialised once on the aggregate). The result is shaped to feed directly into the runner's `executeAcrossSpaces`, modulo a thin adapter (`toRunnerInput`) at the CLI.

`targetId` is set at construction from `aggregate.targetId`; **no placeholder cast, no patch step**. Closes F05.

### Aggregate verifier

```ts
type AggregateVerifierInput = {
  readonly aggregate: ContractSpaceAggregate;
  readonly currentDBState: {
    readonly schemaIntrospection: SchemaIR;
    readonly markersBySpaceId: ReadonlyMap<string, ContractMarkerRecord | null>;
  };
  readonly mode: 'strict' | 'lenient';
};

type AggregateVerifierOutput = Result<AggregateVerifierSuccess, AggregateVerifierError>;

type AggregateVerifierSuccess = {
  readonly markerCheck: {
    readonly perSpace: ReadonlyMap<string, MarkerCheckResult>;
    readonly orphanMarkers: readonly { readonly spaceId: string; readonly row: ContractMarkerRecord }[];
  };
  readonly schemaCheck: {
    readonly perSpace: ReadonlyMap<string, VerifySqlSchemaResult>;     // existing type, unchanged
    readonly orphanElements: readonly OrphanElement[];                 // strict → errors, lenient → informational
  };
};

type MarkerCheckResult =
  | { readonly kind: 'ok' }
  | { readonly kind: 'absent' }
  | { readonly kind: 'hashMismatch';        readonly markerHash: string; readonly expected: string }
  | { readonly kind: 'missingInvariants';   readonly missing: readonly string[] };

type AggregateVerifierError =
  | { readonly kind: 'introspectionFailure'; readonly detail: string };  // lifted from family.introspect
```

**Algorithm:**

- `markerCheck.perSpace` — per member: compare `currentDBState.markersBySpaceId.get(member.spaceId)` against `member.headRef.hash` + `member.headRef.invariants`. Absence is a kind, not an error (caller decides).
- `markerCheck.orphanMarkers` — every entry in `currentDBState.markersBySpaceId` whose `spaceId` is not a member of the aggregate. Always reported (callers decide what to do; `db verify` rejects, future tooling may not).
- `schemaCheck.perSpace` — per member: call existing `verifySqlSchema(projectSchemaToSpace(schemaIntrospection, member), member.contract)`. Existing type unchanged. The pre-projection means `verifySqlSchema` no longer sees other-space tables as `extras` — it only sees the slice this member claims.
- `schemaCheck.orphanElements` — live elements not claimed by any member's contract. In `strict` mode the caller treats these as errors; in `lenient` mode they're informational. (Callers — `db verify`'s `--strict` flag — choose.)

`verifySqlSchema` is **wrapped, not changed**. Single-contract direct callers (test harnesses, future tooling) keep today's behaviour: pass an unprojected schema, get the existing "every unclaimed element is an `extras`" semantic. The aggregate verifier always pre-projects.

The single envelope-builder for verifier errors lives once on this surface. Closes F09.

### What goes away / changes / stays

**Goes away (deleted):**

- `packages/1-framework/3-tooling/cli/src/control-api/operations/db-apply-per-space.ts` — entire file. Includes `executePerSpaceDbApply`, `makeAppResolver`, `makeExtensionResolver`, `pruneSchemaByOtherSpaceContracts`, `SPAN_IDS`, the `targetId` placeholder + patch, the resolver-list construction. Replaced by `loader → planner → runner` pipeline.
- `packages/1-framework/3-tooling/cli/src/utils/contract-space-verifier-precheck.ts` — folded into loader step 2.
- `packages/1-framework/3-tooling/cli/src/utils/contract-space-verifier-marker-check.ts` — folded into aggregate verifier's `markerCheck`.
- `packages/1-framework/3-tooling/cli/src/utils/contract-space-migrate-pass.ts` (drift detection portions consumed by `db init`/`db update`) — folded into loader step 5. (If `migrate`-time drift detection is still needed at `migrate` time itself, leave that helper or repoint it; out-of-scope drift-during-`migrate` workflows are not touched by this slice.)
- `packages/1-framework/3-tooling/migration/src/exports/spaces.ts` exports of `concatenateSpaceApplyInputs` — folded into the aggregate planner's output assembly (the alphabetical-extensions-then-app ordering is applied once at construction time on `aggregate.extensions`).
- `packages/1-framework/3-tooling/migration/src/compute-extension-space-apply-path.ts` — repointed into `aggregate/strategies/graph-walk.ts`. Logic preserved; this is a relocation, not a deletion.

**Becomes thin wrappers (~10-15 lines each):**

- `packages/1-framework/3-tooling/cli/src/control-api/operations/db-init.ts` — `loader → planner → runner`. Deletes today's wrapper around `executePerSpaceDbApply`.
- `packages/1-framework/3-tooling/cli/src/control-api/operations/db-update.ts` — same.
- `packages/1-framework/3-tooling/cli/src/control-api/operations/db-verify.ts` — `loader → verifier`. Replaces the manual sequence of precheck + marker-check + `client.schemaVerify`.

**Stays unchanged:**

- `MigrationGraph`, `MigrationEdge`, `MigrationPackage`, `reconstructGraph`, `findPathWithDecision` — routing primitives, still in `migration-tools`.
- `verifySqlSchema` and `VerifySqlSchemaResult` — wrapped, not changed.
- `MigrationPlan`, `MigrationPlanOperation`, the runner's `executeAcrossSpaces` contract — runtime types and wire shape unchanged.
- Per-target `createPlanner(family).plan(...)`, `Migration` abstract class, the marker schema, marker-row writes — all unchanged.

**Changes shape:**

- `pruneSchemaByOtherSpaceContracts(schema, otherSpaceContracts[])` becomes `projectSchemaToSpace(schema, member)`. Same algorithm, exposed positively rather than as a "remove others" operation. Used by the aggregate verifier's `schemaCheck` (per-space pre-projection) and the aggregate planner's synth strategy (for the app member, projecting away the elements claimed by extensions).

## Implementation slice — commit-by-commit

Land in this order. Each commit leaves the workspace green on `pnpm typecheck` + `pnpm test:packages`.

### Commit 1: introduce types + loader

**New files:**

- `packages/1-framework/3-tooling/migration/src/aggregate/types.ts` — `ContractSpaceAggregate`, `ContractSpaceMember`, `HydratedMigrationGraph`.
- `packages/1-framework/3-tooling/migration/src/aggregate/loader.ts` — `loadContractSpaceAggregate(input)`. Internally composes existing primitives (`runContractSpaceVerifierPrecheck` logic, `readMigrationsDir`, `reconstructGraph`, `validateContract`, `detectSpaceContractDrift`, the new `projectSchemaToSpace`-derived disjointness check).
- `packages/1-framework/3-tooling/migration/src/aggregate/project-schema-to-space.ts` — the renamed/generalised `pruneSchemaByOtherSpaceContracts`. Pure function; same duck-typing fall-through as today (validated empirically by the M2 R6 unit tests, which transplant here).
- `packages/1-framework/3-tooling/migration/src/exports/aggregate.ts` — re-exports `loadContractSpaceAggregate`, the type surface, `projectSchemaToSpace`. (Planner / verifier exports added in commits 2 / 3.)

**New tests** (in `packages/1-framework/3-tooling/migration/test/aggregate/`):

- `loader.test.ts` — one test per failure variant (`layoutViolation`, `integrityFailure`, `validationFailure`, `driftViolation`, `disjointnessViolation`, `targetMismatch`); plus a success-path test that asserts on `aggregate.extensions` ordering and member-shape completeness. Uses temp dirs (loader is the fs boundary).
- `project-schema-to-space.test.ts` — re-targets the existing `pruneSchemaByOtherSpaceContracts` unit tests (eight tests from M2 R6 R1 commit `aacdce651` — duck-typing fall-through, orphan-table preservation, zero-cost path) at the new function name.

**Existing references to update** (call sites / imports only — implementation unchanged):

- None for downstream consumers yet — this commit introduces the types and loader; nothing consumes them yet. Old surfaces (`executePerSpaceDbApply`, the verifier helpers) keep working.

**Validation:** `pnpm typecheck` ✓; `pnpm test:packages` ✓ (new tests green; existing tests unchanged).

### Commit 2: aggregate planner (with strategies)

**New files:**

- `packages/1-framework/3-tooling/migration/src/aggregate/planner.ts` — `planAggregate(input)`. Orchestrates strategy selection per member; assembles the per-space output map; sets `applyOrder` from `aggregate`.
- `packages/1-framework/3-tooling/migration/src/aggregate/strategies/graph-walk.ts` — wraps existing `compute-extension-space-apply-path` logic; emits a `MigrationPlan` per member.
- `packages/1-framework/3-tooling/migration/src/aggregate/strategies/synth.ts` — pre-projects the live schema; delegates to `familyInstance.createPlanner(...).plan(prunedSchema, member.contract, frameworkComponents)`; emits a `MigrationPlan` per member.

**Updated:**

- `packages/1-framework/3-tooling/migration/src/exports/aggregate.ts` — adds `planAggregate` and the planner type surface.

**New tests:**

- `aggregate/planner.test.ts` — strategy selection (`callerPolicy.ignoreGraphFor` honoured for app; graph-walk picked when invariants required + graph satisfies; synth fallback when invariants empty; `extensionPathUnsatisfiable` when neither; `policyConflict` when caller asks to ignore graph for an extension that declares non-empty invariants); output shape (per-space `MigrationPlan` with correct `targetId`; `applyOrder` matches `[...aggregate.extensions, aggregate.app]`; `strategy` attribution per member). Pure function over hydrated aggregate — no fs.
- `aggregate/strategies/graph-walk.test.ts` — happy path + the existing `compute-extension-space-apply-path.test.ts` cases re-pointed (`unreachable`, `unsatisfiable`, `pinnedHeadRefMissing`).
- `aggregate/strategies/synth.test.ts` — happy path + assertion that the synth strategy receives a projected schema (extension-claimed elements pruned).

**Existing references to update:**

- None yet — planner is wired in commit 4.

**Validation:** `pnpm typecheck` ✓; `pnpm test:packages` ✓.

### Commit 3: aggregate verifier

**New files:**

- `packages/1-framework/3-tooling/migration/src/aggregate/verifier.ts` — `verifyAggregate(input)`. Bundles `markerCheck` + `schemaCheck` with per-space pre-projection.

**Updated:**

- `packages/1-framework/3-tooling/migration/src/exports/aggregate.ts` — adds `verifyAggregate` and the verifier type surface.

**New tests:**

- `aggregate/verifier.test.ts` — `markerCheck` cases per member (`ok`, `absent`, `hashMismatch`, `missingInvariants`); `markerCheck.orphanMarkers` (rows for non-members); `schemaCheck` cases per member (per-space match, mismatch); `schemaCheck.orphanElements` (live elements not claimed by any member); `strict` vs `lenient` modes (orphan elements as error / informational); F23 lock — multi-member aggregate with each member claiming live tables returns zero `schemaCheck.perSpace[m].issues` and zero `orphanElements`.

**Existing references to update:**

- None yet — verifier is wired in commit 4.

**Validation:** `pnpm typecheck` ✓; `pnpm test:packages` ✓.

### Commit 4: rewire CLI commands

**Updated files (each function body reduces to ~10-15 lines):**

- `packages/1-framework/3-tooling/cli/src/control-api/operations/db-init.ts` — `loader → planner → runner` pipeline. Calls `loadContractSpaceAggregate`, builds `callerPolicy = { ignoreGraphFor: new Set([aggregate.app.spaceId]) }`, calls `planAggregate`, then either returns the plan (in `mode === 'plan'`) or dispatches to `runner.executeAcrossSpaces`.
- `packages/1-framework/3-tooling/cli/src/control-api/operations/db-update.ts` — same pipeline; `policy: { allowedOperationClasses: [...] }` differs.
- `packages/1-framework/3-tooling/cli/src/control-api/operations/db-verify.ts` — `loader → verifier` pipeline. Calls `loadContractSpaceAggregate`, then `verifyAggregate({ aggregate, currentDBState, mode: 'strict' })`. Surfaces structured errors to the CLI.
- `packages/1-framework/3-tooling/cli/src/commands/{db-init,db-update,db-verify}.ts` — top-level command files lose the `runContractSpaceVerifierPrecheck` and `runContractSpaceVerifierMarkerCheck` calls (the loader and aggregate verifier now own those). The commands now call into the operations layer cleanly.

**Adapter helper:**

- A small `toRunnerInput(plannerOutput)` adapter inside `db-init`/`db-update` that maps `AggregatePlannerSuccess` → the `executeAcrossSpaces` per-space input shape. Local; not exported.

**Tests to update (assertions refactored, not deleted):**

- `test/integration/test/cli.db-init.contract-space-verifier.test.ts` and `.../cli.db-update.contract-space-verifier.test.ts` — re-pointed at the new pipeline. AC13 / AC16 still PASS. Error-code surface may change shape (now flowing through `LoadAggregateError.layoutViolation` rather than `runContractSpaceVerifier*`'s envelope); update the assertions to match the new surface but preserve the AC scenarios literally.
- `packages/3-targets/6-adapters/sqlite/test/migrations/db-apply-per-space.cli.test.ts` — re-named to `db-init-update.cli.test.ts` (the `per-space` qualifier is gone with the deletions). Same scenarios; same assertions; calls the new pipeline.

**Validation:** `pnpm typecheck` ✓; `pnpm test:packages` ✓; `pnpm test:integration` ✓; the SQLite e2e ✓.

### Commit 5: delete deprecated surfaces

**Files deleted:**

- `packages/1-framework/3-tooling/cli/src/control-api/operations/db-apply-per-space.ts`.
- `packages/1-framework/3-tooling/cli/src/utils/contract-space-verifier-precheck.ts`.
- `packages/1-framework/3-tooling/cli/src/utils/contract-space-verifier-marker-check.ts`.
- `packages/1-framework/3-tooling/cli/src/utils/contract-space-migrate-pass.ts` *if* the file's only consumers were the now-rewired commands. If `migrate`-time drift detection still uses parts of it, leave the residual logic in place; do not block this commit on disentangling unrelated callers.
- `packages/1-framework/3-tooling/cli/test/control-api/db-apply-per-space.test.ts` — its useful cases (`projectSchemaToSpace` unit tests; the eight from M2 R6 R1) are already transplanted in commit 1.

**Re-export cleanup:**

- Remove `concatenateSpaceApplyInputs` from `packages/1-framework/3-tooling/migration/src/exports/spaces.ts`. (The function itself can be kept as a private helper inside the planner, or deleted entirely if the planner builds the apply order without it.)

**Verification:**

- `rg -n "executePerSpaceDbApply|PerSpaceExtensionInput|ExecutePerSpaceDbApplyOptions|pruneSchemaByOtherSpaceContracts|runContractSpaceVerifierPrecheck|runContractSpaceVerifierMarkerCheck" packages/` — zero matches in source.
- `rg -n "as unknown as MigrationPlan\['targetId'\]" packages/` — zero matches.
- `rg -n "concatenateSpaceApplyInputs" packages/` — zero matches in source (private helper allowed inside the planner if retained, but not as a re-export).

**Validation:** `pnpm typecheck` ✓; `pnpm test:packages` ✓; `pnpm test:integration` ✓; `pnpm lint:deps` ✓; `pnpm build` ✓.

### Commit 6: integration tests + docs

**New integration tests:**

- `test/integration/test/cli.db-verify.aggregate-schema.test.ts` — locks F23. Setup: app contract claims table `User`, extension contract claims table `cs_config` (synthetic test extension `@prisma-next/extension-test-contract-space`); both tables exist in the live DB; `db verify` returns zero schema issues. Run against PGlite.
- `test/integration/test/cli.loader.drift.test.ts` — pinned extension contract ≠ live descriptor → `db init` returns `driftViolation`, names the spaceId, suggests `pnpm prisma-next migrate`. Run against PGlite.

**Docs to update:**

- `docs/architecture docs/adrs/ADR 211 - Contract spaces.md` — verify the table at lines 267-270 still accurately describes which command rejects which violation kind. With the new pipeline, every load-bearing check happens at the loader; ADR table may need a column-by-column refresh. Update or annotate as needed; the ADR's architectural claims do not change.
- `projects/extension-contract-spaces/spec.md` — no changes (the project spec captures the user-facing behaviour, which is unchanged).

**Validation:** `pnpm typecheck` ✓; `pnpm test:packages` ✓; `pnpm test:integration` ✓; `pnpm test:e2e` ✓; `pnpm lint:deps` ✓; `pnpm build` ✓.

## Acceptance criteria

The slice is done when **all** of these hold. Each is mechanically checkable.

- [ ] **AC1.** `cli/control-api/operations/db-apply-per-space.ts` does not exist.
- [ ] **AC2.** `cli/utils/contract-space-verifier-precheck.ts` and `cli/utils/contract-space-verifier-marker-check.ts` do not exist. `cli/utils/contract-space-migrate-pass.ts` either does not exist or no longer participates in `db init` / `db update` / `db verify`.
- [ ] **AC3.** `migration-tools/exports/spaces` no longer exports `concatenateSpaceApplyInputs`.
- [ ] **AC4.** `migration-tools/exports/aggregate` exports `loadContractSpaceAggregate`, `planAggregate`, `verifyAggregate`, `projectSchemaToSpace`, plus the type surface (`ContractSpaceAggregate`, `ContractSpaceMember`, `HydratedMigrationGraph`, `CallerPolicy`, the success/error variants).
- [ ] **AC5.** `cli/control-api/operations/{db-init,db-update,db-verify}.ts` function bodies are each ≤ 30 lines (excluding imports + types).
- [ ] **AC6.** `rg "as unknown as MigrationPlan\['targetId'\]" packages/` returns zero matches.
- [ ] **AC7.** `rg "executePerSpaceDbApply|PerSpaceExtensionInput|ExecutePerSpaceDbApplyOptions|pruneSchemaByOtherSpaceContracts" packages/` returns zero matches in source.
- [ ] **AC8.** Aggregate verifier errors flow through one envelope-builder; `rg "buildContractSpaceVerifierError" packages/` returns at most one definition.
- [ ] **AC9.** `aggregate/project-schema-to-space.ts` exists and is consumed by both the synth strategy (for the app member) and the verifier's `schemaCheck` (per-member pre-projection).
- [ ] **AC10.** Aggregate `verifyAggregate` against a multi-member deployment (app + ≥1 extension, both claiming live tables) returns zero entries in `schemaCheck.perSpace[*].issues` and zero `schemaCheck.orphanElements`. (F23 lock.)
- [ ] **AC11.** `db init` against a workspace where pinned extension contract ≠ live extension descriptor rejects with a `driftViolation`-coded error naming the spaceId. (Loader drift-as-fatal.)
- [ ] **AC12.** Aggregate planner with `callerPolicy.ignoreGraphFor: new Set([appSpaceId])` and an extension whose `headRef.invariants` is non-empty and whose `migrations.graph` is empty rejects with `extensionPathUnsatisfiable` and names the missing invariants.
- [ ] **AC13.** All existing project ACs that PASSED on the M2-R6-R1 head continue to PASS — explicitly: AC6, AC13, AC15, AC16, AM4-rollback, AM9, AM10, AM11, AM12, plus consolidation criteria 1-12 from `m2-orchestrator-consolidation-spec.md` § "Acceptance criteria" (modulo the ones now obsoleted by deletion: criterion 1 (`extensionContractSpaces.length` zero matches), 4 (`executeDbInit` ≤ 30 lines), 5 (`executePerSpaceDbApply` symmetric loop) — these become AC5 and AC7 above).
- [ ] **AC14.** `pnpm typecheck`, `pnpm test:packages`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm lint:deps`, `pnpm build` all green.
- [ ] **AC15.** AC15 from the project spec (deletable-`node_modules`) holds — the loader is the sole descriptor-import boundary, no descriptor module is touched after `loadContractSpaceAggregate` returns. Verified by extending the existing `deletable-node-modules.test.ts` to walk the new pipeline (load → plan → verify) end-to-end with `node_modules` removed mid-run.

## Watchpoints (non-obvious gotchas)

1. **`MultiSpaceRunnerFailure.failingSpace` semantics.** The existing Postgres `runner.multi-space.integration.test.ts` and SQLite `db-apply-per-space.cli.test.ts` (renamed in commit 4) assert on `failingSpace`. The runner reports the failing space based on the order of the per-space input array. The aggregate planner's `applyOrder` (extensions alphabetical, then app) **must** match today's `concatenateSpaceApplyInputs` order literally, or `failingSpace` shifts and tests break. If a test does break on `failingSpace`, the planner's output ordering is wrong — fix the planner, not the test.
2. **`SqlMigrationRunnerExecuteOptions.space?` defaults to `'app'`.** The single-space `runner.execute` (not `executeAcrossSpaces`) still exists for callers that don't go through the aggregate (test fixtures, possibly future scripted use). Don't delete `runner.execute`.
3. **`hasMultiSpaceRunner` capability check.** In M2 R6, this fired when `extensionContractSpaces.length > 0`. After this slice, `db init` / `db update` always go through `executeAcrossSpaces`, so the check fires unconditionally. Update the check + its error message accordingly. Look in `db-apply-per-space.ts` for the existing site (search `executeAcrossSpaces` in the module being deleted) and re-implement the same protection at the CLI's runner-dispatch site.
4. **The synth strategy needs `frameworkComponents`.** The existing `planner.plan(...)` takes `frameworkComponents` as an argument (used by the SQL family for codec hooks per ADR 212). The aggregate planner must thread these through to the synth strategy. Adding `frameworkComponents` to `AggregatePlannerInput` is the cleanest plumbing; alternatives (re-deriving from `familyInstance` per call) are tempting but couple the planner to family-internal details.
5. **`projectSchemaToSpace` is duck-typed today.** The existing `pruneSchemaByOtherSpaceContracts` operates on `unknown` and falls through if the schema shape doesn't match. Preserve that behaviour in the rename; the eight unit tests from M2 R6 R1 commit `aacdce651` cover the duck-typing semantics literally and must pass against the renamed function.
6. **`buildContractSpaceVerifierError` envelope.** The two existing copies use error codes `5001` and `5002`. The aggregate verifier's `markerCheck` failures should preserve the `5002` code (or its replacement). The `runContractSpaceVerifierPrecheck` failures (now in the loader) should preserve `5001` (or its replacement). Don't re-number — downstream tooling and integration tests assert on the codes.
7. **Pinned head-ref invariants are sorted.** Today `emitPinnedSpaceArtefacts` sorts `invariants` alphabetically before serialising. The aggregate's `member.headRef.invariants` should stay sorted; if the loader reads from disk, the on-disk invariants are already sorted (an `MigrationGraph` invariant), but a defensive sort at the loader is safe.
8. **`db verify` strict-mode flag.** Today's `db verify` has a `--strict` CLI flag. Map it to `mode: 'strict' | 'lenient'` on `verifyAggregate`. Don't change the user-facing flag.
9. **The Postgres CLI per-space e2e (F07) is restated as part of this slice.** When commit 4 renames `db-apply-per-space.cli.test.ts` → `db-init-update.cli.test.ts` (or similar), add a Postgres equivalent against PGlite. M2 R6 R1 deferred this to "M3 T3.0 prep"; with the aggregate refactor landing first, this is the right place to land it. Pairs with M3's live-Postgres + EQL coverage.
10. **The synth strategy for an extension member.** Today the per-space orchestrator never synthesises plans for extensions — only for the app. The aggregate planner's strategy selection allows synth for an extension *if its `headRef.invariants` is empty*. This is a new behaviour (the M2 code path can't reach it); test it explicitly with a synthetic extension that has zero invariants and zero migration packages.

## What to push back on

If during execution any of the following surfaces, **stop and report rather than work around**:

- A pre-existing test that pins the *exact* error envelope shape produced by `runContractSpaceVerifierPrecheck` / `runContractSpaceVerifierMarkerCheck` (e.g. matching a specific JSON structure). The envelopes change shape under the aggregate verifier. Most likely the test should be updated; if the property genuinely matters to a downstream consumer, surface it.
- A consumer of `executePerSpaceDbApply` outside `packages/1-framework/3-tooling/cli/` or outside `test/integration/`. The spec assumes none exists. Flag if found.
- A rebase conflict in M3/M4/M5 against this slice's deletions/additions. The deletions are surgical (whole files); the additions are in a new export. Conflicts shouldn't arise from M3+'s contract-space content. If one does, an assumption was wrong; investigate before resolving mechanically.
- A circular import or layering violation (`pnpm lint:deps` failure) introduced by moving `compute-extension-space-apply-path` into `aggregate/strategies/graph-walk.ts`. Migration-tools is a leaf-ish package; aggregate is a sibling to graph/spaces under it. If a layering rule trips, the aggregate subdirectory's depth or its imports are misconfigured. **Don't suppress the rule.**
- `verifySqlSchema`'s existing direct callers (test harnesses, runner-internal verification) breaking because of the renamed `pruneSchemaByOtherSpaceContracts`. The rename should be additive — `projectSchemaToSpace` is new; existing callers of the old function get re-pointed in commit 1. If any caller can't be repointed cleanly, the design has a gap; report.

## What to deliver

A 6-commit stack on `tml-2397-contract-space-aggregate` (a new branch off the amended M2 head) plus three force-pushed downstream branches (M3/M4/M5 rebased onto it). All gates green on each branch. Brief return summary of:

- Commit shas + 1-line message for each.
- Any deviations from this spec, with rationale.
- Any pre-existing flakes encountered (by test name).
- Confirmation that all 15 acceptance criteria above hold.
- Update to [`reviews/pr-438/code-review.md`](../reviews/pr-438/code-review.md) marking F00, F05, F09, F15, F23, F30 as **Closed** with the relevant commit shas.
- Update to [`projects/extension-contract-spaces/plan.md`](../plan.md) marking the milestone tasks `[x]` and recording landed commits.

If you discover, during execution, that a preserved finding (F11 — per-space `ensureControlTables`) actually closes naturally as a side-effect of the refactor (e.g. the new pipeline only opens one outer transaction per call), close it opportunistically and note it in the return summary. Don't take a side-quest to close it deliberately; the spec leaves it explicit-out-of-scope.
