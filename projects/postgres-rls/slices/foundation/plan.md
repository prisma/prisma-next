# Slice `foundation` — Dispatch plan

Parent: [`spec.md`](spec.md) · project [`plan.md`](../../plan.md) · Linear [TML-2868](https://linear.app/prisma-company/issue/TML-2868).

Four dispatches. D1→D3 stack (serializer needs the IR classes); D2 and D4 are independent and can land in any order. Implementer tier: **sonnet** (per operator policy); reviewer pass: **opus**. Each dispatch ends on the always-run gates (`pnpm typecheck` + scoped `pnpm lint`) plus the dispatch-specific gates named below.

### Dispatch 1: IR kinds + entity-kind registration + `StorageTable.rls`

- **Outcome:** `PostgresRlsPolicy` and `PostgresRole` classes exist in `packages/3-targets/3-targets/postgres/src/core/`, following the `PostgresEnumType` precedent (same base, `freezeNode(this)`, JSON-canonical readonly fields, `kind` discriminant); registered via `postgresAuthoringEntityTypes` so they populate `PostgresSchema.entries` under a `role` slot and an `rlsPolicy` slot; `StorageTable` carries `rls: 'auto'|'enabled'|'disabled'` (default `'auto'`, absent-when-default). Synthetic fixtures construct frozen instances of each; a freeze/immutability test passes.
- **Builds on:** the spec's chosen design; the `PostgresEnumType` precedent (grep pre-flight on `postgres-schema.ts`, `authoring.ts`, `postgres-enum-*`).
- **Hands to:** the IR class shapes + the `role`/`rlsPolicy` `entries` slots that D3 serializes and slices 2–4 consume.
- **Focus:** IR shapes + registration + the table field only. No hashing (D2), no serializer (D3), no issue union (D4). Gates: package typecheck + `pnpm --filter <postgres-pkg> test` for the new fixtures; `pnpm lint:deps` (no framework/family RLS reference).

### Dispatch 2: canonical normalizer + content-hash

- **Outcome:** `packages/3-targets/3-targets/postgres/src/core/rls/canonicalize.ts` exports `normalizePredicate(sql)` (whitespace-collapse, outer-paren-trim, keyword-lowercase) and `computeContentHash(parts)` (first 8 hex of SHA-256 over `(normalize(using), normalize(withCheck), sortedRoles, operation, permissive)`). Comprehensive unit tests assert hash determinism *across* reformatting-equivalent predicates (nested parens, mixed-case keywords, line/block comments, string literals containing parens/keywords) and distinctness for semantically different bodies.
- **Builds on:** the spec's chosen design + the content-addressed-naming ADR (the canonical tuple).
- **Hands to:** `computeContentHash` / `normalizePredicate` — consumed by slice 2 (lowering) and slice 4 (tamper-check recompute). In this slice, used by D3's round-trip fixtures and these unit tests.
- **Focus:** the pure normalizer + hash module + its edge-case test corpus only. Target-internal; output never leaks past the hash input. Independent of D1. Gates: package test for the new unit-test file.

### Dispatch 3: serializer round-trip

- **Outcome:** `PostgresContractSerializer.serializePostgresNamespace()` + `hydrateSqlNamespaceEntry()` round-trip the new `role`/`rlsPolicy` `entries` slots and `StorageTable.rls`. A round-trip property test (`deserialize(serialize(contract))`) over a mix of permissive/restrictive, using-only/using+withCheck, single/multi-role policies (plus role entities) yields structurally-identical frozen instances, preserving the `prefix` vs full-`name` asymmetry.
- **Builds on:** Dispatch 1's IR classes + `entries` slots.
- **Hands to:** a serializer that preserves the full RLS IR — the round-trip fidelity slices 3–4 rely on.
- **Focus:** serializer hydration/serialization for the new slots only. Gates: package test + `pnpm fixtures:check` (no unintended drift); SQLite/Mongo suites green.

> **Carry-forward note from D1 review (orchestrator).** D1 registered the `role`/`rlsPolicy` entity kinds **without** a `validatorSchema` (the `enum` registration has one). Harmless in D1 (nothing hydrates/validates these kinds yet). **D3 (and slice 2's hydration wiring) must** either add arktype validator schemas for these kinds or consciously accept unvalidated hydration — decide explicitly, don't let it slip.

### Dispatch 4: `SchemaIssue` union widening

- **Outcome:** `rls_policy_renamed | rls_policy_tampered | rls_not_enabled` added to the framework `SchemaIssue` union (`packages/1-framework/1-core/framework-components/src/control/control-result-types.ts`) as payload interfaces in the union, following the additive `EnumValuesChangedIssue` precedent. Exhaustive `kind` consumers compile (minimal default/no-op cases where required).
- **Builds on:** the spec's chosen design (D1 decision: add now).
- **Hands to:** the three issue-kind names + payload shapes that slice 4's verifier emits and the planner consumes.
- **Focus:** the union members + payload interfaces + making exhaustive consumers compile. **Halt condition:** if the grep shows a large exhaustive-switch fan-out (>~5 sites needing real handling, not a trivial default), stop and surface — defer the kind-addition to slice 4 rather than fanning out logic that belongs there (spec edge case #1). Gates: workspace `pnpm typecheck` (the union is consumed broadly); `pnpm lint:deps`.
