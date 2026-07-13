# Slice — `managed-native-enum-add-value` (Phase 2, Slice B)

**Project:** [`../../spec.md`](../../spec.md) · **Plan:** [`../../plan.md`](../../plan.md) · **Requirements:** R8 (a pure suffix-append migrates in place via `ADD VALUE`, no rewrite), R9 (rename / remove / reorder is refused with a diagnostic, never planned), R5 preserved (external enums: no DDL, no drift). Design of record: project spec § Phase 2 + [`../../specs/migration-design.md`](../../specs/migration-design.md) §4–§5. Closes out Phase 2.

## At a glance

The contract appends a member to a managed enum:

```prisma
native_enum UserRole {
  user
  admin
  guest   // ← new
}
```

`migration plan` today emits the Slice-A named diagnostic ("enum value changes are not auto-migrated yet"). After this slice it plans:

```sql
ALTER TYPE "public"."user_role" ADD VALUE 'guest';
```

— one op per appended value, in declaration order, applied in place with no table rewrite. Any other member change — a rename, a removal, a reorder — is **refused** with a diagnostic naming the class and the manual path (`migration new`); it is never lowered to an op. And a namespace that declares only enums (no tables) becomes visible to verify/plan, so `db init` creates its schema and types.

**Why now:** Slice A (PR #949) shipped the managed create/delete lifecycle and deliberately punted the value-mismatch case to a named diagnostic. This slice replaces that diagnostic with the real semantics, closing the last Phase-2 requirement pair (R8/R9) and the enums-only-namespace limitation Slice A carried. Not on the Supabase critical path (operator ruling): Supabase enums are external, and external drift stays suppressed.

## Chosen design

**1. Suffix-append classification, in the existing `not-equal` lowering.** `mapNativeEnumNodeIssue` ([`issue-planner.ts`](../../../../packages/3-targets/3-targets/postgres/src/core/migrations/issue-planner.ts) — the `not-equal` tail that today returns the named diagnostic) classifies the two ordered member lists the issue already carries: when the actual (DB) members are a **strict prefix** of the expected (contract) members, return one `AddNativeEnumValueCall` per appended value, in declaration order. Anything else — same length with any differing value (rename/reorder), shorter expected (removal), equal-length-prefix violations — returns the refusal conflict. The classification is pure list comparison on data the issue carries; no new diff machinery, no per-member child nodes (the node stays a leaf with positional `isEqualTo`, exactly as Slice A shipped it).

**2. Refusal wording becomes permanent, not "yet".** The Slice-A diagnostic said "not auto-migrated **yet**". The replacement names the refused class and the settled policy (project non-goal — removal/reorder force a full-table rewrite; rename is indistinguishable from add+remove in an order-aware diff): `Native enum type "<schema>"."<name>" changed beyond a suffix-append (contract declares […], database has […]); renames, removals, and reorders are not auto-migrated. Author the change manually with \`migration new\`.` Same conflict kind (`unsupportedOperation`), same location coordinate.

**3. One new op, through the standard machinery.** `AddNativeEnumValueCall` (factory name `addNativeEnumValue`) beside `CreateNativeEnumTypeCall`/`DropNativeEnumTypeCall` in `op-factory-call.ts`: renders `ALTER TYPE <qualified> ADD VALUE '<value>'` (qualified via `quoteQualifiedName`, value via `escapeLiteral` + `validateEnumValueLength`), lowered through the control adapter like every other call. Precheck: type exists and the value is absent; postcheck: the value is present. Each appended value is **its own op / its own statement** — never batched into one `ALTER`.

**4. The non-transactional caveat is documented and surfaced, not engineered around.** Postgres ≥ 12 permits `ADD VALUE` inside a transaction, but the added value is **unusable until that transaction commits**; the runner applies a space's op sequence under a single transaction (`concatenate-space-apply-inputs.ts`). Settled consequence (project spec #4): a migration that appends a value **and uses it** in the same migration (a `dataTransform` writing it, a default referencing it) fails at apply with Postgres's own "unsafe use of new value" error — that is the documented boundary, and splitting transactions or reordering around usage is out of scope. The op's rendered description (the `describe`/summary surface `migration plan` prints) carries the caveat sentence so the operator sees it at plan time. No new runner machinery, no per-op transaction flag.

**5. Enums-only namespaces become visible.** `pruneTableLessNamespaces` ([`diff-database-schema.ts:67`](../../../../packages/3-targets/3-targets/postgres/src/core/migrations/diff-database-schema.ts)) currently drops any expected namespace with zero tables (pinned legacy behavior), making an enums-only namespace invisible to both verify and plan (both call sites). The filter keeps a namespace that declares native enums (`tables > 0 || nativeEnums > 0`); the `existingSchemas` filter follows. Consequence — the desired behavior: `db init` on an enums-only-namespace contract creates the schema and its types; verify reports their absence instead of silence. The pinned test (`verdict-table-less-namespace.test.ts`) updates to pin the new boundary: a namespace with no tables **and no enums** still prunes.

**6. Control-policy grading rides Slice A unchanged.** The suffix-append issue flows through the same node-issue partition: `managed` plans the `ADD VALUE`s; `external`/`observed` suppress (an externally-appended value is not our drift to fix — R5). Strict verify still fails a member mismatch under `managed` and `external` exactly as Slice A pinned; only the **planner's** lowering changes.

**7. The hand-authored surface gains the same verb.** `postgres-migration.ts` gets `addNativeEnumValue({ schema, typeName, value })` via `controlAdapterFor('addNativeEnumValue')`, mirroring `createNativeEnumType`/`dropNativeEnumType` — so a refused change's manual path (`migration new`) can express the append it does want alongside hand-written rewrite steps.

## Coherence rationale (slice-INVEST · _Small_)

One reviewer sitting: a planner-lowering change confined to one function's tail, one op class following two existing siblings, one filter-predicate widening, one migration-surface method, and their tests. No framework/family surface changes, no new diff machinery, no runner changes. Rollback is one revert.

## Scope

**In:** the suffix-append classification + `AddNativeEnumValueCall` lowering; the permanent refusal diagnostic; the op class with prechecks/postchecks + caveat-bearing description; the `pruneTableLessNamespaces` widening (verify + plan call sites) + pinned-test update; the hand-authored `addNativeEnumValue`; unit + planner tests; a live PGlite integration proof (single + multi append, all three refusal classes, enums-only-namespace `db init` → `verify` round-trip, external append suppressed).

**Deliberately out:**

- Transaction splitting / usage-aware ordering for same-migration value use — documented boundary (design point 4), permanently.
- `RENAME VALUE`, removal, reorder lowering — project non-goal, permanent.
- Positional inserts (`ADD VALUE … BEFORE/AFTER`) — a non-suffix insert is a reorder; refused.
- SQLite / Mongo — no native enum exists there.

## Pre-investigated edge cases

| Case | Behavior |
| --- | --- |
| Multiple values appended in one contract change | One op per value, declaration order (each its own statement) |
| DB has **more** members than the contract (live-appended value not yet adopted) | Not a suffix-append of the contract over the DB → refusal (adopt via `contract infer` or hand-author) |
| Duplicate member in the contract | Rejected at authoring/emit (existing entity validation), never reaches the planner |
| Appended value > 63 bytes | `validateEnumValueLength` throws at op construction (Slice-A rule, UTF-8 bytes) |
| Enums-only namespace, `external` grade | Namespace now visible, but external suppresses its DDL — visible ≠ managed |

## Slice-specific done conditions

R8 and R9 proven against a live database (PGlite): the append path applies and round-trips verify; each refusal class (rename, removal, reorder) yields the diagnostic and zero ops; the enums-only-namespace contract completes `db init` → `db verify` green. Plan output shows the caveat on the `ADD VALUE` op description. (CI-green, reviewer-accept, project-DoD floor inherited.)

## Open questions

None — the design is fully settled by project spec §4/§Phase-2 and migration-design §4–§5; the operator ruled the slice off the Supabase critical path and in-scoped the namespace gap.

## References

- Project spec: [`../../spec.md`](../../spec.md) (§ operations table, § Phase 2, R8/R9)
- Migration design: [`../../specs/migration-design.md`](../../specs/migration-design.md) §4 (diff→ops table), §5 (the ops + caveat)
- Slice A (as-built substrate): [`../managed-native-enum-create-delete/spec.md`](../managed-native-enum-create-delete/spec.md) + PR #949; known-limitation note (the prune) at its § Known limitation
- Diagnostic being replaced: `mapNativeEnumNodeIssue`'s `not-equal` tail, `packages/3-targets/3-targets/postgres/src/core/migrations/issue-planner.ts`
- Prune site: `pruneTableLessNamespaces`, `packages/3-targets/3-targets/postgres/src/core/migrations/diff-database-schema.ts` (both call sites)
- Runner transaction model: `packages/1-framework/3-tooling/migration/src/concatenate-space-apply-inputs.ts`

## Dispatch plan

Three foreground dispatches, sequential (shared planner surface):

1. **Lowering + op.** The suffix-append classification in `mapNativeEnumNodeIssue`, the permanent refusal wording, `AddNativeEnumValueCall` (+ factory, prechecks/postchecks, caveat description, length/escape rules), the hand-authored `addNativeEnumValue`. Unit + planner tests, including all three refusal classes and the DB-ahead-of-contract case.
2. **Namespace visibility.** Widen `pruneTableLessNamespaces` (+ `existingSchemas`), update the pinned verdict test to the new boundary, prove schema+type creation planning for an enums-only namespace and continued pruning of truly-empty namespaces.
3. **Live proof.** PGlite integration: append single/multi + verify round-trip; refusal negative tests; enums-only `db init` → `verify`; external-append suppression; caveat visible in rendered plan output.

Each dispatch runs the full package gate; the slice closes with the standard full-suite gate (build, typecheck, 13-step lint, fixtures, all three test suites) before PR-open.
