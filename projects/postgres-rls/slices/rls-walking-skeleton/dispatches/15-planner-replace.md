# Dispatch D15 — planner same-prefix replace + F06 gating (slice `select-policies-dependable`)

Slice 1, TML-2868. Implementer tier: sonnet. Wires D14's `DropPostgresRlsPolicyCall` into the planner so **editing a policy replaces it** (the edit-trap fix), via the operator-chosen **safe same-prefix rule** (option A). Planner + gating + unit test only — the lifecycle **e2e is D16**. Commit your own work.

## Design (option A — safe same-prefix replace)

When the planner creates a policy `<prefix>_<newhash>` on table T, it must drop any existing DB policy on **the same `(namespaceId, tableName)`** that shares the **same `prefix`** but a **different wire name** and is **not in the contract** (i.e. a superseded version). It must NEVER touch a policy with a different prefix (that's an external policy — leaving it alone is correct; general "extra → drop" + `managed`/`external` grading is slice 2).

`PostgresRlsPolicy` carries `prefix` (`postgres-rls-policy.ts:11`). **Verify introspection populates `prefix` correctly** for actual policies (parsed from the wire name in `control-adapter.ts`); if it doesn't reliably, match on the expected policy's `prefix` against the actual policy's wire name with the format `^<prefix>_[0-9a-f]{8}$` rather than trusting a parsed `actual.prefix`. Pick the robust matcher and note which.

## Task

1. **`buildRlsDiffCalls`** (`packages/3-targets/3-targets/postgres/src/core/migrations/planner.ts` ~92-125): in addition to the existing `missing → create (+ enable)`, for each missing policy being created, find actual policies (`readPostgresSchemaIrAnnotations(schema).rlsPolicies`) on the same `(namespaceId, tableName)` that share its `prefix`, have a different wire name, and are not in the expected set → emit a `DropPostgresRlsPolicyCall(schema, table, actualName)`. Dedup so the same superseded policy isn't dropped twice. Do NOT drop policies of a different prefix; do NOT drop on pure removal (no create) — that's slice 2.
2. **F06 gating** (`issue-planner.ts` `planIssues` ~965-996): route `options.extraBucketableCalls` through the same `keepIfAllowed` operation-class filter as the other buckets (currently it's merged in *after* gating). Create/enable are `'additive'`, the new drop is `'destructive'`; the default `db update` policy allows all three, so default behavior is unchanged — but a narrowed (non-destructive) policy now correctly suppresses the replace-drop (the old+new coexist and verify-drift catches it — acceptable degradation).

## Tests (unit, in `postgres/test/migrations/rls-planner.test.ts`)

- Edit case: expected `[p_read_NEW]`, actual `[p_read_OLD]` (same prefix `p_read`, same table) → plan contains a `CreatePostgresRlsPolicyCall` for `p_read_NEW` **and** a `DropPostgresRlsPolicyCall` for `p_read_OLD`.
- Different-prefix safety: actual `[other_xxxx]` (different prefix, same table) is **NOT** dropped when creating `p_read_NEW`.
- Two same-prefix policies both in contract (different hashes) → neither dropped (both expected).
- F06: under a policy excluding `'destructive'`, the create/enable still emit but the replace-drop is filtered out.

## Scope

**In:** the planner replace logic + F06 gating + the planner unit tests. **Out:** any PGlite e2e (D16); removal auto-drop / `managed`-`external` grading (slice 2); DISABLE RLS on last policy (slice 2).

## Gates (run once, foreground)

`pnpm build` → workspace `pnpm typecheck` (green) → `rls-planner.test.ts` + existing planner/RLS unit tests → `pnpm lint:deps`.

## Halt conditions (surface)

- Introspected actual policies don't carry a usable prefix AND the wire-name-format match is ambiguous for the test fixtures — surface what you found.
- Routing `extraBucketableCalls` through gating breaks an existing planner invariant/test for non-RLS calls — surface (don't force it).

## Constraints

Explicit-staging, `tml-2868:` prefix, no amend, **no push**. No `any`/bare casts. Transient-ID scan. Heartbeats. Low budget → commit what compiles + report.
