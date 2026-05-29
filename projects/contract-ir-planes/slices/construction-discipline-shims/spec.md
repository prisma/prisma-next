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

## Slice-specific done conditions

- [ ] Grep gate clean: the four named symbols return zero hits outside this project's docs.
- [ ] If the deletion shifts any emitted `contract.json`, the regen is committed with a one-line explanation in the PR (expected: none, since builders already inject).

## Open Questions

None. Working position: the builders are the sole construction point (S1.A) and already hand over built namespaces; the implementer's grep confirms or trips the refusal trigger.

## References

- Parent project: [`projects/contract-ir-planes/spec.md`](../../spec.md) — amended PDoD5
- Linear: [TML-2727](https://linear.app/prisma-company/issue/TML-2727)
