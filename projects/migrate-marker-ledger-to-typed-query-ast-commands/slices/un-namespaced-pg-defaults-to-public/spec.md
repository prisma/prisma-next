# Slice: un-namespaced-pg-defaults-to-public

_(In-project slice: parent project `projects/migrate-marker-ledger-to-typed-query-ast-commands/`. Sits outside Phase 1's adoption trio (slices 5–7) but inside the project's broader scope; surfaced during the #825 / TML-2889 review as a pre-existing bug the planner-adoption work was about to inherit. Fixing it now keeps Phase 2 mechanical: every PG `*Call.toOp()` adoption that follows can assume "un-namespaced PG → `public`" rather than working around `__unbound__` leakage.)_

## At a glance

Postgres un-namespaced models (e.g. `model user { … }` with no `@@schema` and no `namespace` block) currently land in `domain.namespaces.__unbound__` / `storage.namespaces.__unbound__` and are emitted with `kind: 'postgres-unbound-schema'`, in violation of [ADR 223](../../../../docs/architecture%20docs/adrs/ADR%20223%20-%20Target-owned%20default%20namespace.md) (which makes `target.defaultNamespaceId = 'public'` the static, target-owned default for un-namespaced PG authoring). The bug is downstream of the PSL interpreter's resolver — `resolveNamespaceIdForSqlTarget` already returns `'public'` for the `__unspecified__` PSL bucket on PG — so the locus is the contract-builder lowering path (`buildSqlContractFromDefinition` or the PSL→storage stage that consumes the resolved `modelEntries`/`ModelNode.namespaceId`). Fix it at the lowering locus; regenerate the ~53 PG demo migration fixtures whose `schema: '__unbound__'` and migration hashes shift as a result; pin the invariant with an emit-then-consume test (un-namespaced PG `model user` → `domain.namespaces.public`, `storage.namespaces.public`, `kind: 'postgres-schema'`).

## Chosen design

ADR 223 already settled the design: un-namespaced PG authoring stamps `target.defaultNamespaceId` (= `'public'`) at lowering time. The slice's job is to make the implementation match the ADR. The shape:

1. **Find the exact locus** that drops `'public'` to `'__unbound__'`. The PSL interpreter (`packages/2-sql/2-authoring/contract-psl/src/interpreter.ts`) does the right thing in `resolveNamespaceIdForSqlTarget` and stamps `ModelNode.namespaceId = 'public'` at `interpreter.ts:2200`. The drop happens later — almost certainly in `buildSqlContractFromDefinition` (the SQL builder lowering, `packages/2-sql/.../contract/build-contract.ts` or sibling) when it allocates the storage namespace slot, or in a residual `??` fallback to `UNBOUND_NAMESPACE_ID` that pre-dates ADR 223. The TS-builder authoring path (per ADR 223 line 43 "the TS builder's `build-contract.ts` and the PSL interpreter") is the other consumer of `target.defaultNamespaceId` — both paths must agree.

2. **Fix at the locus.** Replace any residual `?? UNBOUND_NAMESPACE_ID` (or equivalent literal `'__unbound__'` default) on the un-namespaced PG path with `?? target.defaultNamespaceId`. Per ADR 223 there must be **no `targetId === 'postgres'` branch** anywhere — the descriptor field is the single source.

3. **Regenerate fixtures.** ~53 PG demo fixtures under `examples/prisma-next-demo/fixtures/*` carry `schema: '__unbound__'`; their migration hashes change too. `pnpm fixtures:emit` regenerates them; commit the regenerated artifacts.

4. **Pin with an emit-then-consume test.** Per the memory entry "Verify through emit, not typeof", the test must emit a contract from a PSL doc that contains a bare un-namespaced PG model, and assert: `contract.domain.namespaces.public.models.user` is present, `contract.storage.namespaces.public.tables.user` is present, the storage namespace's `kind: 'postgres-schema'` (not `'postgres-unbound-schema'`), and no `__unbound__` namespace is materialized. Add the test in `packages/2-sql/2-authoring/contract-psl/test/interpreter.namespaces.test.ts` (alongside the existing `storage.namespaces['public']` assertions for declared-namespace cases — the new case covers the un-declared default).

5. **Mirror on the TS-builder authoring path** if the locus turns out to be there too. ADR 223 requires both paths to honor the same descriptor field; whichever path is broken must be fixed in this slice. The locus diagnostic (step 1) decides scope between "just the PSL path" and "both paths".

### Investigated landmarks (grounded for the implementer)

- `packages/3-targets/3-targets/postgres/src/core/descriptor-meta.ts:11` — `defaultNamespaceId: 'public'`.
- `packages/2-sql/2-authoring/contract-psl/src/interpreter.ts:254-268` — `resolveNamespaceIdForSqlTarget` returns `'public'` for `__unspecified__` on PG. ✅
- `packages/2-sql/2-authoring/contract-psl/src/interpreter.ts:1990` — `defaultNamespaceId = input.target.defaultNamespaceId` (= `'public'`). ✅
- `packages/2-sql/2-authoring/contract-psl/src/interpreter.ts:2172` — `modelCoordinateKey(namespaceId ?? defaultNamespaceId, model.name)`. ✅
- `packages/2-sql/2-authoring/contract-psl/src/interpreter.ts:2200` — `namespaceId !== undefined ? { …, namespaceId } : result.modelNode`. The model node carries `namespaceId: 'public'` when authoring is bare. ✅
- `buildSqlContractFromDefinition` (called at `interpreter.ts:2278`) — **suspected drop locus**. It needs to consume `ModelNode.namespaceId` and allocate `storage.namespaces['public']` correspondingly. Implementer reads + diagnoses.
- `packages/3-targets/3-targets/postgres/src/core/postgres-contract-serializer.ts:142, 192` — emits `kind: 'postgres-unbound-schema'` iff the namespace id is `UNBOUND_NAMESPACE_ID`; correct as-is, the bug is upstream.
- `examples/prisma-next-demo/fixtures/diamond/contract.prisma` — the reproducing fixture (`model user` with no `@@schema`, no datasource namespace, PG target).
- `examples/prisma-next-demo/fixtures/diamond/migrations/app/20260302T1000_alice_add_phone/end-contract.json` — verified output: `domain.namespaces` and `storage.namespaces` are `['__unbound__']`; storage namespace `kind: 'postgres-unbound-schema'`.

## Coherence rationale

One reviewer holds it because it is a single invariant fix — the implementation is brought into agreement with one ADR clause — plus the mechanical fixture regen that the invariant change forces. The locus diagnosis, the locus fix, and the fixture regen are inseparable: the diagnosis without the fix leaves the ADR violated, the fix without the regen leaves CI red, and the regen without the fix leaves the bug intact. The new test is what makes the fix durable.

## Scope

**In:**

- Locate and fix the residual `__unbound__` default on the un-namespaced PG lowering path (PSL interpreter and/or TS builder).
- Regenerate `examples/prisma-next-demo/fixtures/*` end-contracts + migration `.json`/`.sql` files via `pnpm fixtures:emit`; commit the regenerated artifacts.
- Absorb the migration-hash churn (the `migrationHash` / `contractHash` fields shift; expected and intended).
- Add one emit-then-consume test in `packages/2-sql/2-authoring/contract-psl/test/interpreter.namespaces.test.ts` (or sibling) asserting un-namespaced PG → `public` end-to-end at the contract IR level.
- Verify no `targetId === 'postgres'` namespace branch exists anywhere in framework/family/foundation packages (per ADR 223). If one slipped in, remove it.

**Out (deliberately left for other slices):**

- Phase 1 adoption trio (slices 5–7) — independent.
- Any planner-side `resolveNamespaceIdForIssue` / `resolveDdlSchemaForNamespace` changes. The planner helpers are downstream consumers; once the contract IR delivers `'public'` instead of `'__unbound__'`, those helpers see the correct value automatically. Touch only if the locus diagnosis reveals one of them is the actual drop point (which would be unexpected given ADR 223's lowering-time framing).
- SQLite / Mongo behavior — they keep `defaultNamespaceId = UNBOUND_NAMESPACE_ID` (ADR 223 table).
- Multi-namespace PG support / explicit cross-namespace DSL — out of scope (TML-2550).
- Schema verification / introspection diffs against an existing PG database — out of scope; the planner already qualifies `"public"."user"` from the namespace coordinate, and there is no semantic change at the database layer.
- Hand-authored `Migration` PG methods that already require an explicit `schema` (the #825 / TML-2889 authoring-half fix) — already shipped.

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
| --------- | ----------- | ----- |
| Migration-hash churn across ~53 fixtures | Expected; commit the regenerated hashes | The migration hash is content-addressed on the emitted SQL + namespace coordinates, so any namespace-id change shifts every fixture's hash. `pnpm fixtures:check` will go from red to green after `pnpm fixtures:emit`. |
| Existing PG fixtures that declare an explicit `namespace { … }` block or `@@schema(...)` | Unchanged | Resolver already returns the explicit name; no behavior change for those models. |
| TS-builder authoring path (`build-contract.ts`) | Either also fixed in this slice, or already correct | ADR 223 line 43 lists both authoring paths as consumers of `target.defaultNamespaceId`. The locus diagnostic decides whether one or both paths need the fix. If both, fix both — they're a single invariant. |
| Postgres extension contracts (pgvector, postgis) emitting `kind: 'postgres-unbound-schema'` in their generated `contract.d.ts` (verified via grep) | Investigate whether they intend `__unbound__` (late-binding) or are caught by the same bug | If extension packs deliberately use `__unbound__` for late-binding multi-tenant use, leave them alone — the resolver explicitly preserves the `namespace unbound { … }` opt-in (interpreter.ts:264). If they're un-namespaced and want `public`, they're hit by the same bug and the fix applies. Confirm during the locus diagnosis. |
| Schema-verify / `verify-sql-schema.ts` issue stamping | Should keep working without change | It stamps `namespaceId` from `contract.storage.namespaces` iteration; once the iteration yields `'public'` instead of `'__unbound__'`, the issues carry `'public'`, and `resolveNamespaceIdForIssue` returns `'public'` without its `?? UNBOUND_NAMESPACE_ID` fallback firing on the un-namespaced PG path. |

## Slice-specific done conditions

- [ ] `examples/prisma-next-demo/fixtures/diamond/migrations/app/20260302T1000_alice_add_phone/end-contract.json` (and the other ~52 PG demo fixtures) carry `domain.namespaces.public` and `storage.namespaces.public` with `kind: 'postgres-schema'`; no `__unbound__` namespace appears in any PG demo fixture that lacked a `namespace unbound { … }` opt-in.
- [ ] The new emit-then-consume test asserts un-namespaced PG → `public` at the contract IR level and passes; removing the fix turns it red.
- [ ] `git grep -nE "(targetId === 'postgres'|=== \"postgres\")" packages/{1-framework,2-sql}/` returns no namespace-defaulting branches (per ADR 223).

## Adapter-impact (repo-specific section per `drive/spec/README.md`)

- **Postgres adapter (`@prisma-next/adapter-postgres`):** No source change. The adapter already qualifies `"public"."user"` from the `StorageTable` namespace coordinate; once the contract IR carries `'public'` instead of `'__unbound__'`, the rendered SQL changes from `"user"` (or `current_schema()."user"`) to `"public"."user"` automatically.
- **SQLite / Mongo adapters:** Unchanged.

## ADR pointer

This slice does not introduce a new architectural decision; it brings the implementation into agreement with [ADR 223 — Target-owned default namespace](../../../../docs/architecture%20docs/adrs/ADR%20223%20-%20Target-owned%20default%20namespace.md). No ADR amendment needed.

## Open Questions

1. **Where exactly is the `__unbound__` drop?** PSL interpreter's `buildSqlContractFromDefinition` consumer, or the parallel TS builder's `build-contract.ts` (or both)? Settled by dispatch 1 (locus diagnosis — pure read-only). The diagnostic determines whether the fix is one site or two, and confirms whether any helper in the planner inherits a residual `?? UNBOUND_NAMESPACE_ID` (which should disappear once the IR is correct).
2. **Do the PG extension packs (`pgvector`, `postgis`, `sql-orm-client` test fixtures) intend `postgres-unbound-schema`?** Working position: their generated `contract.d.ts` files show `postgres-unbound-schema` and they may be hit by the same bug; treat them as collateral and regenerate. If they're deliberately late-binding (per the reserved `unbound` keyword convention), leave them. Settled by inspecting their source PSL/TS at dispatch 1.

## References

- ADR: [ADR 223 — Target-owned default namespace](../../../../docs/architecture%20docs/adrs/ADR%20223%20-%20Target-owned%20default%20namespace.md).
- Parent project spec: [`projects/migrate-marker-ledger-to-typed-query-ast-commands/spec.md`](../../spec.md).
- Project plan: [`projects/migrate-marker-ledger-to-typed-query-ast-commands/plan.md`](../../plan.md) — Phase 2 prerequisite-class cleanup; see also the migration-hash erratum note.
- Related (the authoring-half fix that surfaced this bug): [TML-2889](https://linear.app/prisma-company/issue/TML-2889) / PR #825.
- Linear issue: [TML-2916](https://linear.app/prisma-company/issue/TML-2916/un-namespaced-postgres-models-resolve-to-unbound-not-public-on-the).
- Surfaces this slice touches (grounded by Read/Grep at spec time):
  - PG target: `packages/3-targets/3-targets/postgres/src/core/descriptor-meta.ts`.
  - PSL interpreter: `packages/2-sql/2-authoring/contract-psl/src/interpreter.ts`.
  - SQL contract builder: `buildSqlContractFromDefinition` (called at `interpreter.ts:2278`).
  - PG contract serializer: `packages/3-targets/3-targets/postgres/src/core/postgres-contract-serializer.ts`.
  - SQL schema verifier (downstream consumer): `packages/2-sql/9-family/src/core/schema-verify/verify-sql-schema.ts`.
  - PG planner helpers (downstream consumers): `packages/3-targets/3-targets/postgres/src/core/migrations/planner-strategies.ts`, `issue-planner.ts`.
  - Existing PG namespace tests (extend with un-namespaced default case): `packages/2-sql/2-authoring/contract-psl/test/interpreter.namespaces.test.ts`, `interpreter.types.test.ts`.
  - Reproducing fixture: `examples/prisma-next-demo/fixtures/diamond/contract.prisma` + its `migrations/app/*/end-contract.json`.
