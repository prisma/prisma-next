# Summary

Make migration routing aware of named data-transform invariants so that environment refs can declare *"reach hash H with invariants {X, Y} satisfied"* and the CLI picks a shortest path through the graph whose edges collectively provide that invariant set. When no such path exists, fail loudly with a diagnostic that names missing invariants and shows the structural path for context. Slot cleanly into the existing `findPath` / `findPathWithDecision` surface.

# Description

Today, routing between two contract hashes is a plain BFS over the edge graph: the structural endpoints determine the path, ties broken by a deterministic label/createdAt/migrationId ordering. That was enough while migrations were path-independent. Now that data-transform operations are first-class edge participants, two equal-length structural paths may produce different *data* outcomes depending on which data transforms they traverse.

The broader data-migrations work (see `data-migrations-spec.md`) tracks data-migration identity by a user-chosen `name` on `DataTransformOperation` — the retry/ledger identity the runner uses to decide whether a transform has already run against a database. That identity isn't automatically the right thing for the routing layer: not every data transform should be visible from refs (internal one-offs aren't environment-level guarantees), and coupling a display-friendly name to routing means a rename silently breaks every ref.

We split the two: `name` keeps its retry/ledger role; a new optional `invariantId?: string` on `DataTransformOperation` is the opt-in routing key. Presence means "this transform contributes to routing"; absence means "path-dependent, not referenceable from refs." Routing never reads `name`; retry/ledger never reads `invariantId`. See D4.

Today's `findPath(graph, from, to)` returns the shortest edge list structurally; `findPathWithDecision(…)` wraps it to add path-selection metadata (which candidate was chosen, how many alternatives existed, human-readable tie-break reasons) for `--json` output. "Decision" in that name means *selection metadata*, not *existence check*. This spec extends both: the path search becomes invariant-aware, and the decision struct gains `requiredInvariants` / `satisfiedInvariants`.

See **Slices and dependencies** below for the arc from today's structural routing to invariant-aware routing, and **Worked example** further down for the concrete shape.

# Slices and dependencies

**Today.** Routing is a plain structural BFS. Refs already live as per-file JSON each carrying `{ hash, invariants }` (see Prerequisites P1). But nothing downstream reads those invariants: the authoring surface doesn't let users declare invariant identity on a data transform, the graph doesn't propagate invariants through edges, the CLI's pathfinder can't route on them, and the database doesn't know what it's already seen. `ref.invariants` is a data field ahead of the machinery that consumes it.

**Destination.** `migration apply --ref prod` and `migration status --ref prod` resolve the ref, subtract what the database has already seen (`readMarker().invariants`) from `ref.invariants`, and hand the difference — `effectiveRequired` — to an invariant-aware pathfinder. If a covering path exists, apply takes it; if not, the CLI fails with `MIGRATION.NO_INVARIANT_PATH` listing what's missing and showing the structural fallback path. Monotonicity: once an invariant has been applied, repeat-applies against the same ref don't re-require it.

**Slices.** Each slice below is a cohesive change-set that compiles, typechecks, and can be reviewed on its own. Slice numbering lines up with the plan's milestones (M1–M4); the plan's M0 covers the ref-file refactor tracked in Prerequisites P1.

- **M1. The database remembers which invariants have been applied.** `prisma_contract.marker` grows `invariants text[]` (Mongo: field on the marker doc). The column lives in the `CREATE TABLE IF NOT EXISTS` DDL from the start — no compat shim for existing markers (consistent with the breaking `edgeId` change in F2; see §Schema evolution). The runner unions caller-supplied invariants into the column on every successful apply; `readMarker` returns the set. `ContractMarkerRecord.invariants: readonly string[]` is always present. No new SPI surface beyond the existing `readMarker`.
  - *Depends on:* nothing new (code-level independent of the P1 ref refactor, which motivates the need but is otherwise orthogonal).
  - *Enables:* M4's subtraction. Not user-visible until M4 lands.

- **M2. Edges declare invariants.** `invariantId?: string` on `DataTransformOperation` is the opt-in routing key; `name` keeps its retry/ledger identity. `migration.json` grows `providedInvariants: readonly string[]`, the attestation-covered aggregate. `MigrationChainEntry.invariants` propagates from the manifest at graph-reconstruction time.
  - *Depends on:* nothing new; orthogonal to M1.
  - *Enables:* M3.

- **M3. Pathfinder routes through required invariants.** `findPathWithInvariants(graph, from, to, required: ReadonlySet<string>)` returns the shortest path whose edges collectively cover `required`, or `null`. BFS over `(node, covered-set)` states with state-level dedup. When `required` is empty the result is byte-identical to today's `findPath`.
  - *Depends on:* M2 (edges must carry invariants for the primitive to consume).
  - *Enables:* M4.

- **M4. Wire it all together in the CLI.** `migration apply --ref` and `migration status --ref` compute `effectiveRequired = ref.invariants − marker.invariants` and route through the new pathfinder. Structured errors (`NO_INVARIANT_PATH`, `UNKNOWN_INVARIANT`) land with actionable `fix` text. Apply threads `manifest.providedInvariants` through `SqlMigrationRunnerExecuteOptions.invariants` so M1's marker union fires on each applied edge. Status displays required / applied / missing.
  - *Depends on:* M1, M2, M3.
  - *Delivers:* the end-user feature.

**Dependency graph.**

```
M1 ─────────────────────────────┐
                                ├──► M4
M2 ──► M3 ─────────────────────┘
```

M1 and M2 are independent — either can land first, neither blocks the other. M3 waits for M2. M4 is the integration slice and waits for M1, M2, and M3.

# Worked example

A team member adds a phone-number column to `users`, wants to enforce NOT NULL, and wants production to route through a backfill before reaching the new contract. They also have an internal cleanup transform in the same migration that's path-dependent and shouldn't be referenceable from refs.

**Authoring (`migrations/20260424T1030_add_phone_notnull/migration.ts`):**

```ts
import { addColumn, dataTransform, Migration, setNotNull } from '@prisma-next/target-postgres/migration';

export default class AddPhoneNotNull extends Migration {
  override describe() {
    return {
      from: 'sha256:…',
      to: 'sha256:…',
    };
  }

  override get operations() {
    return [
      addColumn('public', 'users', { name: 'phone', typeSql: 'text', nullable: true }),

      // Routing-visible — opt in via invariantId. Refs can require this.
      dataTransform('Backfill users.phone from legacy profile', {
        invariantId: 'backfill-user-phone',
        check: (db) => db.users.select('id').where((f, fns) => fns.isNull(f.phone)),
        run:   (db) => db.users.update({ phone: '' }).where((f, fns) => fns.isNull(f.phone)),
      }),

      // Path-dependent cleanup — no invariantId, not routing-visible.
      dataTransform('Strip trailing whitespace from existing display names', {
        check: (db) => db.users.select('id').where((f, fns) => fns.endsWith(f.displayName, ' ')),
        run:   (db) => db.users.update({ displayName: fns.trim(f.displayName) }),
      }),

      setNotNull('public', 'users', 'phone'),
    ];
  }
}

Migration.run(import.meta.url, AddPhoneNotNull);
```

The `dataTransform(name, { … })` factory's options object gains an optional `invariantId` field alongside the existing `check` / `run`. `name` stays positional and keeps its retry/ledger identity role.

After the migration self-emits (running `migration.ts` directly triggers the `Migration.run()` guard) and is attested, the resulting `migration.json` carries:

```jsonc
{
  "migrationId": "mid:sha256:…",
  "from": "sha256:…",
  "to":   "sha256:…",
  "providedInvariants": ["backfill-user-phone"],
  // …
}
```

Only `backfill-user-phone` makes it into `providedInvariants` — the whitespace-strip transform has no `invariantId` and is therefore invisible to routing.

**Declaring the ref (`migrations/refs/prod.json`):**

```json
{
  "hash": "sha256:…",
  "invariants": ["backfill-user-phone"]
}
```

**Applying (`prisma-next migration apply --ref prod`):**

```
→ prod
  required   backfill-user-phone
  active     (none)
  missing    backfill-user-phone
  route      empty → …a94b (1 edge)
                   └─ 20260424T1030_add_phone_notnull  provides [backfill-user-phone]
  apply ✓
```

If the ref had an invariant not declared by any migration:

```
✗ MIGRATION.UNKNOWN_INVARIANT

Ref "prod" declares invariants that no migration in the graph provides:
  unknown   ["backfill-user-status"]
  declared  ["backfill-user-phone"]

Fix: either the ref has a typo, or the declaring migration hasn't been
authored/attested yet. Re-check `migrations/refs/prod.json` and the
migrations under `migrations/`.
```

If the ref's invariants are all declared but the selected `(from, to)` path doesn't cover them:

```
✗ MIGRATION.NO_INVARIANT_PATH

Ref "prod" requires invariants the reachable path to sha256:…a94b doesn't cover:
  required  ["backfill-user-phone"]
  missing   ["backfill-user-phone"]

Structural path (what routing would pick ignoring invariants):
  empty → sha256:…a94b (1 edge)
    └─ 20260424T0900_add_posts_table  provides []

Fix: add a migration on this path that runs
`dataTransform({ invariantId: 'backfill-user-phone', … })`, or retarget
`prod` to a hash whose path already provides it.
```

# Marker invariants: the "applied-at-least-once" claim

A core semantic choice, called out up front because every downstream requirement and every piece of CLI output is shaped by it.

The database's set of applied invariants is stored in a single field on `prisma_contract.marker` (single-row table already used for current-state tracking) rather than in `prisma_contract.ledger` (append-only history). The field is populated by union on every successful `migration apply`: `marker.invariants = existingMarker.invariants ∪ manifest.providedInvariants`.

**`marker.invariants` means: "these invariantIds have been applied to this database at least once in its history."** Not "these invariants are currently true of the data." The distinction matters:

- **Applied-at-least-once** is a fact about the database's application history. A `migration apply` that successfully ran a data transform with `invariantId: 'X'` adds `X` to the set. Nothing else adds or removes it.
- **Currently-true-of-data** is answered by the data transform's own `check`. On every apply, the check fires; if the check reports violations, `run` fires again. The check is the sole authority for "does the data satisfy this invariant *right now*."

Two claims, two sources of truth. The CLI surfaces the first — "applied invariants" — because it's what invariant-aware routing needs: refs declare "route through a path that has applied X," not "route through a path where the data currently satisfies X." The second claim is implicit and per-apply, not materialised into any DB state.

## The design tension

The marker is idiomatically a **current-state** table (`storageHash`, `profileHash`, `updatedAt`). Putting a history claim there mixes concerns. Two alternative homes were considered and rejected for v1:

### Alternative 1 — ledger-side storage (rejected)

Add `migrationId` + `invariants` columns to `prisma_contract.ledger`. Each applied row records which invariants it contributed. CLI unions across rows to derive the applied set.

- **Pros.** Natural home for history. Per-migration provenance — "invariant X was first applied by migration M1 at T1, re-confirmed by M2 at T2" is answerable. Enables future audit / compliance use cases.
- **Cons.** Introduces a new `readLedger()` SPI method on `ControlFamilyInstance`. Requires `family-sql` to grow a read path with dialect-assumptions (`information_schema.tables` etc.). Mongo's ledger is write-only with a different shape (`{ edgeId, from, to, appliedAt }`, no `migrationId` / `invariants`); getting parity is TML-2283's territory and would force Mongo work into this spec's critical path. Touches 4+ packages for what should be one-column storage.
- **Why rejected.** The per-migration provenance is a capability the v1 routing layer doesn't consume — refs only need the set. Paying for provenance with a cross-family SPI rewrite ahead of any feature that uses it is premature.

### Alternative 2 — graph-derived snapshot (rejected)

Don't store the set anywhere. On each `migration apply` / `status`, walk `root → marker` in the graph and union declared `providedInvariants` from each edge on the structural path.

- **Pros.** Zero new DB state. Invariants live in `migration.json` and nowhere else.
- **Cons.** Assumes the DB actually traversed every edge on the root→marker path. `db update` violates this — it syncs the marker forward without going through migrations. The resulting set would claim invariants were applied when they weren't. This is structurally the same failure mode as TML-2130 (`deriveEdgeStatuses` inferring applied status from graph paths).
- **Why rejected.** Correctness-breaking for the `db update` flow, which is first-class.

### What the marker-side choice costs

**No per-migration provenance.** Under marker-side storage, `migration status` can say "invariants X, Y are applied" but not "X came from migration M1 on Tuesday." Users who want that audit trail will have to wait for the ledger's per-invariant provenance to be specced and built. v1 doesn't need it.

**Rollback doesn't automatically remove invariants.** Compensating migrations (a `B→A` edge that reverses `A→B`'s data changes) still add their own `providedInvariants` to the marker via union; they don't subtract the original edge's contribution. This is consistent with the "applied-at-least-once" definition — rolling back the data is a different event than never-having-applied-the-transform — but it can surprise users who read the marker as live-data-state.

Mitigation: the data transform's `check` remains authoritative for current data state. On re-apply after rollback, if the data was actually reverted, `check` reports violations and `run` fires again. The marker's claim stays monotonic; the data's correctness is re-verified every apply. Authors don't have to reason about marker semantics to get retry-safety right — it's a property of the check, which already exists for unrelated reasons.

**No explicit "revoke" story.** A compensating migration that wants to declare "I am removing X from the applied set" has no field for that today. If demand materializes, `DataTransformOperation.revokesInvariantIds?: readonly string[]` is a small additive change. Out of scope for v1.

### Why this is OK for v1

Refs declare "this environment requires `[X, Y]`" and routing's job is to select a path that applied them. The applied-at-least-once reading answers exactly that question: if X is in `marker.invariants`, the DB has been subjected to X's transform, and its data-state is being policed by the transform's check on every apply. The stronger "currently satisfies X" claim isn't what refs are for.

If product use cases later demand stricter semantics or provenance, the escape hatches are:
- Promote the ledger from optional audit trail to source of truth for applied invariants (restores Alternative 1's capabilities).
- Add `revokesInvariantIds` for explicit compensating migrations.
- Add a family-specific verification pass that re-runs all known checks and asserts "data satisfies marker.invariants."

None are needed for v1.

## Schema evolution (existing deployments)

No compat shim. This spec already commits to a breaking `edgeId` change (see F2 *Upgrade impact*) that requires consumers to re-attest their migrations and re-apply against a fresh database. In that flow the marker is created fresh via `CREATE TABLE IF NOT EXISTS` with the `invariants` column in the DDL from the start — there is no in-place marker to migrate.

**Postgres / SQL family.** Add `invariants text[] not null default '{}'` to the `CREATE TABLE IF NOT EXISTS prisma_contract.marker` DDL. Do **not** ship an idempotent ALTER or a column-existence probe in `readMarker`. A user who skips the recommended re-apply and runs the new CLI against an old marker will get a clear SQL error (`column "invariants" does not exist`); the fix is a one-line ALTER they can paste, or simply re-applying as directed.

Consistent with the rest of the spec's upgrade story: we're prerelease/internal; we haven't had real users; adding compat machinery for a scenario we've asked consumers not to be in is solving a problem nobody has.

**Mongo family.** No DDL concept. `readMarker` reads `doc.invariants ?? []`; `updateMarker` unions with `$set: { invariants: newUnion }`. Existing marker documents without the field transparently read as empty — not a compat shim, just natural schema-less behaviour. No migration needed.

**What this does not handle.** If a user somehow ends up with a *newer* CLI reading a marker row whose column exists but whose data is malformed (non-array, unknown type), the Arktype validator at the storage boundary throws. That's correct — data corruption is not something we silently paper over.

# Prerequisites

## P1. Ref file refactor — per-file layout with invariants **(completed ahead of this spec)**

The ref storage moved from a single `migrations/refs.json` file to a per-ref directory layout at `migrations/refs/<name>.json`. Each ref file now carries a structured `RefEntry`:

```ts
export interface RefEntry {
  readonly hash: string;
  readonly invariants: readonly string[];
}
```

Migration-tools exposes `readRef(refsDir, name)`, `readRefs(refsDir)`, `writeRef(refsDir, name, entry)`, `deleteRef(refsDir, name)`, and `resolveRef(refs, name)`. Validation is Arktype-backed; file layout is content-addressable-friendly; deletion walks empty parent directories. CLI commands that act on refs (`migration ref set/list/rm`, `migration apply --ref`, `migration status --ref`) have been updated to use the per-file API.

Without this, there's nowhere to declare per-ref required invariants — every downstream milestone in this spec assumes `ref.invariants` exists and is readable.

**Status:** landed. Tracked as M0 in the plan for delivery-continuity; the spec treats it strictly as a prerequisite.

## P2. Rename `dag.ts` → `graph.ts`

The file contains BFS primitives, `MigrationGraph` operations, cycle detection, and reverse-reachability. "DAG" is narrower than what this module actually does (cycles are detected, not forbidden). "graph" is more accurate. Mechanical rename plus `test/dag.test.ts` → `test/graph.test.ts` and updated re-exports in `src/exports/dag.ts` (the export path may stay `./dag` or follow the rename — caller impact to be assessed).

The routing work assumes the new name throughout. Landing this rename first keeps the routing diff small and focused; doing it after entangles the routing diff with unrelated cleanup.

**Status:** not yet landed.

## P3. Rename `MigrationChainEntry` → `MigrationEdge`

The type is used exclusively as a graph edge: it has `from` and `to` endpoints, is stored in neighbour-indexed maps, is returned as edge lists from `findPath` / `detectOrphans`, and every local variable that holds one is already named `edge` / `edges` / `incomingEdge`. `ChainEntry` is legacy from the pre-graph linear-chain era and actively misleads readers. `MigrationEdge` matches the implementation vocabulary and contrasts cleanly with `graph.nodes` (the contract-hash set). Not `AppliedMigration` — the type represents attested (on-disk, content-addressed) migrations, not migrations that have been applied to a database. Not `MigrationPathNode` — this is an edge, not a node.

Rename affects: the type declaration, every call site, every test, and any documentation references. Landing this first keeps the routing diff mechanical.

**Status:** not yet landed.

# Requirements

## Functional Requirements

**F1. `invariantId?: string` on `DataTransformOperation` is opt-in routing identity.** `DataTransformOperation` gains an optional `invariantId?: string`. Presence opts the transform into routing visibility; absence means the transform is a path-dependent one-off that the routing layer doesn't reason about. `name` keeps its existing role (retry/ledger identity, display-friendly). `invariantId` is a separate, stable, routing-only key — authored content that participates in `edgeId` / attestation alongside `check` and `run`. Format rule: lowercase ASCII, digits, hyphens, slashes for namespacing — same pattern `refs.ts` uses for ref names (`REF_NAME_PATTERN`). Verify fails with `MIGRATION.INVALID_INVARIANT_ID` on a malformed id.

**F2. `providedInvariants` on `migration.json` is the attestation-covered aggregate.** Each migration's `migration.json` manifest gains `providedInvariants: readonly string[]` — the sorted, deduplicated list of `invariantId`s from the migration's data transforms. Producer/checker split:

1. **Emit** derives `providedInvariants` from the migration's ops (filter `operationClass === 'data'` + `invariantId !== undefined`, collect `invariantId`, sort, dedupe) and writes it into `migration.json`.
2. **Verify** re-runs the derivation from `ops.json` and fails with `MIGRATION.PROVIDED_INVARIANTS_MISMATCH` if the manifest's stored copy disagrees. This is in addition to the standard `edgeId` hash check — both protect against tampering, but the dedicated mismatch error gives authors a targeted diagnostic.

Because `migration.json` is part of the `edgeId` hash, tampering with `providedInvariants` also breaks attestation. Downstream consumers (graph reconstruction, `migration list`, CI checks) read the manifest-level aggregate rather than re-parsing `ops.json`. Verify **fails** with `MIGRATION.DUPLICATE_INVARIANT_IN_EDGE` if two ops on the same migration declare the same `invariantId` — both the ledger and routing semantics collapse otherwise.

**Upgrade impact (breaking).** Adding `providedInvariants` to the canonical `migration.json` form changes every existing migration's `edgeId` on re-verify. Consumers must re-run `migration verify` across their migrations directory; ledger rows that reference pre-upgrade `edgeId`s are no longer addressable by the new hash and must be re-applied against a fresh database (or the ledger manually updated). Acceptable because all consumers today are prerelease/internal.

**F3. Invariants flow through edges.** `MigrationChainEntry` carries `invariants: readonly string[]`, populated at `reconstructGraph` time from `pkg.manifest.providedInvariants`. No re-derivation from ops; the manifest is the source of truth. An edge whose migration has no invariant-bearing data transforms has `invariants: []`.

**F4. Invariant-aware shortest-path search.** A new pathfinder, `findPathWithInvariants(graph, from, to, required: ReadonlySet<string>): readonly MigrationChainEntry[] | null`, returns the shortest path from `from` to `to` that collectively covers every required invariant — every name in `required` must appear in at least one edge's `invariants` on the path. "Shortest" = fewest edges. When `required` is empty, the result is identical to today's `findPath`. `findPath` can be reimplemented as `findPathWithInvariants(graph, from, to, new Set())`; the spec treats them as equivalent in behaviour.

**F5. `findPathWithDecision` surfaces invariant state.** `PathDecision` carries `requiredInvariants: readonly string[]` (the caller-supplied ask) and `satisfiedInvariants: readonly string[]` (the required invariants that the selected path actually provides). Both fields are always present on the decision — empty arrays when no invariants were in play. Per-edge invariants live on each `MigrationChainEntry` in `selectedPath`, so consumers that want to know *which* edge provided a given invariant do a direct lookup on `selectedPath`. We do not add a redundant `providedBy` map.

**F6. Hard error on unsatisfiable.** When `required` is non-empty, `from`→`to` is structurally reachable, and no satisfying path exists, the pathfinder returns `null` and callers raise `MIGRATION.NO_INVARIANT_PATH` with: `refName` (optional), `required: readonly string[]`, `missing: readonly string[]`, and `structuralPath` — the edges `findPath(graph, from, to)` would have returned, included for diagnostic context. Each edge in `structuralPath` carries its own `invariants` (same shape as `selectedPath` elsewhere), so consumers can compute what the structural path *does* provide without a separate field. If `from`→`to` is not structurally reachable at all, callers raise the pre-existing no-path error, not `NO_INVARIANT_PATH`.

**F7. Integration with `migration apply` and `migration status`.** When the user passes `--ref <name>`, the command resolves the ref, computes the effective required set as `ref.invariants − marker.invariants` (see F11–F14 for the `ContractMarkerRecord`, runner, and CLI wiring), and threads the effective set into the pathfinder. `migration status` displays per-edge invariants in the tree view and surfaces required / applied / missing sets when `--ref` is used. `migration apply` refuses if the resolved path's invariants don't cover the effective required set (the pathfinder already guarantees this; the CLI re-asserts as a defensive check).

**F8. Determinism.** For a given graph + from + to + required, the returned path is identical across runs (same edges selected, same tie-break resolution). When multiple equal-length paths satisfy the required set, the existing deterministic tie-break (labelPriority → createdAt → to → migrationId) decides. No new preference keys — the invariant system is itself the channel users use to disambiguate semantically-different-but-structurally-equivalent paths.

**F9. No behaviour change when no invariants are required.** Every existing caller that does not thread invariants sees the same routing outcome, the same exit code, and no new pre-existing output rows. "Behaviour" here means routing outcome + exit code + existing output structure, not bit-for-bit CLI text. New pathfinder is a functional superset of the old one.

**F10. Marker table stores the applied-invariants set.** `prisma_contract.marker` gains an `invariants text[] not null default '{}'` column (SQL) / field (Mongo, schemaless). The column sits in the `CREATE TABLE IF NOT EXISTS` DDL from the start (no compat shim — see §Schema evolution). The column is populated by union: on every successful `migration apply`, the runner sets `marker.invariants := existingMarker.invariants ∪ manifest.providedInvariants`, atomic with the marker hash update inside the existing `upsertMarker` transaction. `db update` and other marker-only flows pass `invariants: []` — the union is a no-op, the existing set is preserved.

**F11. `ContractMarkerRecord.invariants` is always present.** The framework-level `ContractMarkerRecord` type (in `@prisma-next/contract/types`) gains `invariants: readonly string[]`, never undefined. Both families' `readMarker` implementations populate it:
- **family-sql** projects the column into the returned record. No existence probe, no fallback: the column is in the `CREATE TABLE IF NOT EXISTS` DDL, and consumers coming from an older internal release re-apply against a fresh database per the F2 upgrade story.
- **family-mongo** reads `doc.invariants ?? []` from the marker document. Absence-of-field is natural schema-less behaviour, not a compat shim.

No new SPI method. `ControlClient.readMarker()` is already wired through both families; CLI consumers receive `invariants` alongside the existing fields.

**F12. Runner unions `options.invariants` into the marker on apply.** `SqlMigrationRunnerExecuteOptions` gains `invariants?: readonly string[]` (default `[]`). On apply, the runner:

1. Reads `existingMarker.invariants` (already read for origin validation).
2. Computes `newInvariants = existingMarker.invariants ∪ options.invariants` (set union, stable-sorted for deterministic on-disk ordering).
3. Passes `newInvariants` to `buildWriteMarkerStatements` as a new field on `WriteMarkerInput`.
4. The marker write and the rest of the apply (operations, ledger append) all commit together.

The Mongo runner does the equivalent: `readMarker` → union → `updateMarker({ …, invariants: newInvariants })`. Same atomicity guarantees the marker update already provides.

Callers supply `options.invariants`: the CLI reads `manifest.providedInvariants` from the migration being applied and passes it through. For `db update` / marker-only flows the caller omits the option (defaults to `[]`, union is a no-op).

**F13. Effective required set subtracts applied invariants.** In the CLI (apply + status), before calling the pathfinder, call `family.readMarker()`, compute `appliedInvariants = marker.invariants ?? []`, and set `effectiveRequired = ref.invariants − appliedInvariants`. Pass `effectiveRequired` to `findPathWithInvariants`. Consequence: re-applying a ref whose invariants include an invariant already in `marker.invariants` routes as if that invariant were not required — no spurious `NO_INVARIANT_PATH`, monotonicity honoured.

**F14. `migration status --ref` surfaces the three invariant sets.** When a ref is resolved, the status output (both human and JSON) displays:
- *Required* — from `ref.invariants`.
- *Applied* — from `marker.invariants`, intersected with `required` for display relevance.
- *Missing* — `required − applied`. This is the effective set passed to the pathfinder.

Vocabulary: "applied" (not "active") — it's the right reading under the applied-at-least-once semantic. The data transform's `check` is what users look at to verify current data state; the status output is deliberately not making that stronger claim.

**F15. `UNKNOWN_INVARIANT` pre-check (apply + status, fatal in both).** Before `migration apply --ref <name>` or `migration status --ref <name>` calls the pathfinder, it collects the set of `invariantId`s declared anywhere in `graph.forwardChain.values()` and verifies that every id in `ref.invariants` appears in that set. Any id that doesn't causes `MIGRATION.UNKNOWN_INVARIANT` with the unknown names listed; both commands exit 1 before the pathfinder runs (and, for apply, before touching the database). A misconfigured ref surfaces loudly and consistently across commands. This separates "typo / missing transform" diagnostics from "exists but not on this path" (which stays `NO_INVARIANT_PATH`). As a consequence, every call to `findPathWithInvariants` receives a `required` set whose ids are all declared in the graph.

## Errors

The following structured errors (all subtypes of `MigrationToolsError`) are introduced or enumerated by this spec. Each carries the shape the rest of the error catalogue uses (`code`, `message`, `why`, `fix`, `details`, `category: 'MIGRATION'`). Every error surfaces in both human output and `--json` envelopes.

- **`MIGRATION.INVALID_INVARIANT_ID`** (verify-time). A data-transform op declares an `invariantId` that doesn't match the format rule (lowercase ASCII, digits, hyphens, slashes). `fix` names the offending value and the pattern.
- **`MIGRATION.DUPLICATE_INVARIANT_IN_EDGE`** (verify-time). Two ops in a single `migration.ts` declare the same `invariantId`. The marker's set-semantic collapses them, and the `providedInvariants` aggregate would lose the duplication detail; neither outcome is what the author wants. `fix` names the conflicting ops and suggests renaming one.
- **`MIGRATION.PROVIDED_INVARIANTS_MISMATCH`** (verify-time). `migration.json`'s `providedInvariants` disagrees with the list derived from `ops.json`. Typically means `migration.json` was hand-edited without regenerating from ops (the `edgeId` hash would also catch this, but the dedicated error gives a targeted diagnostic). `details` names the stored set, the derived set, and their difference; `fix` says to re-emit the migration.
- **`MIGRATION.UNKNOWN_INVARIANT`** (pre-check; fatal in both apply and status). A ref's `invariants` list references an id that no migration in the graph declares. Both `migration apply --ref` and `migration status --ref` run the same check and exit 1 before the pathfinder runs. `details.unknown` lists the unknown ids; `details.declared` lists what's available. `fix` says either the ref has a typo or the declaring migration hasn't been authored/attested yet.
- **`MIGRATION.NO_INVARIANT_PATH`** (pathfinder-time). `from`→`to` is structurally reachable, but no path covers `required`. `details` carries `required`, `missing`, and `structuralPath` (what `findPath(graph, from, to)` would pick ignoring invariants, with each edge's `invariants` attached so consumers can compute what the fallback path provides).

The structural-unreachable case still raises the pre-existing `MIGRATION.NO_TARGET` / no-path error, not `NO_INVARIANT_PATH`.

## Non-Functional Requirements

**N1. Complexity ceiling.** The pathfinder runs in `O((V + E) · 2^k)` worst case, where `k` is the number of required invariants — each node can be reached once per distinct covered set. Realistic graphs don't come anywhere near this bound: invariants are rare, graphs are mostly linear with a few branches, and coverage along the BFS frontier is effectively monotone. We expect `k` in the single digits and the per-node state count to sit at 1–2 for realistic shapes. Well under the 5 ms budget from the graph-perf memo.

**N2. Bounded `k`.** We expect `k` to be small (single-digit). No explicit guard; revisit if this assumption breaks. A benchmark will establish concrete numbers before any guard is introduced — picking a threshold without data is worse than picking none.

**N3. CI impact.** Roughly one test file for the pathfinder, plus additions to `dag.test.ts` and CLI integration tests. Negligible.

## Non-goals

- **Maximality preference** — when no invariants are required, we do *not* bias toward paths with more invariants. Plain structural shortest path.
- **Ledger recording of applied invariants.** Covered by the broader data-migrations work; the routing layer only consumes static graph data.
- **`--no-invariant-check` / escape hatch.** If a user wants to override, they edit the ref (drop or edit the `invariants` list).
- **Rollback / reverse-direction invariant semantics.** Invariants are declared forward-monotonic.
- **CLI surface for editing `ref.invariants`.** Edit JSON manually for v1.

# Pathfinder algorithm

BFS over the graph, but each search entry carries a "covered" set of invariants alongside the current node. Start at `from` with an empty covered set. When the BFS traverses an edge, add any of that edge's invariants that are in the required set to the covered set. The search succeeds as soon as it reaches `to` with every required invariant in the covered set.

**State-level dedup is required for correctness.** Track visited `(node, covered-set)` pairs, not just visited nodes. A second arrival at the same node with a different covered set may lead to a satisfying path the first arrival couldn't — node-only dedup would miss it. Concrete counter-example: two edges out of `A`, one providing `X` and one providing `Y`, both leading to `D`; then `D→E→F` with `E` also providing `X`. Required: `{X, Y}`. Only the path through the `Y`-providing edge satisfies — node-only dedup at `D` would pick the `X` arrival first and never explore the `Y` one.

**No dominance pruning.** We don't skip a new arrival at a node just because an earlier arrival covered a superset of what this one covers. That optimisation targets a state-space blowup realistic graphs don't produce — invariants are rare, graphs are mostly linear, and each node in practice gets reached once or twice.

Edges whose invariants don't overlap the required set are "free": they advance the node without changing the covered set, so purely structural segments cost nothing.

When no satisfying route is reachable but `from`→`to` is structurally reachable, the pathfinder returns `null` and the caller builds a `NO_INVARIANT_PATH` error that includes the structural-only path (what today's `findPath` returns) for diagnostic context. Computing the structural path is a separate cheap BFS.

Neighbour ordering within each level: when the required set is non-empty, prefer edges that cover at least one still-needed invariant; fall back to today's `labelPriority → createdAt → to → migrationId` tie-break. When the required set is empty, use today's ordering unchanged.

# Decisions

**D1. No maximality preference.** When no invariants are required, fall back to the existing structural shortest-path. No bias toward "more invariants" paths.

**D2. Tie-break = existing deterministic ordering.** Paths of equal length that all satisfy `required` are treated as structurally indistinguishable. Users who want a semantically different path selected should declare a different invariant on that path; the invariant system is itself the disambiguation channel.

**D3. `NO_INVARIANT_PATH` diagnostics = structural path.** When the required set can't be satisfied but `from`→`to` is structurally reachable, the error carries the structural path (what `findPath` returns, ignoring invariants). This answers "the hash is reachable, but along the only path(s) your required invariants aren't provided." If `from`→`to` isn't structurally reachable, fall through to the existing no-path error.

**D4. Opt-in routing identity via a separate `invariantId?: string`.** `DataTransformOperation` gains an optional `invariantId?: string`. Presence opts the transform into routing visibility; absence means the transform is a path-dependent one-off the routing layer doesn't reason about. `name` keeps its existing role (retry/ledger identity, display-friendly); it does not double as a routing key. This amends D2 in `data-migrations-spec.md`.

Opt-in — not opt-out — because a data transform isn't automatically an environment-level guarantee: a NOT NULL backfill on a fresh database has no data to fix and shouldn't pollute every env's ref. Consequences:

- `invariantId` is authored content and participates in `edgeId` alongside `check` and `run`.
- Renaming `name` never breaks a ref. Renaming `invariantId` is a deliberate, reviewable act with a clear blast radius.

**D5. Public API: `findPathWithInvariants` is primary.** `findPathWithInvariants(graph, from, to, required)` is the new pathfinder. `findPath(graph, from, to)` continues to exist; it's either reimplemented as `findPathWithInvariants(graph, from, to, new Set())` or kept as a thin fast-path delegating to the same machinery. Either way, behaviour for existing callers is byte-identical.

**D6. Multi-edge provision of the same invariant is allowed.** A given invariant `X` may appear on multiple edges along a path (different migrations can reach the same target via different structural routes that both run an `X`-declaring transform). We don't reject this. Routing treats subsequent providers as no-ops — once `X` is in the covered set, further edges providing `X` don't change state. Consumers that need "which edge introduced `X`?" walk `selectedPath` directly and find the first edge whose `invariants` includes `X`.

**D9. `PathDecision` stays minimal — no derived fields.** `PathDecision` gains only `requiredInvariants` and `satisfiedInvariants`. Any finer-grained view — which edge provided which invariant, what the structural fallback path provides, etc. — is recoverable from the per-edge `invariants` on `selectedPath`/`structuralPath`. The slim JSON view of each edge (`toPathDecisionResult` in `command-helpers.ts`) gains `invariants: string[]` so the JSON envelope preserves this.

**D10. State-level dedup only; no dominance pruning.** The BFS tracks visited `(node, coveredSubset)` pairs with strict equality — skip only if the exact state was already enqueued. We do not prune arrivals whose coverage is a strict subset of an already-seen coverage at the same node. See the Pathfinder algorithm for why node-only dedup is incorrect and why the strict-subset pruning isn't worth its complexity cost on realistic graphs.

**D11. Neighbour ordering prefers invariant-covering edges when `required ≠ ∅`.** When `required` is non-empty, the BFS's neighbour sort uses a primary key "edge's `invariants` intersect the still-needed set" (edges that cover at least one still-needed invariant come first), with the existing `labelPriority → createdAt → to → migrationId` ordering as the secondary key. When `required = ∅`, the ordering is unchanged from today's `findPath` — preserving F8 (same routing outcome for existing callers). This is a heuristic that steers BFS toward the satisfying path in typical graphs; it doesn't affect correctness, only which equal-length satisfying path is selected when multiple exist.

Determinism: the neighbour sort key at a state `(node, covered)` is a pure function of that state — the still-needed set is `required − covered`, and the remaining keys (`labelPriority → createdAt → to → migrationId`) are edge-intrinsic. BFS explores level-by-level, so first arrival at each `(node, covered)` is deterministic given a fixed graph, and state-level dedup discards later arrivals. The selected path is therefore a function of `(graph, from, to, required)` alone.

**D12. The target tuple is `(hash, requiredInvariants)`; `findLeaf` / `findLatestMigration` stay structural because they're one way to construct that tuple.** Routing's contract is:

> Given an origin and a destination `(hash, requiredInvariants)`, find the shortest path from origin to `hash` that collectively covers `requiredInvariants`.

Refs construct the tuple as `(ref.hash, ref.invariants)`. `--to <hash>` constructs `(hash, [])`. Omitting both flags uses `findLeaf`'s structural-tip result and implies `requiredInvariants: []`. In every case invariants are fully explicit — empty when the user didn't declare any. `findLeaf` and `findLatestMigration` therefore don't need invariant awareness; they produce the hash half of the tuple, and the empty-invariants half is the correct default for a user who said nothing about requirements.

CLI output preserves existing behaviour when no ref is in play: `migration status` and `migration apply` without `--ref` print what they print today, unchanged. With `--ref`, the output annotates the regime (`ref: prod (hash=…, required=[X,Y])`) so the user sees what requirements are live — the annotation is additive output rendered alongside the new invariant rows, scoped to the regime where regime-confusion is actually possible.

Edge case: if the graph has multiple tips and no flag is given, `findLeaf` throws `AMBIGUOUS_TARGET` regardless of any invariants the user might have cared about — they must pick a tip via `--ref` or `--to` first, and the tuple then carries whatever invariants that choice implies.

# Acceptance Criteria

Grouped by concern. Ordering/chunking decided separately from this spec.

## Authoring + attestation

- [ ] `DataTransformOperation.invariantId?: string` exists on the type
- [ ] Verify accepts a data-transform with `invariantId` unset (treats as non-routing-visible) and with `invariantId` set to a valid value
- [ ] Verify fails with `MIGRATION.INVALID_INVARIANT_ID` on a malformed id (e.g. uppercase, whitespace, starts with hyphen)
- [ ] Verify fails with `MIGRATION.DUPLICATE_INVARIANT_IN_EDGE` when two ops in one `migration.ts` declare the same `invariantId`
- [ ] `migration.json` gains `providedInvariants: readonly string[]` — sorted ascending, deduplicated, never undefined
- [ ] **Emit** writes `providedInvariants` into `migration.json` derived from ops (filter `operationClass === 'data'` + `invariantId !== undefined`, collect `invariantId`, sort, dedupe) — no code path tolerates the field being missing at reconstruct-time
- [ ] **Verify** re-derives `providedInvariants` from `ops.json`; a mismatch with the manifest's stored copy raises `MIGRATION.PROVIDED_INVARIANTS_MISMATCH` with `details.stored`, `details.derived`, and `details.difference`
- [ ] `providedInvariants` participates in `edgeId` / attestation hash (tampering with the manifest copy also breaks hash verification — independent integrity layer)

## Edge-level invariants

- [ ] `MigrationChainEntry.invariants` is `readonly string[]`, always defined, sorted ascending, deduplicated
- [ ] `reconstructGraph` populates `MigrationChainEntry.invariants` directly from `pkg.manifest.providedInvariants` — no re-derivation from ops
- [ ] Unit tests cover: manifest with no invariants → empty; manifest with one; manifest with multiple (sorted); graph built from mixed attested bundles (some with invariants, some without)

## Pathfinder primitive

- [ ] `findPathWithInvariants(graph, f, t, new Set())` returns exactly the same edge list as `findPath(graph, f, t)` — verified across a panel of representative graphs
- [ ] Given a one-required-invariant graph where one route provides it and another doesn't, the pathfinder selects the providing route
- [ ] Given no satisfying route, returns `null`
- [ ] Among multiple same-length satisfying paths, returns the one picked by existing tie-break ordering
- [ ] State-level dedup: arrivals at the same `(node, coveredSubset)` are deduplicated; arrivals with a different subset at the same node are *not* skipped (verify via a targeted test using the counter-example graph from the Pathfinder algorithm)
- [ ] Neighbour ordering (D11): when some invariants are required, edges whose `invariants` overlap the still-needed set are explored before edges that don't; when none are required, the order matches today's `findPath` exactly
- [ ] **Critical evaluation step**: before declaring the pathfinder done, walk through the common and pathological graph shapes (see "Graph shapes to evaluate" below) and verify each is handled correctly — not just the unit cases

## Decision metadata + error surface

- [ ] `PathDecision` always carries `requiredInvariants: readonly string[]` and `satisfiedInvariants: readonly string[]` (both default to `[]`)
- [ ] `satisfiedInvariants` equals the intersection of `requiredInvariants` with the union of every edge's `invariants` on the selected path — always consistent with `selectedPath`, never independently computed
- [ ] The slim JSON view from `toPathDecisionResult` includes `invariants: string[]` on each edge entry so the full information is preserved in `--json` output
- [ ] `MIGRATION.NO_INVARIANT_PATH` error includes: `refName` (optional), `required: readonly string[]`, `missing: readonly string[]`, `structuralPath: readonly { dirName, migrationId, from, to, invariants }[] | null`
- [ ] When `from`→`to` is not structurally reachable, the error is the pre-existing `NO_TARGET`/no-path error, not `NO_INVARIANT_PATH`
- [ ] Error `fix` names a concrete action (e.g. "add a migration edge that runs `dataTransform({ invariantId: 'X', … })`")
- [ ] JSON envelope (`--json`) includes the full decision / error payload

## Unknown-invariant pre-check

- [ ] Both `migration apply --ref <name>` and `migration status --ref <name>` collect `invariantId`s from `graph.forwardChain.values().map(edge => edge.invariants).flat()` and fail with `MIGRATION.UNKNOWN_INVARIANT` if any id in `ref.invariants` isn't present
- [ ] `UNKNOWN_INVARIANT` fires *before* the pathfinder runs and *before* any DB state changes; exit 1 with structured error in both commands
- [ ] No call to `findPathWithInvariants` receives a `required` set containing an id that isn't declared in the graph (guaranteed by the pre-check)
- [ ] Integration test: ref references an id that no migration declares → both apply and status fail with `UNKNOWN_INVARIANT` (not `NO_INVARIANT_PATH`)
- [ ] Integration test: ref's ids are all declared but the `from → ref.hash` path doesn't cover them → `NO_INVARIANT_PATH` (not `UNKNOWN_INVARIANT`) — preserves the semantic carve-up

## Marker-side applied-invariants storage (both families)

- [ ] `prisma_contract.marker` has `invariants text[] not null default '{}'` in the `CREATE TABLE IF NOT EXISTS` DDL (Postgres, exported from `statement-builders.ts`)
- [ ] No idempotent ALTER, no column-existence probe in `readMarker` — see §Schema evolution. Consumers with a pre-upgrade marker re-apply against a fresh database per the F2 upgrade story.
- [ ] Mongo marker doc: `readMarker` returns `doc.invariants ?? []`; `updateMarker`/`initMarker` write the `invariants` field with the union value
- [ ] `ContractMarkerRecord.invariants: readonly string[]` added to `@prisma-next/contract/types`; always present, never undefined
- [ ] `SqlMigrationRunnerExecuteOptions.invariants?: readonly string[]` (default `[]`) — the runner sink for caller-supplied `manifest.providedInvariants`
- [ ] Runner reads `existingMarker.invariants`, unions with `options.invariants`, passes the result to `buildWriteMarkerStatements` (new `invariants` field on `WriteMarkerInput`) — all within the existing apply transaction
- [ ] Mongo runner does the equivalent via `readMarker` → union → `updateMarker`/`initMarker`
- [ ] `db update` / `db init` marker-only flows pass `invariants: []`; the union is a no-op and the existing set is preserved
- [ ] Unit tests: runner writes `invariants` on success; `readMarker` returns what was written
- [ ] Unit test: repeated apply accumulates invariants monotonically (never shrinks)
- [ ] Integration test: Mongo marker doc without the field reads as `invariants: []` (natural schema-less behaviour, not a compat shim)

## CLI integration

- [ ] `migration apply --ref <name>` computes effective required set (`ref.invariants` minus `marker.invariants` from `readMarker()`) and threads into the pathfinder; exit 0 when covered, exit 1 + `NO_INVARIANT_PATH` when not
- [ ] `migration status --ref <name>` displays selected path with per-edge invariants in tree view, plus the required / applied / missing sets (vocabulary: "applied", not "active")
- [ ] `migration status --json --ref <name>` includes `requiredInvariants`, `satisfiedInvariants`, `appliedInvariants`, `missingInvariants`, and per-edge `invariants` on each `selectedPath` entry
- [ ] Re-apply of the same ref after state changes (invariant already in marker) subtracts from required and routes correctly — no spurious `NO_INVARIANT_PATH`
- [ ] Invocations without `--ref` (and refs whose `invariants` list is empty) select the same path, produce the same exit code, and don't gain new output rows beyond those needed to render the (empty) invariant state — the mode annotation from D12 appears only when `--ref` is used
- [ ] Existing integration tests (no `--ref` or refs without invariants) pass unchanged

# Graph shapes to evaluate

Named test graphs to walk through before declaring the pathfinder shippable. The spec lists them so we don't hand-wave at review time. Each shape gets a unit test; some will also be covered by property-style generation.

**Common shapes**

- *Linear spine, no invariants required*: plain `findPath` equivalence.
- *Linear spine, invariants along the way*: required set matches; path equals spine.
- *Diamond with one detour invariant*: `A→B→D` (free) and `A→C→D` where `C→D` provides `X`. Require `X` → picks `A→C→D`.
- *Long free spine + required detour*: linear `A→…→Z` with a side edge that provides `X`. Require `X` → takes the detour.
- *Two required invariants on different edges*: must pick the path containing both.
- *Required invariant provided by multiple edges on the same path*: path selection is unaffected; each provider edge carries the invariant on its `invariants` list.

**Failure shapes**

- *Unreachable target*: `from`→`to` doesn't exist → pre-existing `NO_TARGET`/no-path error (not `NO_INVARIANT_PATH`).
- *Target reachable but invariant missing everywhere*: require `X`, no edge in the graph declares it → `NO_INVARIANT_PATH` with `structuralPath` populated.
- *Invariant exists elsewhere but not on any `from`→`to` path*: → `NO_INVARIANT_PATH`.
- *Partial satisfaction*: require `{X, Y}`, every path covers `X` or `Y` but not both → `NO_INVARIANT_PATH` with `missing` listing the unreachable half.

**Pathological shapes**

- *Dense graph with many required invariants*: checks the `2^k` state-space worst case.
- *Cycles on free edges*: must not loop forever.
- *Cycles on invariant-providing edges*: likewise.
- *Graph with required invariant only provided via a cycle*: the BFS must find the single acyclic satisfying path, not loop.
- *Disconnected invariant providers*: edge that declares `X` lies in a component unreachable from `from`.

# Other Considerations

## Security

Invariant IDs are strings and flow from `migration.ts` → `ops.json` → `MigrationChainEntry`. Compared by equality only; no eval, no path resolution. No new attack surface.

## Cost

Zero runtime cost in production — the pathfinder runs CLI-side, not in app hot paths. Test suite gains maybe a few dozen assertions; CI impact negligible.

## Observability

- `--verbose`: log required set, selected path, providing-edge map.
- `--trace`: full state-space exploration for debugging unsatisfiable cases.
- `MIGRATION.NO_INVARIANT_PATH` is a structured error; trace collector captures details.

## Data Protection

Invariant IDs aren't personal data. No impact.

## Analytics

None. Routing is CLI-local.

# References

- `projects/graph-based-migrations/specs/data-migrations-spec.md` — Broader data-migrations spec. This spec implements the routing slice and amends decision D2 there: `name` keeps its retry/ledger role; a new optional `invariantId?: string` is the opt-in routing identity.
- `packages/1-framework/3-tooling/migration/src/dag.ts` — Current pathfinder surface. To be renamed `graph.ts` as a prereq.
- `packages/1-framework/3-tooling/migration/src/refs.ts` — `RefEntry`, `readRefs`, `resolveRef`; already carry invariants (landed ahead of this spec; technically a prerequisite).
- `packages/1-framework/1-core/framework-components/src/control-migration-types.ts` — `DataTransformOperation`; to gain `invariantId?: string` (opt-in routing identity).
- ADRs 039 (graph model), 195 (planner IR).
- TML-2130 — *deriveEdgeStatuses uses graph path instead of ledger for applied status*. Independent follow-up; not bundled into this spec (marker-side storage of applied invariants doesn't require a ledger read path). See Deferred.

# Open Questions

*None blocking. Deferred list below captures everything parked.*

# Deferred

Parked explicitly — not blocking, revisit once the routing layer is in and we have data.

- **Max required-set size.** `Set<string>` scales; revisit only if users genuinely hit large `k`.
- **Pathfinder benchmark for `k`.** Establish concrete numbers for `findPathWithInvariants` across realistic graphs at varying `k`, to decide whether a guard threshold is warranted (N2 currently ships with no guard). Until the benchmark lands, N2's no-guard stance stands.
- **TML-2130 — `deriveEdgeStatuses` consulting the ledger rather than graph path.** This spec deliberately does not bundle the fix. Marker-side applied-invariants storage doesn't depend on it, because the marker records facts about actual applications rather than inferring from the graph — so forcing `migration_id` on the ledger + a new `readLedger` SPI into this PR train would be scope creep. TML-2130 remains its own correctness fix, prerequisite only for `migration status`'s edge-applied-display accuracy (not for invariant-aware routing). Safe to pick up independently.
- **Ledger per-invariant provenance.** Knowing "invariant X was first applied by migration M1 at T1" requires ledger-side rows carrying the `(migrationId, invariants)` tuple. The marker-side storage aggregates without provenance. If product use cases (audit, compliance review) materialize, the ledger grows this later — orthogonal to the routing layer.
- **`UNKNOWN_INVARIANT` pre-check at `ref set` time.** F15 handles apply-time + status-time checks; a `ref set`-time pre-check would catch typos earlier but requires `ref set` to read the graph (it doesn't today). Revisit if apply-time diagnostics turn out to fire too often.
- **Dagre graph rendering (`--graph`).** Tree view only for v1.
- **Draft edges and invariant routing asymmetry.** Drafts are excluded from the routing graph (`reconstructGraph` only accepts attested bundles) but *are* rendered in `migration status` via a separate `draftEdges` channel. A user could author a draft with `dataTransform({ name: 'X' })`, see it in the status view, and be confused when routing still reports `X` as missing. The routing behaviour is correct (drafts aren't runnable), but the UX mismatch is worth a follow-up: either visually distinguish draft-provided invariants in the rendered tree, or surface the "attest your draft to enable routing" hint in the `NO_INVARIANT_PATH` error text.
- **CLI surface for editing `ref.invariants`.** Edit JSON manually for now.
  - Possible approach: `prisma-next ref sync <ref-name> <migration>` to sync ref to hash and implied invariant state based on migration path from ref's current hash to the provided migration's destination hash.
- **User-facing vocabulary (`invariant` → ?).** *Follow-up; rename choice pending.* "Invariant" is jargon that leaks into public surfaces: the `invariantId` field on the authoring API, four error codes (`NO_INVARIANT_PATH`, `INVALID_INVARIANT_ID`, `DUPLICATE_INVARIANT_IN_EDGE`, `UNKNOWN_INVARIANT`), CLI copy ("required / applied / missing invariants"), and `ref.invariants` on disk. End users are unlikely to intuit what an "invariant" means in this context. v1 ships with "invariant" consistently — it's already wired through the codebase and renaming mid-spec would churn every surface — but the term is not defended. Candidate alternatives: **guarantee** (closest user-facing read, but overloaded by transactional / SLA usage elsewhere), **requirement** (accurate, generic to the point of being non-specific), **data-migration requirement** (explicit, verbose), **routing key** (implementation-leaning, hides intent from authors). Decision deferred until we have end-user feedback from v1. Whatever we land on gets swept across: authoring API (`invariantId` → `<new>Id`), error codes (public wire contract — requires a deprecation plan), CLI output, docs, this spec, and `ref.invariants`.
