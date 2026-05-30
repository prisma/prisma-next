# Slice: construction-discipline-shims (S1.D-1)

_In-project slice. Parent project `projects/contract-ir-planes/`. Outcome: the pre-namespace construction shims are gone, so a built `Namespace` instance is the only thing a `Storage` constructor accepts — one step toward the amended-PDoD5 grep-clean tree._

## At a glance

Delete the POJO-normalisation shim (`normaliseNamespaceEntry`) and the default-singleton injector (`DEFAULT_NAMESPACES`) from both the SQL and Mongo family contract packages, and tighten the `SqlStorage` / `MongoStorage` constructors to require fully-constructed `Namespace` instances. S1.A already made the authoring builders the sole construction point and routed them through built namespaces; these shims are now dead weight.

## Chosen design

The `Storage` constructors stop accepting loosely-typed namespace payloads and stop injecting a default when none are supplied. They accept only built `Namespace` instances. The shims being removed:

- `SqlNamespacePayload` / `MongoNamespacePayload` — the loose POJO input types.
- `normaliseNamespaceEntry` (SQL + Mongo) — POJO → `Namespace` coercion at construction.
- `DEFAULT_NAMESPACES` (SQL + Mongo) — the "inject an `__unbound__` singleton if empty" path.

Construction discipline moves entirely to the builders (where it already lives); the constructor becomes a dumb assignment.

## Coherence rationale

One reviewable unit: every reader of these four symbols is a construction path, and removing them is a single constructor-contract tightening across the two family packages — one reviewer holds "no caller still passes a POJO or relies on the injected default" in one sitting.

## Scope

**In:** the SQL-family and Mongo-family contract packages' `Storage` constructors and the four named shim symbols; the call sites that construct storage.

**Out:** the `Namespace` class shape and entity coordinate (shipped S1.A); `findSqlTable` / `assertUniqueSqlTableNames` / `stripNamespaceKinds` / query-builder `UnboundTables` (deferred — [`deferred.md`](../../deferred.md)); the canonicalizer (S1.D-2); the migration aggregate (S1.D-3).

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
|---|---|---|
| Empty-contract construction (zero declared namespaces) | Refusal trigger | `DEFAULT_NAMESPACES` exists to inject an `__unbound__` singleton here. The premise is that the builders always construct at least `__unbound__`, so the injector is redundant. If a construction path genuinely depends on injection, construction discipline isn't centralised — **HALT and report** rather than re-adding it. |

## Round 2 — review actions (PR #630)

The shim removal extracted construction into `buildSqlNamespace()` / `buildMongoNamespace()` free functions and renamed the old `SqlNamespacePayload` / `MongoNamespacePayload` classes to `SqlNamespaceFromTablesInput` / `MongoNamespaceFromCollectionsInput`. Review surfaced that the rename carried forward the original anti-pattern (class identity named after its constructor input) and a few smaller smells in the surrounding construction paths. All five actions stay within this slice's surfaces.

| # | Site | Action |
|---|---|---|
| R1 | `build-{sql,mongo}-namespace.ts` concrete class | Name the bound concretion by **identity**, not by its constructor input. Move the input shape into a static factory method (e.g. `class SqlBoundNamespace … static fromTablesInput(input)`), sibling to the existing `SqlUnboundNamespace` / `MongoUnboundNamespace`. Fold the `buildXNamespace()` free function into the factory. |
| R2 | `buildMongoNamespaceMap` (and SQL twin) | Drop the `instanceof NamespaceBase` discrimination in favour of the family's `kind`-based discriminator, or restructure so the map builder is handed a single already-built shape. |
| R3 | `sql-storage.ts` `SqlStorage` constructor | Justify-or-remove the `as Readonly<…> & { __unbound__: SqlNamespace }` cast. If `SqlStorageInput['namespaces']` already brands `__unbound__`, the cast is redundant; otherwise narrow it. |
| R4 | `validators.ts` `validateStorage` (+ `sql-contract-serializer-base.ts` `hydrateSqlStorage`) | Replace the inline `...(x !== undefined ? { types: x } : {})` conditional spread with the `ifDefined(...)` helper. |
| R5 | `sql-contract-serializer-base.ts` `hydrateSqlNamespaceMap` | Clarify the raw-vs-hydrated distinction (naming or a one-line comment): "raw" = post-structural-validation entries not yet materialised into family IR class instances; "hydrated" = materialised `Namespace` instances. |

**Refusal trigger (R1):** the public *structural types* `SqlNamespace` / `MongoNamespace` exist so emitted `contract.d.ts` literals (no runtime `kind`, not class instances) structurally satisfy the namespace slot. If naming the concrete class by identity would force the structural type to disappear and break `.d.ts` literal assignability, **HALT and report** with options rather than collapsing the type into the class.

## Slice-specific done conditions

- [ ] Grep gate clean: the four named symbols return zero hits outside this project's docs.
- [ ] If the deletion shifts any emitted `contract.json`, the regen is committed with a one-line explanation in the PR (expected: none, since builders already inject).
- [ ] Review actions R1–R5 addressed (or a refusal trigger reported); no `*FromTablesInput` / `*FromCollectionsInput` class names remain.

## Open Questions

None. Working position: the builders are the sole construction point (S1.A) and already hand over built namespaces; the implementer's grep confirms or trips the refusal trigger.

## References

- Parent project: [`projects/contract-ir-planes/spec.md`](../../spec.md) — amended PDoD5
- Linear: [TML-2727](https://linear.app/prisma-company/issue/TML-2727)
