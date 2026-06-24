# Slice: foundation

Parent project: `projects/postgres-rls/` ([spec](../../spec.md) · [plan](../../plan.md)). Contributes the IR + naming substrate every later slice consumes.

## At a glance

Introduce `PostgresRlsPolicy` and `PostgresRole` as Postgres-target-only IR kinds (new `PostgresSchema.entries` slots + `entityTypes`-registered kinds), add `StorageTable.rls`, ship the content-addressed wire-name machinery (canonical predicate normalizer + 8-hex content-hash), round-trip everything through `PostgresContractSerializer`, and widen the framework `SchemaIssue` union with the three RLS issue kinds. Reachable only through synthetic test fixtures — no authoring helper, no planner, no verifier. Unblocks slices 2 (authoring binds to the `role` entity kind), 3 (ops construct from this IR), 4 (verifier diffs by these wire names).

## Chosen design

Real anchor points are catalogued in [`../../specs/reconciliation-2026-06-08.md`](../../specs/reconciliation-2026-06-08.md); the content-hash design in [`../../specs/adr-content-addressed-policy-names.md`](../../specs/adr-content-addressed-policy-names.md). The implementer confirms exact signatures by grep on the named surfaces.

**IR kinds (follow the `PostgresEnumType` precedent).** Both classes live in the Postgres target (`packages/3-targets/3-targets/postgres/src/core/`), use the same base + `freezeNode(this)` + JSON-canonical readonly fields + `kind` discriminant that `PostgresEnumType` uses, and register through `postgresAuthoringEntityTypes` (`.../core/authoring.ts`) so they land in `PostgresSchema.entries` under their kind keys.

- `PostgresRlsPolicy`: `kind`; `name` (full wire name `<prefix>_<8hex>`); `prefix` (user-typed); `tableName` (the table it attaches to, by name); `operation` (`'select'|'insert'|'update'|'delete'|'all'`); `roles` (`readonly string[]` — role names as they render in `TO <roles>`; the resolution of these to `PostgresRole` refs is slice 2's job, so slice 1 keeps them as plain sorted names); `using?`; `withCheck?`; `permissive` (boolean; `as permissive` = true).
- `PostgresRole`: `kind`; `name`; namespace coordinate (typically `UNBOUND_NAMESPACE_ID = '__unbound__'` — roles are cluster-scoped). Minimal — no attributes (`LOGIN` etc.) per the project non-goals.
- `PostgresSchema.entries` gains a `role` slot and an `rlsPolicy` slot (alongside `table`, `type`); `StorageTable` (`packages/2-sql/1-core/contract/src/ir/storage-table.ts`) gains `rls: 'auto' | 'enabled' | 'disabled'` (default `'auto'`, absent-when-default so it never serializes at the default — same own-optional-property discipline as the existing `control?` field).

**Content-addressed naming** — new module `packages/3-targets/3-targets/postgres/src/core/rls/canonicalize.ts` (Q2 working position; written so it lifts cleanly into a shared module when OC4's next consumer arrives):

- `normalizePredicate(sql: string): string` — collapse whitespace, trim outer parens, lowercase keywords. Target-internal; its exact output never leaks past the hash input.
- `computeContentHash(parts): string` — first 8 hex chars of `SHA-256` over the canonical tuple `(normalizePredicate(using), normalizePredicate(withCheck), sortedRoles, operation, permissive)`. Schema + table excluded (orthogonal). Deterministic across the normalizer's equivalence classes.

**Serializer round-trip** — extend `PostgresContractSerializer.serializePostgresNamespace()` + `hydrateSqlNamespaceEntry()` (`.../core/postgres-contract-serializer.ts`) so the new `entries` slots round-trip, preserving the `prefix` / full-`name` asymmetry and the `StorageTable.rls` value.

**`SchemaIssue` widening (D1)** — add `rls_policy_renamed | rls_policy_tampered | rls_not_enabled` to the framework `SchemaIssue` union (`packages/1-framework/1-core/framework-components/src/control/control-result-types.ts`), following the additive `EnumValuesChangedIssue` interface-in-the-union precedent. Slice 1 only introduces the union members + their payload interfaces; nothing emits or consumes them until slice 4.

## Coherence rationale

One outcome: "the RLS IR substrate exists and round-trips." Every piece (classes, entity-kind registration, naming, serializer, union members) is the type-and-serialization floor that has no behaviour of its own — a reviewer holds it in one sitting because there is no authoring/planner/verifier logic to reason about, only shapes and their round-trip.

## Scope

**In:** `PostgresRlsPolicy` / `PostgresRole` classes + `entityTypes` registration; `PostgresSchema.entries` `role`/`rlsPolicy` slots; `StorageTable.rls`; `canonicalize.ts` (normalizer + hash); serializer round-trip; `SchemaIssue` union members + payload interfaces; synthetic-fixture construction/round-trip/hash-determinism tests.

**Out:** the authoring surface (TS helpers, PSL `policy_*` blocks, role refs) — slice 2; any planner op or DDL — slice 3; any verifier introspection or issue *emission* — slice 4; cross-space role resolution — slice 2. No `examples/` wiring.

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
| --------- | ----------- | ----- |
| `SchemaIssue` union widening forces cases in exhaustive `kind` switches across the codebase | Handle in-slice | Adding 3 kinds may red exhaustive switches (planner strategies, renderers). Add minimal default/no-op cases. **If blast radius is large (>~5 sites), that is the signal to defer kind-addition to slice 4** and keep slice 1 to IR+naming+serializer — surface it rather than fanning out silently. |
| Normalizer equivalence-class coverage (nested parens, mixed-case keywords, line/block comments, string literals containing parens/keywords) | Test-driven in-slice | This is the riskiest single piece (per project Cost notes). Comprehensive unit tests asserting hash determinism across reformatting-equivalent predicates. |

## Slice-specific done conditions

- [ ] Synthetic fixtures construct `PostgresRlsPolicy` + `PostgresRole` instances and round-trip them through `contract.json` (`serialize` → `deserialize`) to structurally-identical frozen instances, preserving `prefix` vs full `name`.
- [ ] Hash determinism: predicates that differ only by normalizer-equivalent reformatting produce the same 8-hex suffix; semantically different predicates produce different suffixes (unit tests).
- [ ] `pnpm lint:deps` clean — the framework and SQL-family layers carry **no** reference to `PostgresRlsPolicy` / `PostgresRole` (the `SchemaIssue` union members are framework-level *type* additions only, no Postgres import).
- [ ] `pnpm fixtures:check` clean (IR/serializer change) — no unintended drift in existing fixtures.
- [ ] SQLite + Mongo suites green — no non-Postgres regression.

## Open Questions

1. **`SchemaIssue` widening blast radius.** Working position: add the three kinds in this slice (foundation owns the type shape) with minimal default cases in exhaustive consumers; if the implementer's grep shows a large exhaustive-switch fan-out, defer the kind-addition to slice 4 and note it here. Decide from the grep.
2. **`roles` IR representation.** Working position: `readonly string[]` of sorted role names in slice 1 (sufficient for the content-hash tuple and `TO <roles>` rendering); slice 2 decides whether the authored form resolves to richer role-ref coordinates before lowering. Keep slice 1 minimal.

## References

- Parent project: [`projects/postgres-rls/spec.md`](../../spec.md)
- Linear issue: [TML-2868](https://linear.app/prisma-company/issue/TML-2868)
- Reconciliation (landed-code anchors): [`../../specs/reconciliation-2026-06-08.md`](../../specs/reconciliation-2026-06-08.md)
- Content-addressed naming: [`../../specs/adr-content-addressed-policy-names.md`](../../specs/adr-content-addressed-policy-names.md); ADR 192 (JSON-canonical IR), ADR 195 (planner — context for later slices).
