# Summary

Unify built-in and extension query operations behind a single SQL-family operation registry. Delete `COMPARISON_METHODS_META` (ORM) and `BuiltinFunctions` (sql-builder); both authoring surfaces source every operation — common or not — from the same registry. Prefer trait-targeted `self` over codec-id `self` for common operations so they apply to any codec that opts in.

# Context

## At a glance

Today, a SQL field's comparison surface is assembled from three sources that don't know about each other:

- **ORM**: `COMPARISON_METHODS_META` — a hardcoded record in `sql-orm-client` enumerating `eq`, `gt`, `like`, `asc`, `isNull`, … with trait gates.
- **sql-builder `fns`**: `BuiltinFunctions<CT>` — a hardcoded type and matching `createBuiltinFunctions()` factory enumerating `eq`, `ne`, `and`, `or`, `exists`, `in`, … with **no trait gating** — `fns.eq(cipherstashCol, cipherstashCol)` typechecks today even though the cipherstash codec opts out of `equality`.
- **Operation registry**: the extension-facing pipeline (`SqlOperationRegistry`, the `queryOperations()` factories from contributors) — already trait-aware, already wired into both surfaces, used by `ilike`, `cosineDistance`, `cipherstashEq`, etc.

The two authoring surfaces will source every operation from a single registry — call it the **SQL family operations registry** — shipped by the SQL family (`@prisma-next/family-sql`). Built-ins (`eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `like`, `in`, `notIn`, `isNull`, `isNotNull`, `asc`, `desc`, `and`, `or`, `exists`, `notExists`) are registered there as `SqlOperationDescriptor` entries authored as TypeScript functions per [ADR 206](../../docs/architecture%20docs/adrs/ADR%20206%20-%20Operations%20as%20TypeScript%20functions.md). Where applicable, their `self` is trait-targeted (`eq` → `{ traits: ['equality'] }`, `gt` → `{ traits: ['order'] }`, `like` → `{ traits: ['textual'] }`), so a codec that does not declare the trait does not see the operation on either surface. `COMPARISON_METHODS_META`, `BuiltinFunctions<CT>`, and `createBuiltinFunctions()` are deleted.

_Illustrative — exact shape of one built-in once migrated. Final names and helpers are the implementer's choice; the binding constraint is that the entry sits in the SQL family registry (inside `@prisma-next/family-sql`) and the surfaces source it from there._

```ts
// In @prisma-next/family-sql
export function sqlFamilyOperations<CT extends CodecTypesMap>(): SqlOperationDescriptors {
  return {
    eq: {
      self: { traits: ['equality'] },
      impl: <CodecId extends string>(
        a: TraitExpression<'equality', boolean, CT> | null,
        b: CodecExpression<CodecId, boolean, CT> | null,
      ): Expression<BooleanCodecType> => { /* ...buildOperation(...) */ },
    },
    gt: {
      self: { traits: ['order'] },
      impl: /* same shape, traits: ['order'] */,
    },
    and: {
      // No self — applies regardless of codec; not reachable as a column method.
      impl: (...exprs: Expression<BooleanCodecType>[]): Expression<BooleanCodecType> => { /* ... */ },
    },
    // … like, in, notIn, isNull, isNotNull, asc, desc, or, exists, notExists, ne, lt, lte, gte
  };
}
```

## Problem

Two parallel hardcoded definitions exist for what is conceptually one set of operations. Adding a new common predicate (say, `between`) means editing `COMPARISON_METHODS_META`, editing `BuiltinFunctions<CT>` and `createBuiltinFunctions()`, and keeping the two definitions semantically aligned. Trait gating is asymmetric across them: the ORM honours codec traits (so cipherstash columns lose `.eq` because their codec declares `traits: []`), while the sql-builder `fns.eq` is generic over codec id and applies to any expression, so `fns.eq(cipherstashCol, cipherstashCol)` typechecks. The same operation has two different "is this callable here?" answers depending on which authoring surface you reach for.

Extensions already have a clean story — they ship `queryOperations()` contributors that produce `SqlOperationDescriptor` entries with `self: { codecId }` or `self: { traits }` ([ADR 203](../../docs/architecture%20docs/adrs/ADR%20203%20-%20Trait-targeted%20operation%20arguments.md)), authored as TypeScript functions ([ADR 206](../../docs/architecture%20docs/adrs/ADR%20206%20-%20Operations%20as%20TypeScript%20functions.md)). Those entries flow into both the ORM model accessor and the sql-builder `fns` surface through the same registry. Built-ins are the exception: ADR 203 explicitly carved them out (_"Migration of built-in comparisons to trait-targeted operations"_ is listed as a non-goal) and ADR 206 echoed it (_"Changing the built-in comparison methods"_ likewise listed as a non-goal). Both ADRs were correct for what they shipped, but the carve-out has now become friction: it forces every new SQL family target to re-implement the same operator set, prevents new common operations from being added in a single place, and is the root cause of the asymmetric trait gating between ORM and sql-builder.

Internal changes that touch the comparison surface (e.g., changing what `like` returns, or how `in` resolves codecs for its list operand) hit both hardcoded sites plus the registry-based extension dispatch — three code paths that must agree by hand. The motivating goal of this project is to make the comparison surface mechanically uniform with the rest of the registry.

## Approach

**One registry, two consumers.** The SQL family ships a `queryOperations()` factory ([ADR 206](../../docs/architecture%20docs/adrs/ADR%20206%20-%20Operations%20as%20TypeScript%20functions.md) style — generic over the contract's `CT` codec-types map) that registers every operation today defined in `COMPARISON_METHODS_META` and `BuiltinFunctions<CT>`. The contract-assembly layer instantiates this factory the same way it instantiates extension and adapter factories; the resulting entries land in the `SqlOperationRegistry` carried by `ExecutionContext.queryOperations`. The registry is the single source of truth for both authoring surfaces:

- **ORM model accessor.** Today, `createScalarFieldAccessor` synthesizes two sets of methods on a column accessor: built-ins via `COMPARISON_METHODS_META` filtered by codec traits, and extension ops via the registry's per-codec index. After this project, it synthesizes one set, from the registry alone. The trait-filtering logic in the model accessor stays — it already correctly handles trait-targeted `self` — it just no longer has a second `COMPARISON_METHODS_META` loop.
- **sql-builder `fns` surface.** Today, `createFunctions` returns a Proxy that checks `createBuiltinFunctions()` first, then falls back to `operations[prop].impl`. After this project, the Proxy only checks `operations[prop].impl` — `createBuiltinFunctions` is gone. The `Functions<QC>` type drops the `BuiltinFunctions<CT> &` intersection and becomes purely `DeriveExtFunctions<QC['queryOperationTypes']>` (which, since the registry now also carries the built-ins, includes everything that used to live in `BuiltinFunctions`).

**Two registries, owned by their consumers.**

- The **SQL family operations registry** (in `@prisma-next/family-sql`) holds operations consumed by both authoring surfaces — predicates and value-returning operations. Both the ORM column accessor (for WHERE/HAVING) and the sql-builder `fns` proxy source from it.
- The **ORM ordering-operations registry** (private to `@prisma-next/sql-orm-client`) holds `asc`/`desc` and any future orderBy primitives. It is consulted only by the ORM's orderBy callback accessor. The sql-builder does not see it; it is not part of the contract's emitted `queryOperationTypes` map.

This split reflects ownership: the contract describes operations that are interoperable across authoring surfaces; orderBy primitives are an authoring concern of the lane that uses them and don't need to be in the contract.

**Trait-first authoring for common operations.** Every operation today in `COMPARISON_METHODS_META` already declares its trait dependency in its meta entry. Migrating them preserves that gating verbatim:

| Operation                                | Registry         | `self`                              |
|------------------------------------------|------------------|-------------------------------------|
| `eq`, `neq`, `in`, `notIn`               | SQL family       | `{ traits: ['equality'] }`          |
| `gt`, `gte`, `lt`, `lte`                 | SQL family       | `{ traits: ['order'] }`             |
| `like`                                   | SQL family       | `{ traits: ['textual'] }`           |
| `isNull`, `isNotNull`                    | SQL family       | `{ any: true }` — every codec       |
| `and`, `or`, `exists`, `notExists`       | SQL family       | _no `self`_ — sql-builder only      |
| `asc`, `desc`                            | ORM ordering     | `{ traits: ['order'] }`             |

**Accessors filter the SQL family registry by return shape.** Each authoring context surfaces only operations whose return shape is meaningful for that context. The descriptors themselves carry no `context` marker — the filter rule is per-accessor:

| Accessor / surface              | Filter over the SQL family registry                                        |
|---------------------------------|----------------------------------------------------------------------------|
| WHERE-style column accessor     | ops whose `self` matches the column's codec **and** whose return codec is `boolean`-traited (predicates) |
| HAVING aggregate selector       | ops whose `self` matches the aggregate's return codec **and** whose return codec is `boolean`-traited |
| sql-builder `fns` proxy         | every op in the family registry (`self`-matching is per call, by argument type) |
| orderBy accessor                | ops from the **ORM ordering registry** whose `self` matches the column's codec |

This kills two pieces of today's hand-curation: the `Pick<…>` in `HavingComparisonMethods<T>` (HAVING now derives from the predicate-return filter, same as WHERE), and the cosmetic leak of `.asc()`/`.desc()` onto the WHERE-style column accessor (since `asc`/`desc` live in a registry the WHERE accessor doesn't see).

**Side-effect: trait gating becomes uniform across surfaces.** Once both family-registry consumers source from one registry, `fns.eq` and `column.eq` reach the same descriptor, and a codec that opts out of `equality` is unreachable on both. Today's asymmetry (cipherstash columns lose `.eq` on the ORM but `fns.eq` still accepts them) goes away. This is a deliberate behaviour change, not an accident of the refactor.

**Extensions remain unchanged.** Extension `queryOperations()` factories already produce `SqlOperationDescriptor` entries with the right shape. They register alongside the family operations and dispatch identically. The "is it a built-in or an extension" distinction stops being a code-path distinction and becomes a registration-time provenance distinction (who registered the descriptor: the family, an adapter, or an extension).

**Supersedes two ADR carve-outs via a new ADR.** ADR 203 ("Non-goals: Migration of built-in comparisons to trait-targeted operations") and ADR 206 ("Non-goals: Changing the built-in comparison methods") explicitly excluded this work. Both carve-outs are now reversed. The project's close-out drafts a new ADR that records the unified-registry decision and supersedes the two non-goal lines in ADR 203 and ADR 206 by reference. The positive technical content of both ADRs (trait-targeted `self`, operations-as-TypeScript-functions) survives unchanged and is built upon by the new ADR.

# Requirements

## Functional Requirements

### SQL family operation registry

- **FR1.** The SQL family ships a `queryOperations()` factory (matching the ADR 206 contributor shape) in the existing `@prisma-next/family-sql` package (`packages/2-sql/9-family/`). The factory registers every operation currently defined in `BuiltinFunctions<CT>` and the **predicate / value-returning** operations from `COMPARISON_METHODS_META` (`eq`, `neq`, `in`, `notIn`, `gt`, `lt`, `gte`, `lte`, `like`, `isNull`, `isNotNull`, plus `and`, `or`, `exists`, `notExists` from `BuiltinFunctions`). `asc` and `desc` are **not** part of this registry — see FR18. The factory is generic over the contract's codec-types map. No new package is added.
- **FR2.** The contract-assembly layer calls the family `queryOperations()` factory the same way it calls adapter and extension factories. Family operations land in the same `SqlOperationRegistry` instance carried by `ExecutionContext.queryOperations`.
- **FR3.** Family operation entries declare `self` as trait-targeted (`{ traits: [...] }`) where the operation's reachability on a column is determined by codec capability today. The trait sets match the existing `COMPARISON_METHODS_META` entries: `eq`/`neq`/`in`/`notIn` → `['equality']`; `gt`/`lt`/`gte`/`lte` → `['order']`; `like` → `['textual']`.
- **FR4.** Family operations that apply regardless of codec on the sql-builder surface but are not reachable as column methods (`and`, `or`, `exists`, `notExists`) are registered with no `self`. The sql-builder's `fns` Proxy exposes them; the ORM column accessor does not surface them as column methods.
- **FR5.** Null-check operations (`isNull`, `isNotNull`) remain reachable as column methods on every codec. They are registered with `self: { any: true }` — a new third arm of the `SelfSpec` discriminated union that means "applies to every codec, regardless of trait set." Concretely:
  - `SelfSpec` in `packages/1-framework/1-core/operations/src/index.ts` gains a third member: `{ readonly any: true; readonly codecId?: never; readonly traits?: never }`. The existing `codecId | traits` discriminated-union mutual exclusion extends to `any` (you set exactly one of the three).
  - The registration validator in `createOperationRegistry` (`packages/1-framework/1-core/operations/src/index.ts:42-50`) accepts the new arm: exactly one of `codecId`, `traits`, `any` must be set when `self` is present.
  - The ORM model accessor's resolution loop (`packages/3-extensions/sql-orm-client/src/model-accessor.ts:71-83`) gains a branch: when `self.any` is `true`, the op is indexed under every codec in the registry.
  - The type-level matcher `OpMatchesField` in `packages/3-extensions/sql-orm-client/src/types.ts:224-238` gains a clause: `Self extends { readonly any: true }` returns `true` for any field.
  - Every other consumer that switches on the existing `codecId | traits` discrimination (registry-driven types, contract-emit codepaths, debug printers) must be updated to handle the third arm. `pnpm typecheck` is the safety net.
  - The user-visible surface does not regress: every column type that has `.isNull()` today continues to have it.

### ORM ordering-operations registry

- **FR18.** The ORM client (`@prisma-next/sql-orm-client`) ships its **own** operation registry containing `asc` and `desc`. The registry uses the same `SqlOperationDescriptor` shape and the same trait-targeted matching primitive as the SQL family registry (so `asc`/`desc` declare `self: { traits: ['order'] }` and trait-expand at registry construction time, identical to the family-side mechanism). The registry is constructed inside the ORM, not contributed by the SQL family or by the contract.
- **FR19.** The ORM ordering registry is **not** wired into the contract's `descriptorMeta.types.queryOperationTypes`. `asc`/`desc` do not appear in the generated contract's `QueryOperationTypes` alias, are not visible to the sql-builder, and are not surfaced on the WHERE/HAVING/column accessor. Their visibility is limited to the orderBy callback accessor (see FR21).
- **FR20.** Extension contributions to the ORM ordering registry are out of scope. The ORM ordering registry is closed at this layer: only `asc`/`desc` are registered. A future project may introduce a contributor slot for extension-defined ordering primitives (e.g. `ascNullsFirst`); this project does not.

### Accessor surfaces and return-type filtering

- **FR21.** The ORM's accessor synthesis uses two independent registry consultations:
  - The **WHERE-style column accessor** (used in `where`, `having`, and other predicate contexts) sources operations from the SQL family registry filtered by *(a)* `self` matches the column's codec (existing trait-expansion logic), *and (b)* return codec carries the `boolean` trait (predicate-return filter). `asc`/`desc` cannot appear on this accessor because the ORM ordering registry is not consulted by this code path.
  - The **orderBy callback accessor** sources operations from the ORM ordering registry filtered by `self`-trait match against the column's codec. The SQL family registry is not consulted by this code path. The accessor exposes only the column's `OrderByItem`-returning methods (today: `asc`, `desc`).
- **FR22.** The **HAVING aggregate selector** sources operations from the SQL family registry filtered by *(a)* `self`-trait match against the aggregate's return codec (e.g. `pg/int8@1` for `count`, the column's codec for `sum`/`avg`/`min`/`max`), *and (b)* return codec carries the `boolean` trait. The hand-listed `HavingComparisonMethods<T> = Pick<ComparisonMethods<T, …>, 'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte'>` is **deleted**; the HAVING method surface is derived from the registry by the predicate-return rule. The net set on numeric aggregates becomes `eq | neq | in | notIn | gt | lt | gte | lte | isNull | isNotNull` (`like` is excluded by the textual-trait gate on numeric codecs). This is a deliberate, documented widening of the HAVING surface.
- **FR23.** The **sql-builder `fns` proxy** sources operations from the SQL family registry only. `asc`/`desc` are not visible on `fns` (they live in a registry `fns` does not consult). This preserves today's `fns` surface — `fns.asc` does not typecheck before or after this project.

### Emitter wiring for family operation types

- **FR15.** The SQL family contributes a `descriptorMeta` entry with `types.queryOperationTypes` so the emitter's existing alias-aggregation step (`packages/2-sql/3-tooling/emitter/src/index.ts:332-342`) lifts the family's operation types into the generated contract's `QueryOperationTypes` alias. Today only adapter/extension `descriptorMeta` carries this slot (e.g. `packages/3-targets/6-adapters/postgres/src/core/descriptor-meta.ts:278-284`); the family does not. After this project the family does, alongside a published `QueryOperationTypes<CT>` type matching the runtime factory.
- **FR16.** Authored `impl` functions for `in` / `notIn` (and any other operation whose user-facing signature needs more than a single arrow type) are free to use TypeScript overloads. ADR 206 explicitly permits this.

### Binary operator signatures

- **FR17.** Binary trait-gated operators (`eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `in`, `notIn`) are authored with a trait-constrained codec-id generic that ties both operands to the same codec id. The generic is constrained to the union of codec ids in `CT` whose declared traits contain the operation's required trait — i.e., the same "inverse trait → codec ids" resolution that ADR 203 already describes for `fns.ilike` ([ADR 203](../../docs/architecture%20docs/adrs/ADR%20203%20-%20Trait-targeted%20operation%20arguments.md), "How matching works"). The user-visible signature shape is:

  ```ts
  // Illustrative — helper name is the implementer's choice.
  // `EqualityCodecId<CT>` resolves to the union of codec ids in CT
  // whose trait set contains 'equality'.
  impl: <CodecId extends EqualityCodecId<CT>>(
    a: CodecExpression<CodecId, boolean, CT> | null,
    b: CodecExpression<CodecId, boolean, CT> | null,
  ) => Expression<BooleanCodecType>
  ```

  Two consequences flow from this:
  - **Trait gating is in the signature.** Calling `fns.eq` on a codec without the required trait fails type-checking at the call site, not at a downstream derivation. This is how the cipherstash tightening (FR9 / AC3) is realised on `fns`.
  - **Operands stay symmetric.** Both `a` and `b` must share the inferred codec id, matching today's `BuiltinFunctions['eq']` ergonomics. The implementer must not write asymmetric signatures (e.g. `TraitExpression<...>` for `a`, free `CodecExpression<CodecId, ...>` for `b`) — they'd allow `fns.eq(textCol, intCol)`-style calls to typecheck.

### Removal of legacy surfaces

- **FR6.** `COMPARISON_METHODS_META` in `packages/3-extensions/sql-orm-client/src/types.ts` is deleted. Every reader — the model accessor's built-in loop at line 141, the extension-method return-type wrapper at line 182, the `HavingComparisonMethods<T>` type at line 514 — is updated to source operations from the SQL family registry (for predicates) or the ORM ordering registry (for `asc`/`desc`), filtered by the return-shape rules in FR21–FR23. `HavingComparisonMethods<T>` is deleted outright (FR22); its replacement is derived structurally.
- **FR7.** `BuiltinFunctions<CT>` in `packages/2-sql/4-lanes/sql-builder/src/expression.ts` is deleted. `Functions<QC>` no longer references it. `createBuiltinFunctions()` in `runtime/functions.ts` is deleted; the Proxy in `createFunctions` performs a single registry lookup.
- **FR8.** Aggregate-only functions (`count`, `sum`, `avg`, `min`, `max`) are **out of scope** for this project. `AggregateOnlyFunctions` and `createAggregateOnlyFunctions` remain hardcoded in sql-builder. See Non-goals.

### Trait gating becomes uniform

- **FR9.** After this project lands, the sql-builder `fns.eq`, `fns.ne`, `fns.gt`, etc. only accept expressions whose codec declares the operation's required traits. A codec with `traits: []` (e.g., cipherstash) is rejected by `fns.eq` at the type level, matching the ORM model accessor's behaviour today.
- **FR10.** The ORM model accessor's per-column method synthesis (`createScalarFieldAccessor`) becomes a single loop over the registry's per-codec index — no separate `COMPARISON_METHODS_META` loop.

### Backward-compat policy

- **FR11.** No backward-compat shims. Every consumer of `COMPARISON_METHODS_META`, `BuiltinFunctions<CT>`, `createBuiltinFunctions`, or any name re-exported from those — inside the repo or in the demo/examples — is updated in the same change. Type imports for the removed types are removed, not re-routed.

### Adapter/extension impact

- **FR12.** Adapters and extensions that today register operations via `queryOperations()` are not modified by this project (they already use the registry pattern). If a name collision is introduced (e.g., an extension named one of its operations `eq` before this project), the project surfaces the collision as a build error and the extension is renamed — no priority/precedence policy is introduced.

### Type-level surface

- **FR13.** The ORM column accessor's `ComparisonMethods<T, Traits>` type is preserved as the public-facing wrapper for non-predicate operation return types. Its filtering logic (only expose method `K` if the column's traits include the meta's required traits) is sourced from the registry instead of `COMPARISON_METHODS_META`. The published type expressivity (e.g. `eq` accepts `T | null`, returns `Expression<bool>`) is preserved.
- **FR14.** The sql-builder `Functions<QC>` type composes purely from `DeriveExtFunctions<QC['queryOperationTypes']>` — i.e., from the contract's `queryOperationTypes` map. Because the contract's `queryOperationTypes` now includes the family operations, the user-visible callable set on `fns` is the same union as today.

## Non-Functional Requirements

- **NFR1. Registration cost.** Trait-targeted operation expansion at registry assembly is O(operations × codecs); it runs once at `ExecutionContext` construction. The added work for the family operations (≈13 trait-targeted entries × N codecs) must not measurably regress execution-context construction time on the existing benchmarks. Field access on column accessors must remain a single map lookup ([ADR 203](../../docs/architecture%20docs/adrs/ADR%20203%20-%20Trait-targeted%20operation%20arguments.md) hot-path argument).
- **NFR2. Type-check time.** The contract's `queryOperationTypes` map gains ≈17 new entries. The resulting `Functions<QC>` type and `ComparisonMethods<T, Traits>` derivation must not measurably regress type-check time on the demo or the existing test suite. If it does, the implementer must investigate (e.g., shared `infer` slots, distributive conditional types) rather than ship a regression.
- **NFR3. Bundle size.** Removing `COMPARISON_METHODS_META`, `BuiltinFunctions<CT>`, and `createBuiltinFunctions()` while adding the equivalent registry entries should be size-neutral or smaller. The implementer should not introduce a parallel re-export layer that defeats this.

## Non-goals

- **Aggregate functions** (`count`, `sum`, `avg`, `min`, `max`). They live in a separate `AggregateOnlyFunctions` hardcoded list. Migrating them is a natural phase 2 but is excluded here because (a) they are not column methods, (b) they have different scoping rules (only available inside `groupBy`/`having`), and (c) extending the registry to express aggregate-only availability would broaden this project's design surface. The same rationale applies to anything that today depends on aggregate-only scope (`HavingBuilder`).
- **Document/Mongo family.** No document-family operation registry exists today. Introducing one is out of scope. This project unifies SQL-family operations only.
- **Operation-name collision policy.** If an extension previously named one of its operations the same as a soon-to-be-registered family operation, the build will fail. This project does not introduce a precedence rule, an override mechanism, or a "shadowing" warning — collisions are an authoring error and are renamed at registration.
- **A common-vs-family operation distinction at the registry level.** The registry remains flat. Family-registered operations are not flagged differently from extension-registered ones beyond their registration site.
- **Schema/contract format changes.** The contract's `queryOperationTypes` shape, the descriptor shape, and the registry's `register(name, descriptor)` API are unchanged. Only registration sites change.
- **Migration of `OrderByItem` / `NullCheckExpr` AST nodes.** Built-in operations are migrated as authored functions that emit the same AST nodes they emit today. AST changes are out of scope.

# Acceptance Criteria

- [ ] **AC1. The legacy surfaces are gone.** A repo-wide search for `COMPARISON_METHODS_META`, `BuiltinFunctions`, and `createBuiltinFunctions` finds no production references. Covers FR6, FR7.
- [ ] **AC2. The family registers operations through the standard contributor surface.** The SQL family package exposes a `queryOperations()` factory that returns descriptors for every operation previously hardcoded. The contract-assembly site that aggregates extension operations also reads this factory; no separate code path is added for family operations. Covers FR1, FR2.
- [ ] **AC3. Trait gating is symmetric.** A test that calls `fns.eq(cipherstashColumn, cipherstashColumn)` fails type-checking, mirroring the ORM model accessor's existing behaviour for the same column. A symmetric test on a codec that declares the relevant trait (e.g., `pg/text@1` for `like`) typechecks on both surfaces. Covers FR3, FR9.
- [ ] **AC4. Per-column ORM method surface is unchanged.** For every codec in the test contracts (pg core codecs + cipherstash + arktype-json + any pg/vector-like codec), the set of comparison methods exposed on its ORM column accessor is identical before and after this project, modulo the cipherstash `.eq`/`.in` behaviour change called out in AC3 (which already matched ORM behaviour today — no regression). Covers FR10, FR13.
- [ ] **AC5. `fns` surface is callable for the same names as today.** Every `fns.<name>` call that was valid before this project (e.g., `fns.eq`, `fns.and`, `fns.exists`, `fns.notIn`, `fns.ilike`) is still valid afterwards, with the trait-tightening from AC3 the only intentional difference. Covers FR4, FR7, FR14.
- [ ] **AC6. `isNull`/`isNotNull` reachable everywhere via `self: { any: true }`.** The `isNull`/`isNotNull` family-registry entries declare `self: { any: true }`. Every column type that today has `.isNull()`/`.isNotNull()` continues to. A test against a codec with empty traits (e.g., cipherstash) confirms this. A registration test confirms that omitting `self` entirely (no `codecId`, no `traits`, no `any`) still throws, and that setting more than one of the three throws. Covers FR5.
- [ ] **AC7. No backward-compat shims.** No file in the repo re-exports any of the removed names, no deprecated alias is introduced, and the demo/examples are updated in the same change. `pnpm lint:deps` passes. Covers FR11.
- [ ] **AC8. HAVING surface is derived, not hand-listed.** `HavingComparisonMethods<T>` is deleted. The HAVING method set on aggregate selectors is derived from the SQL family registry by the predicate-return filter (FR22). A type-level test on a numeric aggregate (e.g. `sum(intField)`) demonstrates the new surface: `eq | neq | in | notIn | gt | lt | gte | lte | isNull | isNotNull` available, `like` not available (textual trait gate). A type-level test on the same aggregate confirms `.asc()` / `.desc()` are not callable in HAVING (they live in the ORM ordering registry, which HAVING does not consult). Covers FR6 (transitive), FR22.
- [ ] **AC9. End-to-end ORM query still builds and emits correct SQL.** The existing query-build integration tests (predicates on `where`, ordering, null checks, `in` with lists and with subqueries) pass with no modification. SQL output is byte-identical to before the project, since the underlying AST nodes are unchanged. Covers FR1–FR10 indirectly.
- [ ] **AC10. New ADR supersedes the ADR 203 / ADR 206 carve-outs.** A new ADR is drafted at close-out that records the unified-registry decision and explicitly supersedes the "Migration of built-in comparisons …" and "Changing the built-in comparison methods" non-goal lines in ADR 203 and ADR 206. Both prior ADRs gain a "Superseded in part by ADR NNN" note pointing at the new ADR. Covers project hygiene; not strictly a code AC.
- [ ] **AC11. Family contract emission picks up family operation types.** The emitted `contract.d.ts` for a contract whose family is `sql` contains the family's operation types intersected into the `QueryOperationTypes` alias (alongside any adapter/extension types). A round-trip test (emit + typecheck + call `fns.eq`/`column.eq` on a generated contract) confirms the chain works end-to-end. The emitted `QueryOperationTypes` does **not** contain `asc`/`desc` (they're ORM-private, FR19). Covers FR15, FR19.
- [ ] **AC12. Binary operator signatures gate by trait and tie operands.** Type-level tests demonstrate: (a) `fns.eq(intCol, intCol)` typechecks; (b) `fns.eq(textCol, intCol)` fails type-checking (codec ids don't match); (c) `fns.eq(cipherstashCol, cipherstashCol)` fails type-checking (codec lacks `equality` trait). Same trio for `gt` / `lt` / `gte` / `lte` against the `order` trait and for `like` against the `textual` trait. Covers FR17 (and reinforces FR9 / AC3).
- [ ] **AC13. orderBy / WHERE accessor split.** Type-level tests demonstrate: (a) inside an `orderBy` callback, `m.intField.asc()` and `m.intField.desc()` typecheck and return `OrderByItem`; (b) inside a `where` callback, `m.intField.asc` is not present on the column accessor (property access fails type-check, not "method returns wrong type"); (c) `fns.asc` is not callable from the sql-builder surface (property does not exist). Covers FR18, FR19, FR21, FR23.

# Other Considerations

## Security

No impact. This is an internal refactor; the user-visible authoring surface stays the same (modulo the symmetry tightening for cipherstash). No new data crosses a trust boundary.

## Cost

No impact. No new infrastructure, no new runtime dependencies.

## Observability

No impact. Registry assembly already happens during execution-context construction; no new metrics are warranted. If type-check time regresses noticeably (NFR2), the implementer should investigate and either resolve or surface a blocker — there is no observability surface for type-check time.

## Data Protection

No impact. No personal data is involved.

## Analytics

No impact.

# References

- [ADR 202 — Codec trait system](../../docs/architecture%20docs/adrs/ADR%20202%20-%20Codec%20trait%20system.md) — defines `CodecTrait` and codec trait declarations.
- [ADR 203 — Trait-targeted operation arguments](../../docs/architecture%20docs/adrs/ADR%20203%20-%20Trait-targeted%20operation%20arguments.md) — introduces `self: { traits }`. This project supersedes its non-goal carve-out for built-ins.
- [ADR 206 — Operations as TypeScript functions](../../docs/architecture%20docs/adrs/ADR%20206%20-%20Operations%20as%20TypeScript%20functions.md) — author shape for operations + `QueryOperationTypes<CT>` factory pattern. This project supersedes its non-goal carve-out for built-ins.
- `packages/3-extensions/sql-orm-client/src/types.ts:325-378` — `COMPARISON_METHODS_META` (to delete).
- `packages/3-extensions/sql-orm-client/src/model-accessor.ts:60-156` — model accessor's two-loop synthesis (to collapse to one).
- `packages/2-sql/4-lanes/sql-builder/src/expression.ts:62-117` — `BuiltinFunctions<CT>` and `Functions<QC>` (to delete / simplify).
- `packages/2-sql/4-lanes/sql-builder/src/runtime/functions.ts:153-211` — `createBuiltinFunctions` and `createFunctions` (to delete / collapse).
- `packages/2-sql/1-core/operations/src/index.ts` — `SqlOperationRegistry`, `SqlOperationDescriptor` (target home for built-in registrations through the family factory).
- `packages/2-sql/9-family/` — `@prisma-next/family-sql` package; default home for the new `queryOperations()` factory.

# Open Questions

_All resolved. Remaining items are implementer degrees of freedom captured inline in the relevant FRs (e.g. specific helper names like `EqualityCodecId<CT>`, internal AST node reuse vs. new factories)._
