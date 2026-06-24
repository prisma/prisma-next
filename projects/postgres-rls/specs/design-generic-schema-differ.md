# Design — generic schema differ (the RLS verification architecture)

Status: **Accepted** (design discussion, 2026-06-09). This record captures *why* RLS verification/planning is built on a generic differ rather than the legacy per-kind verifier, and the research that backs the decisions. The prescriptive build steps live in [`../slices/rls-walking-skeleton/spec.md`](../slices/rls-walking-skeleton/spec.md); the slice/sequencing in [`../plan.md`](../plan.md).

## 1. What went wrong first (the leak)

The first foundation slice (PR #771) added RLS to **shared layers**:
- `packages/1-framework/1-core/framework-components/src/control/control-result-types.ts` — widened the framework `SchemaIssue` union with `rls_policy_renamed | rls_policy_tampered | rls_not_enabled`.
- `packages/2-sql/1-core/contract/src/ir/storage-table.ts` — added a Postgres-specific `rls` field to the family-shared `StorageTable`.
- `packages/2-sql/1-core/contract/src/validators.ts` — defined the Postgres entity validators in SQL core.

This violates the project's headline invariant ("RLS-aware code lives only in the Postgres target"). It passed review because **`lint:deps` checks import *direction*, not domain *ownership*** — adding string-literal kinds to a framework union, or a field typed in SQL core, creates no cross-layer import. The "precedent" used to justify it (`StorageTable.control`, `EnumValuesChangedIssue`) was invalid: control-policy and enums are cross-target framework concepts; RLS is Postgres-only.

Root cause investigation found there was **no clean channel** for a target to emit its own verifier issue kind: `verifyTargetExtensions()` (the SchemaVerifier SPI hook) returns the *closed* framework `SchemaIssue[]`, and the SPI doc comment documents "widen target-side" as deliberate interim debt. `EnumValuesChangedIssue` is prior art for the *same* leak, not a sanctioned precedent. So the only way to add a target issue kind was to break layering — which means it was an architecture decision to escalate, not a default to take.

## 2. The architecture: a generic `SchemaIR` ↔ `SchemaIR` differ

Instead of widening framework types, make the differ generic so the framework never names a kind.

**Two trees of the same shape.** The contract is **lowered** to a `SchemaIR` (the *expected* schema); the live database is **introspected** to a `SchemaIR` (the *actual* schema). Both sides are the same hierarchy, so comparison is homogeneous — `isEqualTo(other: OwnType)` is well-typed. (This corrects the initial assumption that we diff the contract IR directly against the introspected schema IR; those are two non-isomorphic hierarchies. We derive to one shape and diff that.)

**Three outcomes + a coordinate.** A schema issue is `{ coordinate, outcome: 'missing' | 'extra' | 'mismatch', expected?, actual? }`:
- in expected, not in actual → **missing**
- in actual, not in expected → **extra**
- in both, nodes differ → **mismatch**

There is no `kind` vocabulary and no per-kind payload. The framework enumerates nothing about RLS (or any target). This is what removes the layering leak *structurally* rather than by relocation.

**Generic diff over JSON-canonical IR.** Because IR nodes are JSON-canonical (ADR 192), structural comparison is meaningful. The differ walks the two trees, aligns children within a parent by **identity**, and compares matched pairs by **equality** — both delegated to the node.

## 3. Identity vs. equality — two jobs, two virtual methods

The differ needs two things from a node, and they are distinct:

1. **Identity** — *which* expected node pairs with *which* actual node (alignment). The node's local key.
2. **Equality** — given a matched pair, do they *differ*? (mismatch detection)

```ts
abstract class <SchemaIRNodeBase> {
  abstract identity(): <localKey>;          // for alignment within a parent
  abstract isEqualTo(other: OwnType): boolean;  // for comparing a matched pair
}
```

Identity is **heterogeneous per kind** — that's exactly what a virtual method is for: a column's key is its name; a check's is its name; a foreign key / unique / index key is its **column-list** (names are explicitly non-identity in the existing verifier); a primary key is a singleton; an **RLS policy's key is its content-addressed wire name**. The node's coordinate is the path of local keys from the root.

For content-addressed nodes (RLS policies) identity and equality **collapse**: the wire-name hash already encodes the body (`using`/`withCheck`/roles/operation/permissive), so same name ⇒ equal. That is the clean case. For other kinds, identity aligns, then `isEqualTo` compares the rest.

`isEqualTo(other: OwnType)`: the coordinate includes the node kind, so a matched pair is guaranteed the same concrete type; the implementation may treat `other` as its own type with a narrowing assertion. The framework differ only ever calls the base methods.

## 4. Derivation holds the per-kind smarts; the diff stays pure

Three things that look like they break a generic differ are all resolved by putting them in the **derivation/introspection** steps (where target/codec context is already in scope), so the diff itself is a pure recursive walk:

- **Two non-isomorphic hierarchies** → derive the contract to the *same* `SchemaIR` the introspector produces. (Resolves the "bridge two shapes" problem.)
- **Identity needs external context** (contract `StorageTable`/`StorageColumn` carry no `name` — it's the parent map key) → the `SchemaIR` node carries its own `name` (the introspected side already does); derivation assigns it. So `identity()` is computable from the node.
- **Equality is non-structural** in real cases (`int4` ≡ `integer`, `varchar` length, `nextval()` ≡ `autoincrement()`, default normalization) → **normalize on the way in**: derivation and introspection both emit a *canonical* `SchemaIR`, so `isEqualTo` at diff time is plain structural comparison.
- **Cross-sibling alignment** — a unique *constraint* satisfied by a unique *index*; FK-backing indexes synthesized from sibling FKs → **canonicalize/synthesize in derivation** (the expected tree is built including the implied/normalized nodes), so the diff stays pairwise.

These last three matter only for the **relational** kinds and are therefore the concern of the deferred relational-port project (§7), not RLS — RLS has none of them.

## 5. Per-node planner dispatch

The planner is issue-driven: it consumes the differ's issues and produces ordered `OpFactoryCall`s (ADR 195 — a serializable IR node carrying `renderTypeScript()` for `migration.ts` and `toOp()` for `ops.json`).

**Generic part (framework/family):** map each issue by `(node kind, outcome)`, coalesce (rename), order, emit. This dissolves the central `mapIssueToCall` switch over ~25 kinds.

**Per-kind part (contributed):** the actual op generation — `create(node) / delete(node) / update(from, to) → OpFactoryCall[]`. For **target-only** nodes (policy/role) these are methods on the node; for **family-shared** nodes (table/column) they must be **target-contributed strategies**, because the DDL diverges between SQLite (whole-table recreate; can't alter a column in place) and Postgres (in-place alters). `update` returns `OpFactoryCall[]` (possibly several, or a drop+create fallback when the target can't alter in place); a target may opt to coalesce N node-diffs into one parent op (SQLite).

**Cross-issue passes** sit above per-node mapping: **rename** = an extra+missing pair sharing a content-hash suffix → `ALTER POLICY … RENAME TO`. No coalescing exists in the planner today, so this is net-new (target-owned).

## 6. Ordering — coarse buckets now, dependency graph later

The current planner has **no dependency-aware ordering** — just two hardcoded `ISSUE_KIND_ORDER` priority lists tuned to byte-match a legacy planner, plus a `recipe` boolean that already `throw`s when a plan needs two buckets at once. RLS's ordering (roles → tables → policies + `ENABLE ROW LEVEL SECURITY`) fits the **existing coarse-bucket mechanism** by adding buckets. The general solution (declared dependency edges + topological sort + a coalescing contract) is deferred to a separate project (§7); RLS does not need it.

## 7. Scope — what ships vs. what's deferred

The differ ships scoped to the **top-level-entity layer** (`PostgresSchema.entries[kind][name]`), which is the layer RLS lives in (policies and roles are top-level entities, already coordinate-addressable via `EntityCoordinate`). `SchemaIR` is relational-only today, so RLS adds **new** `SchemaIR` policy/role nodes + their introspection — all greenfield, no existing code to reconcile.

Two efforts are **independent follow-on projects** (Linear projects already filed) that **must not gate RLS**:
- **A — relational port:** migrate the 25 legacy relational kinds onto the differ (nested coordinates, normalization-in-derivation, cross-sibling synthesis; retire the `SchemaIssue` union + `classifySqlVerifierIssueKind` + the per-target `mapIssueToCall` switches). Validate by run-both-assert-identical per kind.
- **B — dependency-aware planner ordering:** replace the hardcoded kind-order lists + `recipe` boolean with dependency edges + topological sort + a coalescing contract.

Until A lands, the **legacy per-kind verifier/planner runs side-by-side, untouched**; the new path emits only `{coordinate, outcome}` issues into its own channel and its own `OpFactoryCall`s into the same plan — it never produces a framework `SchemaIssue` and never goes through `mapIssueToCall`.

## 8. Research backing (ground truth, 2026-06-09)

Three read-only investigations established the facts above. Key file anchors:
- **Issue model / leak:** `framework-components/src/control/{control-result-types.ts, schema-verifier.ts, verifier-disposition.ts}`; `2-sql/9-family/src/core/schema-verify/verifier-disposition.ts`; `1-framework/0-foundation/contract/src/control-policy.ts`. `verifyTargetExtensions()` returns the closed `SchemaIssue[]`; no open channel exists.
- **Node identity:** two hierarchies — Contract IR (`2-sql/1-core/contract/src/ir/*`, `3-targets/3-targets/postgres/src/core/*`) and Schema IR (`2-sql/1-core/schema-ir/src/ir/*`). `EntityCoordinate` (`framework-components/src/ir/storage.ts`) addresses only top-level entities. The de-facto verifier already matches-by-identity then compares-by-equality, hand-unrolled per kind in `2-sql/9-family/src/core/schema-verify/{verify-sql-schema.ts, verify-helpers.ts}`. Non-structural equality sites: native-type normalizer + default normalizer (`3-targets/3-targets/postgres/src/core/{native-type-normalizer,default-normalizer}.ts`), enum value-sets, referential-action normalization, index-options loose equality. `SchemaIR` has no enum/role/policy nodes (RLS is greenfield there).
- **Planner:** `mapIssueToCall` (`3-targets/3-targets/postgres|sqlite/src/core/migrations/issue-planner.ts`) switches on `issue.kind` → `Result<OpFactoryCall[], conflict>`; `OpFactoryCall` interface at `framework-components/src/control/control-migration-types.ts`; concrete `*Call` classes at `.../migrations/op-factory-call.ts`; factories at `.../migrations/operations/*.ts`. Ordering = `ISSUE_KIND_ORDER` + `classifyCall` buckets, no dependency graph. SQLite and Postgres planners are fully duplicated; no shared family planning for shared kinds.

## 9. Consequences

- **Positive:** the framework/SQL-family never reference RLS (layering holds structurally); new node kinds get verified by implementing `identity()`/`isEqualTo()` and planned by implementing `create/delete/update`; RLS rides it as the clean greenfield consumer; the architecture generalizes to future extension-contributed node kinds.
- **Negative / cost:** a second verifier/planner path runs alongside the legacy one until the relational port (A) retires it; the generic differ is introduced scoped (top-level only), so it is not yet the whole story; dependency-aware ordering (B) is owed before the planner is general.

## References

- Slice spec (prescriptive build): [`../slices/rls-walking-skeleton/spec.md`](../slices/rls-walking-skeleton/spec.md)
- Plan + architecture-decisions summary: [`../plan.md`](../plan.md)
- Content-addressed naming: [`adr-content-addressed-policy-names.md`](adr-content-addressed-policy-names.md)
- Authoring surface: [`design-rls-authoring-surface.md`](design-rls-authoring-surface.md)
- Landed-seam → file-path map: [`reconciliation-2026-06-08.md`](reconciliation-2026-06-08.md)
- ADR 192 (JSON-canonical IR), ADR 195 (planner IR / two renderers), ADR 224 (control policy).
