# D1 — Adapters contribute scalar constructors; assembly proven

**Slice plan:** `projects/remove-db-attributes/slices/unify-type-channel/plan.md` · **Tier:** mid · **Branch:** `tml-2985-unify-type-channel` (already checked out)

## Task

Each target adapter today declares its base scalars as a `scalarTypeDescriptors` map (`name → codecId`). This dispatch makes the same information available through the unified authoring channel: each adapter contributes its base scalars as **zero-arg type-constructor descriptors** in its component descriptor's `authoring.type` namespace, at **top level** (un-namespaced), with **explicit `nativeType`**.

The legacy maps stay in place and untouched — coexistence within the slice; a later dispatch deletes them. Do not re-point any consumer at the namespace in this dispatch.

## Outcome (property statement)

Every scalar the old maps name is representable in the assembled `AuthoringContributions.type` namespace with an identical `{ codecId, nativeType }` pair, **such that** a later consumer can swap its map-walk for a namespace-walk without any observable emission change (target-agnostic core preserved: the framework merge machinery learns nothing target-specific; each adapter owns its own scalar set). Top-level constructor-name collisions across descriptors must still be rejected at assembly with an error naming both contributors.

## In

- `packages/3-targets/6-adapters/postgres` — contribute `String, Boolean, Int, BigInt, Float, Decimal, DateTime, Json, Bytes` (codec ids per `postgresScalarTypeDescriptors` in `src/core/control-mutation-defaults.ts`; nativeTypes = what `codecLookup.targetTypesFor(codecId)[0]` yields today: text, bool, int4, int8, float8, numeric, timestamptz, jsonb, bytea — verify against the codec manifests, don't trust this list blindly).
- `packages/3-targets/6-adapters/sqlite` — same treatment for `sqliteScalarTypeDescriptors` (verify each nativeType against sqlite codec manifests).
- `packages/3-mongo-target/2-mongo-adapter` — same for the six mongo scalars incl. `ObjectId` (`src/exports/control.ts`).
- Assembly-level tests in `packages/1-framework/1-core/framework-components` proving: (a) top-level entries from an adapter descriptor land in the merged namespace; (b) two descriptors contributing the same top-level name is rejected naming both.
- Wire each contribution into the adapter's existing component-descriptor `authoring` field (follow the existing pattern, e.g. `postgresAuthoringTypes` / how `pg.enum` reaches assembly in `packages/3-targets/3-targets/postgres/src/core/authoring.ts` — note that one lives in the *target* pack; yours live in the *adapter* descriptors that own the scalar maps. If the adapter descriptor has no `authoring` surface, thread it the way the target pack does — discover via grep, and record what you found in the report).

## Out

- Deleting or modifying the legacy maps or any consumer (`buildColumnDescriptorMap`, providers, symbol table, LSP).
- Native types (`Uuid`, `VarChar`, …), `Json`/`Jsonb` re-binding — later slices.
- Any change to `assembleScalarTypeDescriptors` / `ContractSourceContext`.

## Edge cases

| Case | Disposition |
| --- | --- |
| `sql.String` (namespaced) vs top-level `String` | Not a collision — merge keys by full path. Add/keep a test proving both coexist. |
| Existing merge rejects only same-path collisions | Confirm with a test for two top-level `String`s from different descriptors; if rejection is missing at top level, add it in the merge (this is the dispatch's one judgment site — keep it small and obvious). |
| nativeType guesses wrong | Halt condition: if a codec manifest disagrees with the listed nativeType, use the manifest's value and note it in the report — never invent. |
| Destructive git operations | **Forbidden** without orchestrator approval (no rebase/reset/checkout -- /stash; commit with `-s` DCO sign-off). |
| Fixture drift | Out of scope — this dispatch adds contributions nobody consumes; `pnpm fixtures:check` must pass untouched. If it doesn't, halt and report. |

## Completed when

1. `pnpm typecheck` green; `pnpm --filter @prisma-next/framework-components lint` + per-touched-adapter lint green; touched packages' tests green (incl. test tsconfig where present — F14).
2. New assembly tests prove (a) and (b) from **In**; existing tests untouched and green.
3. `pnpm fixtures:check` passes with zero drift.

## Report back

Files touched, the discovered wiring path from adapter descriptor → assembled namespace, any nativeType corrections, failure modes F1/F3/F14/F16/F18 checked and noted avoided, and the exact test names added.
