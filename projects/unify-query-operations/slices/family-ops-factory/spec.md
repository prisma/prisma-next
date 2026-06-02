# Slice: family-ops-factory

_Parent project: [`projects/unify-query-operations/`](../../). This slice satisfies FR1-FR4, FR15-FR17, AC2/AC5/AC6/AC11/AC12 from the project spec, and partial AC4 (the per-column ORM surface is unchanged because the consumer doesn't read the new entries yet)._

## At a glance

Ship `sqlFamilyOperations<CT>()` in `@prisma-next/family-sql` covering all 15 family operations (`eq`, `neq`, `in`, `notIn`, `gt`, `lt`, `gte`, `lte`, `like`, `isNull`, `isNotNull`, `and`, `or`, `exists`, `notExists`) as TypeScript-function operation descriptors per [ADR 206](../../../../docs/architecture%20docs/adrs/ADR%20206%20-%20Operations%20as%20TypeScript%20functions.md). Wire the family as a contributor to `createExecutionContext` so the registry receives the family's operations alongside target/adapter/extension contributions. Add the family's `descriptorMeta.types.queryOperationTypes` slot so the emitter aggregates the family's `QueryOperationTypes<CT>` alias into the generated `Contract['queryOperationTypes']`.

**End-of-slice state**: the registry carries the 15 family operations (trait-targeted where applicable, `any: true` for `isNull` / `isNotNull` using D1's arm, no `self` for `and` / `or` / `exists` / `notExists`) and `Contract['queryOperationTypes']` includes them — **but no consumer reads them yet**. `COMPARISON_METHODS_META` (ORM) and `BuiltinFunctions` (sql-builder) still take precedence in both authoring surfaces. The family entries are inert backups until slice 3 (`collapse-consumers`) deletes the legacy surfaces and rewires the consumers.

## Scope

### In scope

- **New file:** `packages/2-sql/9-family/src/types/operation-types.ts` — type-only `QueryOperationTypes<CT>` mirroring the runtime factory. Per ADR 206's "operations as TypeScript functions" pattern, the type carries the user-facing signatures (codec-id generics constrained to the relevant trait's codec-id union per FR17).
- **New file:** `packages/2-sql/9-family/src/core/query-operations.ts` — `sqlFamilyOperations<CT>()` runtime factory that returns the 15 operation descriptors. Each descriptor's `impl` uses `buildOperation` (same pattern as `pgvector/src/core/descriptor-meta.ts:17-58`).
- **New file:** `packages/2-sql/9-family/src/exports/operation-types.ts` — re-exports the `QueryOperationTypes` type so the emitter can import it via the `descriptorMeta.types.queryOperationTypes` slot (matching the `pgvector` / `cipherstash` / `paradedb` / `postgis` pattern).
- **Modified:** `packages/2-sql/9-family/src/core/runtime-descriptor.ts` — extend `sqlRuntimeFamilyDescriptor` to satisfy `SqlStaticContributions` (gain `codecs: () => []` since family owns no codecs, and `queryOperations: () => sqlFamilyOperations()`).
- **Modified:** `packages/2-sql/9-family/src/core/control-descriptor.ts` — extend `SqlFamilyDescriptor` to expose `types.queryOperationTypes` per the pattern at `packages/3-extensions/pgvector/src/core/descriptor-meta.ts:97-103`. The import points at the family's own `@prisma-next/family-sql/operation-types` export.
- **Modified:** `packages/2-sql/9-family/src/exports/pack.ts` and/or `package.json` exports map — add the operation-types export.
- **Modified:** `packages/2-sql/5-runtime/src/sql-context.ts` — extend `SqlExecutionStack` with an optional `family?: SqlRuntimeFamilyDescriptor` field (default `sqlRuntimeFamilyDescriptor`); extend `createSqlExecutionStack` to set the default; extend `createExecutionContext`'s contributors array (`sql-context.ts:766-770`) to put the family first: `[stack.family, stack.target, stack.adapter, ...stack.extensionPacks]`.
- **Modified or new test file(s):** `packages/2-sql/9-family/test/query-operations.test.ts` (new) — assert the factory registers all 15 ops with the correct `self` shapes (`equality` traits, `order` traits, `textual` traits, `any: true` for null checks, no `self` for boolean composition), exercises an end-to-end registration through a synthetic `createExecutionContext` call, and confirms cipherstash-style trait-empty codecs do NOT pick up trait-gated family ops (the `any: true` ops still surface).
- **Possibly modified:** the family-sql `package.json` to wire the new operation-types subpath export.

### Out of scope (this slice)

- **Deletion of `COMPARISON_METHODS_META`** (`packages/3-extensions/sql-orm-client/src/types.ts:309+`) and **deletion of `BuiltinFunctions<CT>` / `createBuiltinFunctions`** (sql-builder). Slice 3's territory.
- **Rewiring the ORM model accessor's two-loop synthesis to a single registry loop** (`packages/3-extensions/sql-orm-client/src/model-accessor.ts:71-167`). Slice 3.
- **Rewiring the sql-builder `fns` Proxy to read only from the registry** (`packages/2-sql/4-lanes/sql-builder/src/runtime/functions.ts:180-195`). Slice 3.
- **Renaming `fns.ne` → `fns.neq`** at sql-builder call sites (the family uses `neq` to match `COMPARISON_METHODS_META`; current sql-builder uses `ne`). The migration happens in slice 3 when the legacy `BuiltinFunctions['ne']` entry is deleted; slice 2 leaves both `neq` (in the registry, inert) and `ne` (in `BuiltinFunctions`, still active) coexisting.
- **HAVING surface derivation** (`HavingComparisonMethods<T>` deletion). Slice 4.
- **Aggregate-only functions** (`count`, `sum`, `avg`, `min`, `max`) — project non-goal.
- **ORM ordering registry / `asc` / `desc`** — slice 3 introduces the private ORM ordering registry; this slice ships only the SQL family registry.
- **ADR drafting** — defers to slice 5's close-out ADR.

## Approach

The slice ships three logical pieces of work that compose into one PR's diff: **(1) the factory and its type-level twin**, **(2) descriptor-meta and runtime-descriptor wiring**, **(3) `createExecutionContext` contributor extension**. The pieces are sequenced but mutually dependent for the end-of-slice promise (the emitter-generated `Contract['queryOperationTypes']` and the registry both carry the 15 family operations).

**(1) Factory + type twin.** `sqlFamilyOperations<CT>()` is structured like `pgvectorQueryOperations<CT>()` at `packages/3-extensions/pgvector/src/core/descriptor-meta.ts:17-58`: a function generic over `CT extends CodecTypesBase`, returning an object literal whose keys are the operation names and whose values are descriptors with `self` and `impl`. The runtime `impl`s use `buildOperation` from `@prisma-next/sql-relational-core/expression` to build the lowered AST nodes. The 15 ops break down per the trait-mapping table from the project spec § Approach (illustrative — the implementer authors the exact impls, lowering templates may need to draw from `BuiltinFunctions` and `COMPARISON_METHODS_META` for parity):

```ts
// Illustrative — keys, self shapes, and one impl pattern. Full lowering
// templates / sub-AST node choices are the implementer's call, drawing
// from BuiltinFunctions (sql-builder) and COMPARISON_METHODS_META (ORM)
// to preserve byte-identical emitted SQL.
export function sqlFamilyOperations<CT extends CodecTypesBase>(): QueryOperationTypes<CT> {
  return {
    // Equality predicates — trait-gated
    eq: { self: { traits: ['equality'] }, impl: /* binary BinaryExpr op='eq' */ },
    neq: { self: { traits: ['equality'] }, impl: /* binary BinaryExpr op='neq' */ },
    in: { self: { traits: ['equality'] }, impl: /* list BinaryExpr op='in' (with TS overloads per FR16) */ },
    notIn: { self: { traits: ['equality'] }, impl: /* list BinaryExpr op='notIn' */ },

    // Order predicates — trait-gated
    gt: { self: { traits: ['order'] }, impl: /* binary BinaryExpr op='gt' */ },
    gte: { self: { traits: ['order'] }, impl: /* binary BinaryExpr op='gte' */ },
    lt: { self: { traits: ['order'] }, impl: /* binary BinaryExpr op='lt' */ },
    lte: { self: { traits: ['order'] }, impl: /* binary BinaryExpr op='lte' */ },

    // Textual predicate — trait-gated
    like: { self: { traits: ['textual'] }, impl: /* BinaryExpr or LikeExpr */ },

    // Null checks — use D1's `any: true` arm
    isNull: { self: { any: true }, impl: /* NullCheckExpr.isNull */ },
    isNotNull: { self: { any: true }, impl: /* NullCheckExpr.isNotNull */ },

    // Boolean composition — no self (sql-builder-only; not a column method)
    and: { impl: /* AndExpr.of */ },
    or: { impl: /* OrExpr.of */ },
    exists: { impl: /* ExistsExpr.exists */ },
    notExists: { impl: /* ExistsExpr.notExists */ },
  };
}
```

The matching `QueryOperationTypes<CT>` type in `types/operation-types.ts` is the type-only twin (per ADR 206's pattern at `packages/3-extensions/pgvector/src/types/operation-types.ts`). The binary trait-gated operators' user-facing signatures follow FR17's trait-constrained codec-id generic pattern from ADR 203:

```ts
// Illustrative — final helper names are the implementer's choice. The
// implementer derives `EqualityCodecId<CT>` / `OrderCodecId<CT>` /
// `TextualCodecId<CT>` from CT by filtering codec ids whose trait sets
// include the relevant trait. This is the same pattern ADR 203's
// "How matching works" section describes for `fns.ilike`.
readonly eq: {
  readonly self: { readonly traits: readonly ['equality'] };
  readonly impl: <CodecId extends EqualityCodecId<CT>>(
    a: CodecExpression<CodecId, boolean, CT> | null,
    b: CodecExpression<CodecId, boolean, CT> | null,
  ) => Expression<{ codecId: 'pg/bool@1'; nullable: false }>;
};
```

**(2) Descriptor-meta wiring (control + runtime).** The runtime descriptor (`sqlRuntimeFamilyDescriptor`) currently has only `kind`, `id`, `familyId`, `version`, `create()`. It does not satisfy `SqlStaticContributions` (which the runtime contributors loop expects). The slice adds two slots:

```ts
// Illustrative — applied to the existing object literal in runtime-descriptor.ts.
codecs: () => [], // family owns no codecs; targets and adapters do
queryOperations: () => sqlFamilyOperations(),
```

The control descriptor (`SqlFamilyDescriptor` class in `core/control-descriptor.ts`) gains `types.queryOperationTypes`:

```ts
// Illustrative — placed on the class instance.
readonly types = {
  queryOperationTypes: {
    import: {
      package: '@prisma-next/family-sql/operation-types',
      named: 'QueryOperationTypes',
      alias: 'SqlFamilyQueryOperationTypes',
    },
  },
} as const;
```

The emitter's `extractQueryOperationTypeImports` (`packages/1-framework/1-core/framework-components/src/control/control-stack.ts:111-124`) already iterates `allDescriptors` which **already includes `family`** (line 353: `const allDescriptors = [family, target, ...]`). So once the family's control descriptor exposes the `types.queryOperationTypes` slot, the alias-aggregation lifts it into the generated contract's `QueryOperationTypes` alias with zero emitter-side code changes.

**(3) `createExecutionContext` contributor wiring.** The contributors array at `packages/2-sql/5-runtime/src/sql-context.ts:766-770` is today `[stack.target, stack.adapter, ...stack.extensionPacks]`. The slice extends it to `[stack.family, stack.target, stack.adapter, ...stack.extensionPacks]`. To minimize fanout across the ~8 existing `createSqlExecutionStack` call sites, the `family` field on `SqlExecutionStack` defaults to `sqlRuntimeFamilyDescriptor` inside `createSqlExecutionStack` (a `family?` optional input). Existing call sites continue to work unchanged; future polymorphism (hypothetical other SQL family flavours) can pass the family explicitly.

**End-of-slice integration test.** A new test in `packages/2-sql/9-family/test/query-operations.test.ts` builds a minimal `createExecutionContext` with a stack carrying a synthetic codec set, asserts that `context.queryOperations.entries()` contains all 15 family operation names, and asserts the trait-expansion mapping (e.g. `eq` indexes under all codecs declaring `equality`; `isNull` indexes under every codec via the `any: true` arm; `and` is registered with no self and is therefore invisible to the ORM but visible on the registry).

## Edge cases (Example-Mapping)

| Edge case | Disposition | Notes |
|---|---|---|
| Registering all 15 ops without collision against existing extension ops (cipherstash / pgvector) | Handle | Cipherstash names its ops with the `cipherstash` prefix (`cipherstashEq`, etc.); pgvector with semantic names (`cosineDistance`, `cosineSimilarity`). No collisions today. The validator at `createSqlOperationRegistry` throws on duplicate names, so a future extension collision becomes a load-time error — the project spec FR12 already names this as the policy. |
| `isNull` / `isNotNull` using D1's `any: true` arm | Handle | Both ops declare `self: { any: true }`. Test asserts the registry's per-codec index carries these for every codec descriptor, demonstrating D1's foundation flows through. |
| Trait expansion cost (NFR1) at registry assembly | Handle | The runtime contributors loop iterates each contributor's `queryOperations()` once at `createExecutionContext` construction. Adding 15 entries (of which ~9 trait-targeted expand × N codecs) is bounded and runs once per context. NFR1 asks for "no measurable regression on existing benchmarks" — the slice's tests measure this in a follow-up dispatch if needed; first pass is "registration completes synchronously without observable cost." |
| Emitter alias-aggregation picking up family operationTypes | Handle | `extractQueryOperationTypeImports` (`control-stack.ts:111-124`) already iterates `allDescriptors` which includes `family`. The slice extends the family control descriptor's `types.queryOperationTypes` slot. Test: emit a contract from a stack with default `sqlRuntimeFamilyDescriptor` + a postgres adapter; assert the generated `contract.d.ts` `QueryOperationTypes` alias is the intersection `SqlFamilyQueryOperationTypes<CodecTypes> & PgAdapterQueryOps<CodecTypes>` (or similar). |
| Inert-backup state — `COMPARISON_METHODS_META` and `BuiltinFunctions` still take precedence | Handle | The slice deliberately does NOT delete the legacy surfaces. The end-state assertion: a `model.field.eq(...)` ORM call still routes through `COMPARISON_METHODS_META` (slice 3 changes this); a `fns.eq(...)` sql-builder call still routes through `BuiltinFunctions` (slice 3 changes this). Slice 2's tests therefore probe `context.queryOperations.entries()` directly, not the consumer surfaces. The test for the no-regression promise (existing call sites' behaviour unchanged) is the unmodified pass of every prior ORM/sql-builder test in the workspace. |
| `in` / `notIn` TypeScript overloads (FR16) | Handle | ADR 206 explicitly permits TypeScript overloads in operation `impl` types. The family's `in` / `notIn` carry two overloads matching today's `BuiltinFunctions`: `(expr, values: readonly unknown[])` and `(expr, subquery: Subquery<...>)`. The runtime impl branches on the second arg's shape (same pattern as `inOrNotIn` in `sql-builder/runtime/functions.ts:153-160`). |
| `and` / `or` / `exists` / `notExists` with no `self` — sql-builder-only entries | Handle | These four ops are registered with no `self` field. The ORM model accessor's resolution loop (`packages/3-extensions/sql-orm-client/src/model-accessor.ts:71-85`) explicitly skips ops where `self === undefined` (line 74: `if (!self) continue;`) — so they never surface as column methods. The sql-builder's `fns` proxy will reach them in slice 3 when `Functions<QC>` drops the `BuiltinFunctions<CT> &` intersection. For slice 2 they sit in the registry inert. |
| Cipherstash columns with `traits: []` must NOT gain family ops they don't declare traits for | Handle | The registry-assembly trait-expansion (D1 prepared this) iterates each codec descriptor and only indexes an op under a codec when the codec's `traits` set includes every required trait. Cipherstash's `traits: []` therefore matches **none** of `equality` / `order` / `textual` — `eq` / `neq` / `gt` / `like` / etc. do NOT index under cipherstash codecs. The `any: true` ops (`isNull` / `isNotNull`) DO index under cipherstash codecs. Test: assert this directly in the family-sql test. (Slice 1 AC3 lands fully in slice 3 when `fns.eq(cipherstashCol, cipherstashCol)` fails type-checking on the sql-builder surface.) |
| Workspace `pnpm typecheck` substitution carries from slice 1 | Handle | The pre-existing typecheck failure in `@prisma-next/cli` / `@prisma-next/postgres` / `@prisma-next/family-sql` is orchestrator-accepted as orthogonal. Slice 2 expands the 5-package targeted typecheck to include any new package(s) whose types consume the family's `QueryOperationTypes` — at minimum `@prisma-next/family-sql` itself (currently in the failing set, but only via cascade from cli; family-sql's own typecheck should pass and remain green for slice 2). The slice plan must verify `@prisma-next/family-sql typecheck` is green pre-slice and stays green. |
| The family currently has no `descriptorMeta` slot — adding `types.queryOperationTypes` is new surface | Handle | The family's control descriptor today carries `emission` and `authoring`. Adding `types.queryOperationTypes` is purely additive — no consumer of the family descriptor pattern-matches on `types` being absent. The control-stack's `extractQueryOperationTypeImports` already guards on `descriptor.types?.queryOperationTypes` (line 117) — undefined-safe. |
| `createSqlExecutionStack` callers continue to work without family arg | Handle | `family?: SqlRuntimeFamilyDescriptor` is optional with default `sqlRuntimeFamilyDescriptor`. All ~8 existing call sites (`postgres.ts`, `sqlite.ts`, `sql-orm-client/test/helpers.ts`, etc.) continue to work unmodified. The test that proves this: existing test suites pass without modification (the workspace's `pnpm test:packages` is the bar). |
| Family runtime descriptor needs `codecs()` returning `[]` | Handle | `SqlStaticContributions` requires `codecs: () => readonly[]`. The family owns no codecs (targets and adapters own them). The empty-array contribution is structurally correct and exercises the `collectCodecDescriptors` loop's empty-input handling, which has no special branch (existing `for (const descriptor of contributor.codecs()) { ... }` simply skips empty contributions). |
| `ne` vs `neq` naming carry-over for slice 3 | Defer (named explicitly in § Out of scope) | The family uses `neq` (matching `COMPARISON_METHODS_META`). `BuiltinFunctions['ne']` continues to exist until slice 3. Slice 3 deletes `BuiltinFunctions` and migrates any sql-builder consumer that uses `fns.ne(...)` to `fns.neq(...)`. Slice 2's spec records this for slice 3's plan to thread. |
| Family operations name choice: `neq` vs `ne` | Handle | Chosen: `neq`. Reason: `COMPARISON_METHODS_META` uses `neq`; renaming `fns.ne` callers in slice 3 is fewer surfaces to touch than renaming every `column.neq` ORM caller. The project spec § Approach trait-mapping table uses `neq` (FR1 is consistent). The project plan slice 2 description used `ne` — treating that as the slice author's shorthand, overridden here by the consistent project spec wording. |
| Lock-step between SQL family's runtime factory and the contract's emitted type alias | Handle | The runtime factory's return type IS `QueryOperationTypes<CT>` (the type-only twin in `types/operation-types.ts`). The `satisfies QueryOperationTypes<CT>` constraint on the factory body keeps them structurally in lock-step at compile time. If the implementer drifts the runtime away from the type-level shape, the family-sql package's typecheck fails. |
| Implementer might be tempted to delete legacy surfaces in this slice | Explicitly out | Deletion is slice 3's territory. The slice spec's `## Out of scope` enumerates the legacy surfaces explicitly. The intent-validation gate in the slice plan must catch any diff that touches `model-accessor.ts`, `sql-orm-client/src/types.ts:309+`, or `sql-builder/runtime/functions.ts`. |

## Contract impact

**Affected contract-surface types.** The contract's `queryOperationTypes` slot today carries adapter + extension operation types only (via `descriptorMeta.types.queryOperationTypes` on each contributor). After slice 2, the family also contributes — its `QueryOperationTypes<CT>` alias intersects into the generated contract's `QueryOperationTypes` alongside the existing contributions. Concretely, a `contract.d.ts` for a stack with the SQL family + postgres adapter will see `QueryOperationTypes = SqlFamilyQueryOperationTypes<CodecTypes> & PgAdapterQueryOps<CodecTypes>` (alias names are the implementer's call).

**Migration plan for downstream consumers.** Purely additive. No downstream consumer is forced to use the new entries; the registry surfaces them but the ORM model accessor and sql-builder `fns` proxy both still take their primary signal from `COMPARISON_METHODS_META` / `BuiltinFunctions` respectively. Slice 3 is the slice that activates the new entries by deleting the legacy surfaces. Cipherstash and pgvector extensions continue to register their own ops; no name collision with the 15 family names.

**Verification.** A snapshot test in the family-sql package emits a fixture contract from a known stack (default family + postgres adapter + no extensions) and asserts the generated `contract.d.ts` includes the family's `QueryOperationTypes` import + intersection. A round-trip test (validate the emitted contract, build an `ExecutionContext`, assert `context.queryOperations.entries()` contains all 15 family ops) confirms the chain end-to-end.

## Adapter impact

**Low — but worth a sniff test.** No adapter code is touched directly. The family's `descriptorMeta.types.queryOperationTypes` flows through the **same** alias-aggregation logic at `extractQueryOperationTypeImports` (`control-stack.ts:111-124`) that adapters use today. The function reads `descriptor.types?.queryOperationTypes` — identical handling for the family and adapters. Verify by emitting a contract for a stack that includes both family contribution and the postgres adapter's contribution; the resulting `QueryOperationTypes` alias should be a clean intersection of both (no precedence policy needed; the alias-aggregation step simply intersects all contributors' types).

## ADR pointer

Defers to slice 5's close-out ADR ("ADR NNN — Unified SQL-family operation registry"), per the project plan slice 5. This slice does not draft a separate ADR; the architectural shift is recorded in the close-out ADR alongside slices 1, 3, and 4.

## Slice Definition of Done

- [ ] **SDoD1.** All "Done when" gates from the slice plan pass: `pnpm --filter @prisma-next/family-sql build` clean; `pnpm --filter @prisma-next/family-sql test` green (new tests included); the 5-package targeted typecheck (or extended to include family-sql) is green; `pnpm lint:deps` clean; intent-validation confirms diff matches slice scope (no edits to ORM model accessor, sql-builder `fns` proxy, or `COMPARISON_METHODS_META` / `BuiltinFunctions`).
- [ ] **SDoD2.** Every pre-named edge case handled per its disposition.
- [ ] **SDoD3.** Reviewer verdict: accept on `projects/unify-query-operations/reviews/code-review.md` (the same review log slice 1 used, scoped to slice 2's ACs).
- [ ] **SDoD4.** Manual-QA: **N/A — no user-observable change.** The slice registers operations in the registry but neither authoring surface reads them (legacy surfaces still active). End-to-end ORM queries and sql-builder `fns` calls produce byte-identical SQL before and after this slice. Slice 3 is the first slice with user-observable change (the cipherstash trait tightening + the orderBy callback accessor split).
- [ ] **SDoD5.** Slice doesn't touch surfaces listed as out-of-scope. Specifically: no edits to `packages/3-extensions/sql-orm-client/src/model-accessor.ts`, `packages/3-extensions/sql-orm-client/src/types.ts:309+` (`COMPARISON_METHODS_META`), `packages/2-sql/4-lanes/sql-builder/src/runtime/functions.ts` (`BuiltinFunctions`), or any `asc` / `desc` ordering primitive.
- [ ] **SDoD6.** `Contract['queryOperationTypes']` includes the family's 15 op names at the type level. A snapshot or round-trip test confirms the emitted `contract.d.ts` carries the alias intersection.
- [ ] **SDoD7.** `context.queryOperations.entries()` contains the 15 family op names at runtime. A direct test on the registry, not via either consumer surface.
- [ ] **SDoD8.** Trait gating verified at registry-assembly time: trait-targeted ops index under codecs whose descriptor's `traits` set matches; `any: true` ops index under every codec; no-`self` ops do not surface on any codec's per-column index. A direct test on the registry's per-codec index, not via the ORM accessor.
- [ ] **SDoD9.** No regression in existing tests — `pnpm test:packages` workspace-wide for the 5-package targeted set (operations, sql-contract, family-sql, sql-orm-client, cipherstash, pgvector) is byte-identical to the pre-slice state, modulo the new family-sql tests added in this slice.

## Open Questions

1. **Should the family contribute `codecs: () => []` explicitly or should `SqlStaticContributions.codecs` become optional?** Working position: explicit empty contribution. Reasoning: keeping `codecs` required on `SqlStaticContributions` enforces the invariant that every SQL contributor declares its codec contribution (even if empty). The family's `codecs: () => []` makes the empty contribution intentional and grep-discoverable. Alternative considered: making `codecs?` optional and the family omitting it — adds an undefined-check to the `collectCodecDescriptors` loop without buying anything. Resolved at implementation; if the implementer reverses this, surface for orchestrator review.
2. **Should the slice add a `descriptor-meta.ts` file to the family package mirroring how adapters / extensions organize?** Working position: yes, for consistency. The family's `core/` currently has `runtime-descriptor.ts` and `control-descriptor.ts` separately; adding a sibling `descriptor-meta.ts` (or extending one of them) keeps the file organization aligned with `packages/3-extensions/pgvector/src/core/descriptor-meta.ts`. The implementer chooses placement; the slice plan can refine.
3. **Lowering parity with `COMPARISON_METHODS_META` and `BuiltinFunctions`.** The family's `impl`s must produce byte-identical AST nodes to today's two surfaces for the slice 3 deletion to be a no-op on emitted SQL. Working position: copy the lowering shape directly from the two surfaces (e.g. `BinaryExpr` for `eq` / `neq` / `gt` / etc., `NullCheckExpr` for `isNull` / `isNotNull`, `AndExpr` / `OrExpr` for `and` / `or`, `ExistsExpr` for `exists` / `notExists`, `BinaryExpr` with `op='in'` and a `ListExpression` for `in` / `notIn`). The implementer verifies parity by inspecting the AST output before and after for a fixed set of `where` clauses.
4. **Type-level helper naming for FR17.** Working position: `EqualityCodecId<CT>` / `OrderCodecId<CT>` / `TextualCodecId<CT>` as helper types in `types/operation-types.ts`. The implementer can rename for clarity; the constraint is they resolve to the union of CT codec ids whose trait sets include the relevant trait, matching ADR 203's "How matching works" mechanism for `fns.ilike`.

## References

- Parent project: [`../../spec.md`](../../spec.md) FR1-FR4, FR15-FR17, AC2/AC5/AC6/AC11/AC12. Project plan slice 2 description.
- Linear issue: TML-2354 (project-level; no per-slice sub-issue). Per the project plan's amended delivery model (single PR at project close), this slice does not open its own PR.
- ADR 203 (trait-targeted operation arguments) and ADR 206 (operations as TypeScript functions) — the patterns the family factory follows.
- Pattern references in-repo:
  - `packages/3-extensions/pgvector/src/core/descriptor-meta.ts:17-58` — the model for `sqlFamilyOperations<CT>()`.
  - `packages/3-extensions/pgvector/src/types/operation-types.ts` — the model for `QueryOperationTypes<CT>` type-only twin.
  - `packages/3-extensions/pgvector/src/core/descriptor-meta.ts:97-103` — the model for the family's `types.queryOperationTypes` slot.
  - `packages/2-sql/5-runtime/src/sql-context.ts:766-770` — the contributors array to extend.
  - `packages/1-framework/1-core/framework-components/src/control/control-stack.ts:111-124,353` — the emitter alias-aggregation step (already iterates `family`).
  - `packages/2-sql/4-lanes/sql-builder/src/runtime/functions.ts:137-161` — `createBuiltinFunctions()` is the source for the 15 ops' lowering shapes (slice 3 deletes it; slice 2 copies the shapes).
  - `packages/3-extensions/sql-orm-client/src/types.ts:309-378` — `COMPARISON_METHODS_META` is the source for trait gates and binary-op lowering parity.
