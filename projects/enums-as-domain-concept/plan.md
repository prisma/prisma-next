# enums-as-domain-concept — Plan

**Spec:** `projects/enums-as-domain-concept/spec.md`
**Linear Project:** [Enums as a domain concept](https://linear.app/prisma-company/project/enums-as-a-domain-concept-696d6b36cb89) (team Terminal)

## At a glance

Four slices in a substrate-then-parallel-realization-then-cleanup shape: a contract
substrate slice lands the two-plane enum shape; two independent realization slices then
run in parallel — one delivering the Postgres server-side realization (checks +
defaults + verification), the other the application read surface (typing + `db.enums` +
ordering); a final cutover slice flips PSL `enum` + authoring to the new shape and
deletes the native machinery. The substrate slice is purely **additive** (the new
representation lands *dark*; native stays the default), so every intermediate merge stays
green. One stack thread (additive substrate → cutover) with a parallel pair in the
middle.

## Composition

### Stack (deliver in order)

1. **Slice `enum-contract-substrate`** — Linear: [TML-2850](https://linear.app/prisma-company/issue/TML-2850)
   - **Outcome:** The new enum representation exists and round-trips, added **additively
     (dark)**. The `enumType` / `member` API produces a `domain…enum` entity (explicit
     codec + ordered name→value members) and a `storage…valueSet` entity (ordered
     permitted values); the using field and column each keep their always-present
     `codecId` and additionally carry a `valueSet` restriction reference in the
     space-aware coordinate shape; the contract round-trips through the serializer and
     passes validation. PSL `enum` and the existing default authoring keep emitting the
     native enum unchanged — no fixture changes, no behavior change. The new shape is not
     yet migration-capable (slice 2); it is exercised by the new API + direct-IR
     round-trip tests, not end-to-end migration.
   - **Builds on:** None. (Soft external: the `valueSet` reference shape tracks the
     TML-2500 / PR #745 carrier — see § Dependencies. Local refs carry no `spaceId`, so
     this is not blocking.)
   - **Hands to:** The two-plane contract shape — `domain…enum`, `storage…valueSet`, and
     the `valueSet` property + reference coordinate — that slices 2 and 3 consume.
   - **Focus:** the `enumType` / `member` authoring API; the two new IR entity kinds and
     the `valueSet` property on domain field + storage column; the new API's TS-DSL
     lowering into both planes; serializer, validator, round-trip. The new path uses the
     ordinary scalar codec — no bespoke enum codec. Deliberately out of scope: server-side
     enforcement (slice 2), client typing / defaults (slice 3), and the cutover that makes
     the new shape the meaning of `enum` and deletes native (slice 4). The native path
     stays the default and is untouched; **PSL `enum` is not repointed in this slice** (it
     keeps lowering to native — repoint is the slice-4 cutover).

2. **Slice `delete-native-enum-machinery`** — Linear: [TML-2853](https://linear.app/prisma-company/issue/TML-2853)
   - **Outcome (cutover + delete):** PSL `enum` and the default authoring switch to
     producing the new domain-enum + value-set shape; canonical fixtures regenerate to the
     `valueSet` + check form; the native Postgres enum machinery (spec § What this
     replaces) is deleted. Build, type-checks, and `fixtures:check` pass; no
     `postgres-enum` discriminator or `PostgresEnumType` remains; the no-bare-cast ratchet
     is clean.
   - **Builds on:** Slice `check-constraint-realization` (TML-2851) — the flip requires
     migrations/verification to understand the new shape the instant authoring emits it.
     Sequenced after slice 3 (TML-2852) too, so reads are typed when the shape goes live
     and fixtures regenerate exactly once.
   - **Hands to:** A single enum path — the project's end state.
   - **Focus:** flip the PSL `enum` lowering + default authoring from native to the new
     shape; regenerate canonical fixtures to the `valueSet` + check form; delete the
     enumerated native machinery; confirm `fixtures:check` and the cast ratchet. The single
     atomic cutover — native and new coexist only up to this PR.

### Parallel group A — Postgres realization (independent of group B; builds on slice 1)

- **Slice `check-constraint-realization`** — Linear: [TML-2851](https://linear.app/prisma-company/issue/TML-2851)
  - **Outcome:** A `storage…valueSet` is enforced server-side by a check constraint, and
    member defaults render to DDL. `CheckConstraint` IR exists in a table-level `checks`
    array (the `uniques` / `indexes` / `foreignKeys` precedent); migrations add/remove
    permitted values by dropping and recreating the check (no type rebuild); the
    `enumMember` `ColumnDefault` variant renders `DEFAULT '<value>'`; schema verification
    compares the contract's expected check against the live database and reports drift.
  - **Builds on:** Slice 1's `storage…valueSet` + `domain…enum`.
  - **Hands to:** An enforced, migratable, default-capable Postgres realization of the
    value-set, replacing the deleted native ops/verification (consumed by slice 4).
  - **Focus:** `CheckConstraint` IR + `StorageTable.checks`; Postgres check DDL
    (create / add / remove); the `enumMember` default variant, its PSL/TS lowering, and
    its DDL rendering; check-based verification replacing `verifyEnumType`. Out of scope:
    client-side typing (slice 3). Touches the Postgres migration/planner surface and the
    `CheckConstraint` / `ColumnDefault` contract IR.

### Parallel group B — application read surface (independent of group A; builds on slice 1)

- **Slice `application-read-surface`** — Linear: [TML-2852](https://linear.app/prisma-company/issue/TML-2852)
  - **Outcome:** Reads and writes of an enum-typed field/column are statically the value
    union (not `string`) in both the ORM and the query-builder lanes; `db.enums.<Name>`
    exposes the ordered, literal-typed value tuple and member accessors at runtime;
    `ORDER BY` on an enum column sorts by declaration order.
  - **Builds on:** Slice 1's `domain…enum` + the field/column `valueSet` property.
  - **Hands to:** Enums usable idiomatically in application code — typed I/O, runtime
    introspection, declaration-order sort.
  - **Focus:** codec-`Output`-narrowed-by-`valueSet` typing in the ORM and query-builder
    lanes (R4 / R5); the `db.enums` runtime surface (R6); declaration-order `ORDER BY`
    rendering (R8). Touches the SQL lanes (`packages/2-sql/4-lanes/**`) and the runtime
    client — disjoint from group A's migration/planner surface. Out of scope: server-side
    enforcement and defaults (slice 2).

## Dependencies (external)

- [ ] **TML-2500 / PR #745 — cross-contract-space reference carrier.** The `valueSet`
  and `enumMember` default reference shapes follow this carrier's coordinate convention
  (`namespaceId` with the `__unbound__` sentinel; optional `spaceId` whose presence is
  the cross-space discriminator). **Status:** M1 (the storage-plane carrier + aggregate-
  load checks) merged to `main`; authoring surface and planner/verifier wiring are
  M2/M3. **Not blocking:** slice 1's local enum references carry no `spaceId` and use the
  landed carrier shape; if the convention shifts before this project lands, the `valueSet`
  refs shift with it (spec § Deferred to plan).

## Sequencing rationale

- **Slice 1 first** because it lands the two-plane contract shape that every other slice
  reads. Nothing downstream can be specced against an unsettled substrate.
- **Slices 2 and 3 parallelise** because both build only on slice 1 and touch disjoint
  surfaces — slice 2 the Postgres migration/planner plus the `CheckConstraint` /
  `ColumnDefault` contract IR; slice 3 the SQL lanes plus the runtime client. The
  migration DDL path and the query/typing path do not collide, so the
  "different-surface slices parallelise; same-adapter slices serialise" heuristic applies
  in favour of parallel.
- **Slice 4 is the atomic cutover (transitional-shape constraint).** `enum` is one
  keyword; it cannot mean both native and the new shape at once. So the new representation
  lands *dark* in slice 1 (additive — native stays the default and the only thing PSL
  `enum` lowers to), realization (slice 2) and typing (slice 3) build against it, and only
  slice 4 flips PSL `enum`/authoring to the new shape **and** deletes native in a single
  PR. The flip requires slice 2 (so migrations understand the new shape the instant
  authoring emits it) and follows slice 3 (so reads are typed when the shape goes live).
  Sequencing the flip last also regenerates the canonical fixtures exactly once. This is
  the project's only non-additive merge; every prior slice leaves `main` green.
