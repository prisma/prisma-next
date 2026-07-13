# Slice plan — `managed-native-enum-add-value` (Phase 2, Slice B)

**Spec:** [`spec.md`](spec.md). Three sequential foreground dispatches (shared planner surface — no parallel implementers on one index). Each dispatch runs its package gates; the slice closes with the standard full-suite gate (build, full typecheck, 13-step lint incl. casts + upgrade-coverage, fixtures:check, all three test suites — including `test/integration` + `test/e2e` trees, which package-scoped runs miss) before PR-open.

## Dispatch 1 — append lowering, refusal message, the op, the docs page

**Outcome:** a managed enum's suffix-append plans `ALTER TYPE … ADD VALUE` ops; every other member change is refused with the plain-language, doc-linked diagnostic; the linked page's markdown exists in-repo.

**Builds on:** Slice A as-built (leaf `PostgresNativeEnumSchemaNode`, `mapNativeEnumNodeIssue`, `Create/DropNativeEnumTypeCall`, `controlAdapterFor`).

**Focus:**
- Suffix-append classification in `mapNativeEnumNodeIssue`'s `not-equal` tail (actual strict prefix of expected → one `AddNativeEnumValueCall` per appended value, declaration order; else refusal). Pure list comparison; no new diff machinery.
- The refusal message per spec §2 (exact operator wording, `https://pris.ly/d/postgres-native-enums` link, `migration new` manual path); same conflict kind + location.
- `AddNativeEnumValueCall` (factory `addNativeEnumValue`): renders `ALTER TYPE <qualified> ADD VALUE '<value>'` via `quoteQualifiedName` + `escapeLiteral` + `validateEnumValueLength`; precheck type-exists + value-absent, postcheck value-present; rendered description carries the non-transactional caveat sentence (spec §4). Each value its own op/statement.
- Hand-authored `addNativeEnumValue({ schema, typeName, value })` on `postgres-migration.ts` via `controlAdapterFor('addNativeEnumValue')`.
- Move the explainer to `docs/reference/postgres-native-enums.md`; `projects/.../why-native-postgres-enums.md` becomes a pointer.

**Completed when:** planner unit tests prove — single append → one op; multi append → ordered ops; rename, removal, reorder, and DB-ahead-of-contract each → the new diagnostic and zero ops; the message text matches spec §2 verbatim; op render/prechecks covered; `target-postgres` typecheck + tests green.

**Hands to:** D2 a planner whose enum lowering is final, so namespace-visibility work only widens *which* namespaces reach it.

## Dispatch 2 — enums-only namespaces reach verify/plan

**Outcome:** a contract namespace declaring native enums but no tables is visible to both verify and plan; a namespace with neither still prunes.

**Builds on:** D1 (append/refusal lowering final — new visibility flows into finished semantics).

**Focus:** widen `pruneTableLessNamespaces` (`tables > 0 || nativeEnums > 0`) and the `existingSchemas` filter, both call sites (`diff-database-schema.ts` verify + plan builders); update the pinned `verdict-table-less-namespace.test.ts` to the new boundary; update the prune's doc comment (it currently justifies itself as legacy reproduction).

**Completed when:** planner test proves an enums-only namespace plans `createSchema` + `createNativeEnumType` (ordered schema-first); verify test proves its absence reports instead of silence; a no-tables-no-enums namespace still prunes (pinned); `target-postgres` + `family-sql` typecheck + tests green.

**Hands to:** D3 a complete feature surface needing only live proof.

## Dispatch 3 — live proof (PGlite) + slice gate

**Outcome:** R8/R9 proven against a real database; the slice is PR-ready.

**Builds on:** D1 + D2 (complete semantics).

**Focus:** extend `native-enum-lifecycle-e2e.integration.test.ts` (adapter-postgres): append single + multi → apply → `db verify` green → introspection shows ordered members; each refusal class end-to-end (diagnostic surfaces, zero ops, DB untouched); enums-only-namespace contract `db init` → `verify` green; external enum with a live-appended value stays suppressed (no ops, R5); rendered plan output shows the caveat on the `ADD VALUE` op. Sweep `test/integration` + `test/e2e` for assertions pinned to the old Slice-A diagnostic wording (known trap — the message format changed). Then the full-suite slice gate.

**Completed when:** adapter-postgres integration green under real PGlite; the old-wording sweep is clean; full gate green (all three suites); evidence recorded for the reviewer pass.

## After the dispatches

Opus reviewer pass over the whole diff (per Drive review flow), rework loop as needed, then PR-open with the spec-derived description. The pris.ly slug registration + docs-site submission are tracked as an independent follow-up, not a PR blocker.
