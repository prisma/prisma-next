# Dispatch D4 — `SchemaIssue` union widening

Slice `foundation` (TML-2868), dispatch 4 of 4 (last). Implementer tier: sonnet. Independent of D2/D3. The blast radius has been pre-checked (see § Blast radius) — proceed in-slice.

## Task

Add three target-side RLS issue kinds — `rls_policy_renamed`, `rls_policy_tampered`, `rls_not_enabled` — to the **framework** `SchemaIssue` union in `packages/1-framework/1-core/framework-components/src/control/control-result-types.ts`, following the additive `EnumValuesChangedIssue` precedent (a payload interface added to the union, with a `kind` discriminant + payload fields). Then make the codebase compile again by handling the kinds **only where an exhaustive switch forces it** — minimal, defensible cases. Slice 1 only introduces the union members + payload interfaces; **nothing emits or consumes these issues** until slice 4 (verifier) and slice 3 (planner response).

## Surface map (confirmed by recon)

- **Union (add here):** `packages/1-framework/1-core/framework-components/src/control/control-result-types.ts` — `SchemaIssue = BaseSchemaIssue | EnumValuesChangedIssue` (~line 104). `EnumValuesChangedIssue` (~lines 85-96) is the precedent: a standalone interface with `readonly kind: 'enum_values_changed'` + payload + `message`. Add three sibling interfaces and extend the union.
- **The ONE forced compile-error site:** `packages/2-sql/9-family/src/core/schema-verify/verifier-disposition.ts` — `classifySqlVerifierIssueKind(kind: SchemaIssue['kind']): VerifierIssueCategory` (~lines 15-51) is an **exhaustive switch with no `default:`**; widening the union makes it fail `ts(2366)`. Add a case for each of the three kinds returning a defensible `VerifierIssueCategory`. The other consumers do NOT compile-error (see § Leave alone).

## Payload interface shapes

Mirror `EnumValuesChangedIssue` (a flat interface, no extends). Carry the fields the slice-4 verifier will need to act + a human `message`. Keep them target-agnostic in *type* (plain strings — no Postgres imports into the framework). Suggested shapes (adjust field names to read naturally; do not over-design — these are the wire payloads slice 4 emits):

- `RlsPolicyRenamedIssue`: `kind: 'rls_policy_renamed'`; `namespaceId: string`; `tableName: string`; `fromName: string` (introspected full wire name); `toName: string` (declared full wire name); `message: string`. (Matching content-hash suffix, different prefix → a rename.)
- `RlsPolicyTamperedIssue`: `kind: 'rls_policy_tampered'`; `namespaceId: string`; `tableName: string`; `policyName: string` (the full wire name whose recomputed hash ≠ its suffix); `message: string`.
- `RlsNotEnabledIssue`: `kind: 'rls_not_enabled'`; `namespaceId: string`; `tableName: string`; `message: string`.

## `classifySqlVerifierIssueKind` classification (minimal, provisional — note for slice 4)

Add the three cases with the most defensible category and a one-line comment that slice 4 confirms. Based on the existing category semantics (read the `VerifierIssueCategory` definition + how `enum_values_changed`/other kinds map):
- `rls_policy_tampered` → the "value/body drifted but the object exists" category (whatever `enum_values_changed` and `*_mismatch` use — likely `valueDrift`).
- `rls_policy_renamed` → the "declared object is structurally different / incompatible" category (likely `declaredIncompatible`).
- `rls_not_enabled` → same incompatible/declared-missing-state category (likely `declaredIncompatible`).
Pick from the ACTUAL enum members in the file; the names above are from recon — confirm by reading the type. If none fits cleanly, surface rather than inventing a category.

## Leave alone (do NOT touch — slice 3/4 work)

- The SQLite + Postgres `mapIssueToCall` switches (`.../sqlite|postgres/src/core/migrations/issue-planner.ts`): they have explicit `default:` clauses, so they **compile fine**. How the planner responds to an RLS issue is slice 3/4. Do not add cases.
- `ISSUE_KIND_ORDER` tables (both planners): `Record<string, number>` with `?? 99` fallback — safe, leave them.
- `classifyMongoVerifierIssueKind`: has a `default:` — leave it.
- CLI error formatter: defensive `?? 'issue'` — leave it.

## Completed when

- [ ] Three payload interfaces exist + `SchemaIssue` union widened, mirroring `EnumValuesChangedIssue`. No Postgres import in the framework package.
- [ ] `classifySqlVerifierIssueKind` handles the three kinds (the only forced site); a one-line comment marks the classifications provisional for slice 4.
- [ ] A type-level test asserts the three kinds are members of `SchemaIssue` (e.g. `vitest-expect-typeof` per the repo's type-test convention — grep for an existing `*.test-d.ts` / `expectTypeOf` pattern near the union or in framework-components tests). No behavioral test — nothing emits these yet.
- [ ] **Workspace** `pnpm typecheck` clean (the union is consumed broadly — this is the gate that proves no other exhaustive site broke). `pnpm lint:deps` clean.

## HALT CONDITION (the slice's central risk — surface, do not improvise)

Workspace typecheck after widening the union reveals **more than ~5 sites** needing real (non-trivial, non-`default`) handling — i.e. the blast radius is larger than the recon predicted. **Stop and surface to the orchestrator** with the list of sites; the decision is to defer the kind-addition to slice 4, not to fan out RLS-response logic across the codebase in slice 1. (Recon predicted exactly 1 forced site; a couple more minimal classifications are fine. The threshold is for *real* handling, not one-line classifications.)

## Standing instruction

Stay focused on the goal; control scope. The goal is the type-floor (union members + make it compile), not RLS verifier/planner behavior. Anything that pulls you toward emitting or acting on these issues is out of scope — halt.

## Commit hygiene

Explicit staging; `tml-2868:` prefix. No amend, no push.

## References

- Slice spec: `projects/postgres-rls/slices/foundation/spec.md` (§ Chosen design → `SchemaIssue` widening; § Pre-investigated edge cases row 1 — the blast-radius halt).
- Verifier ADR context (for the issue semantics slice 4 will use): `projects/postgres-rls/specs/adr-content-addressed-policy-names.md` (§ Verifier semantics — defines what each kind means).
- Heartbeat: `wip/heartbeats/implementer.txt`.

## Operational metadata

- **Model tier:** sonnet — additive type union + one forced switch + a type test; bounded.
- **Time-box:** ~40 min wall-clock. Overrun → halt and surface.
