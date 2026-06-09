# Project Plan

## Summary

The project ships in five PRs sequenced foundation → authoring surfaces → migration ops → verifier → documentation. M1 establishes the target-only IR kinds (`PostgresRlsPolicy`, `PostgresRole`), the content-addressed naming machinery (canonical normalizer + hash function), and the `SchemaIssue` widening for the three new issue kinds. M2 ships the TS authoring surface (`.rls(...)` stage with pack-aware typing, `ref()` helper, `RoleRef` brand, model-level `rls` field). M3 ships the PSL authoring surface (grammar + AST + lowering + formatter + reopenable-namespace integration), plus the two-body-form ADR that the policy grammar instantiates. M4 wires migration ops (`CreatePostgresRlsPolicyOp` etc.) and the verifier (introspection queries, hash recompute, rename detection, control-policy dispatch). M5 closes out documentation — the content-addressed naming ADR is promoted, the subsystem doc for Postgres-specific IR is updated, and the umbrella decisions log is marked as shipped.

**Spec:** [`projects/postgres-rls/spec.md`](spec.md)
**Linear:** _(to be created — see project tracker in umbrella `projects/supabase-integration/README.md`)_

## Cross-project dependencies

This project depends on [TML-2459 — Target-Extensible IR](../target-extensible-ir/spec.md) for the target-only IR kind shape, the SPI seams, and the `Namespace` + `__unspecified__` pattern.

This project depends on [control-policy](../control-policy/spec.md) for verifier severity dispatch on `missing_rls_policy`, `extra_rls_policy`, `missing_role`.

This project can run in parallel with [cross-contract-refs](../cross-contract-refs/spec.md) and [runtime-target-layer](../runtime-target-layer/spec.md). The TS `ref()` helper consumes cross-contract model handles transparently — no integration work between the two projects beyond the brand contract already established by cross-contract-refs.

[extension-supabase](../extension-supabase/spec.md) consumes this project's deliverables (RLS authoring + roles introspection) to declare Supabase's standard roles + canonical example contract.

Resulting global sequence: **TML-2459 + control-policy** → **this project ∥ cross-contract-refs ∥ runtime-target-layer** → **extension-supabase**.

## Slices

The five PRs below correspond to the five slices (M1–M5). Each slice is one PR.

### M1 — Foundation (IR kinds + content-addressed naming)

**Goal:** declare the target-only IR shape and the content-addressed naming machinery. No authoring surface yet; the new shape is reachable only through synthetic test fixtures.

**Tasks:**

- [ ] Declare `PostgresRlsPolicy` as a target-only IR class extending `SchemaNodeBase`. Fields per FR1 / spec § "Target-only IR". Frozen-in-constructor; JSON-canonical fields; kind discriminant.
- [ ] Declare `PostgresRole` as a target-only IR class extending `SchemaNodeBase`. Field set per FR2 (minimal — name + namespace coordinate).
- [ ] Extend `PostgresTable` with the `rls: 'auto' | 'enabled' | 'disabled'` field (default `'auto'`) and `rlsPolicies: readonly PostgresRlsPolicy[]` (default empty).
- [ ] Widen the Postgres-target `SchemaIssue` union with three new kinds: `rls_policy_renamed`, `rls_policy_tampered`, `rls_not_enabled`.
- [ ] Implement the canonical normalizer (`canonical(predicate)`): whitespace collapse, outer-paren trim, keyword lowercase. The normalizer is target-internal; its exact output never leaks beyond the hash input. Comprehensive unit tests covering edge cases (nested parens, mixed-case keywords, line comments, block comments, string literals inside predicates).
- [ ] Implement the content-hash function: `SHA-256((canonical(using), canonical(withCheck), sort(roles), operation, as))[:8 hex]`. Unit tests asserting hash determinism across canonicalizer equivalence classes.
- [ ] Extend Postgres `ContractSerializer` to round-trip the new fields. Round-trip property tests covering `permissive` / `restrictive`, `using`-only / `using + withCheck`, single / multi-role, present / absent prefix-suffix asymmetry.
- [ ] Recommend the v0.1 normalizer home as `packages/3-targets/3-targets/postgres/src/core/rls/canonicalize.ts` (per the spec's open question); leave the cross-kind refactor to whichever project next reaches for content-addressed naming.
- [ ] `pnpm lint:deps` passes; framework + SQL family layers contain no references to the new classes.

**Validation:** synthetic test fixtures construct `PostgresRlsPolicy` / `PostgresRole` instances and round-trip them through `contract.json`. Hash determinism + canonicalizer equivalence-class coverage verified by tests. No authoring path yet.

### M2 — TypeScript authoring surface

**Goal:** make the IR reachable through TS authoring. After this slice, an app contract can declare RLS policies and produce valid `PostgresRlsPolicy` IR.

**Tasks:**

- [ ] Add `.rls(...)` as the fourth named stage on `ContractModelBuilder`. Pack-aware-typed: visible only when the contract targets Postgres (consume the existing pack-aware-typing mechanism — same one `PackAwareSqlConstraints<IndexTypes>` uses today).
- [ ] Argument shape: `Array<PolicyDescriptor>` per FR10. Closed-set literal types for `operation` and `as`. `roles` accepts both branded `RoleRef`s and bare strings (lowered against the loaded contract aggregate).
- [ ] Implement the `ref(modelHandle)` helper. Returns canonical quoted namespace-qualified identifier per FR12. Composes with cross-contract model handle brands (consumes the brand contract from [cross-contract-refs](../cross-contract-refs/spec.md); no special handling here beyond reading the brand).
- [ ] Lowering: evaluate function-form predicates at lowering time; produce `PostgresRlsPolicy` IR with resolved predicate strings + computed wire-name suffix.
- [ ] Surface lowering diagnostics: duplicate `name` within a model, duplicate prefix within `(schema, table)` (per FR8), invalid `roles` reference.
- [ ] Add the model-level `rls` field on `model(name, config)`. Default `'auto'`.
- [ ] End-to-end authoring smoke tests against a synthetic app contract producing AC1's expected IR shape.

**Validation:** AC1, AC3, AC4 (TS half), AC6 verified through end-to-end authoring tests.

### M3 — PSL authoring surface + two-body-form ADR

**Goal:** PSL parity with the TS surface, plus capture the architectural pattern the PSL `policy` grammar instantiates.

**Tasks:**

- [ ] PSL grammar: top-level `policy <name> { body }` block per FR15. Body fields per FR16. Update the PSL grammar reference doc.
- [ ] PSL AST: `PslPolicyBlock` node with named fields; integrates with `PslDocumentAst.namespaces[].policies` (per the namespace block reopening shape from TML-2459).
- [ ] PSL lowering: produce the same `PostgresRlsPolicy` IR shape M2 produces, with the same hash computation. Round-trip-equivalent to the TS form for matching inputs.
- [ ] Cross-contract `target` rejection: `target = supabase:auth.User` is a load-time error naming the foreign contract space. Per FR16.
- [ ] PSL formatter handles the new block shape. Round-trip authored PSL through the formatter unchanged.
- [ ] Draft ADR: "Two body-form pattern in PSL — `field Type @attrs` for typed members, `key = value` for static configuration" (per umbrella offcut **OC1**). Drafted under `projects/postgres-rls/specs/adr-psl-two-body-forms.md`. The ADR observes that `datasource`, `generator`, and now `policy` all use the second form; promotes it to a project-wide convention so future declarations land consistently.
- [ ] End-to-end smoke tests: same fixtures as M2, declared in PSL, lower to identical IR.

**Validation:** AC2, AC5, AC3 (PSL half) verified end-to-end. Round-trip equivalence between TS and PSL forms verified by structural diff tests.

### M4 — Migration ops + verifier

**Goal:** the IR round-trips through the planner end (DDL emission) and the verifier end (introspection + diff). Cross-database integration tests prove the design works against a live Postgres.

**Tasks:**

- [ ] **Migration ops** per ADR 195's `OpFactoryCall` pattern:
  - `CreatePostgresRlsPolicyOp` — `CREATE POLICY "<name>" ON "<schema>"."<table>" AS <permissive|restrictive> FOR <op> TO <roles> [USING (…)] [WITH CHECK (…)]`.
  - `DropPostgresRlsPolicyOp`.
  - `AlterPostgresRlsPolicyOp` — covers Postgres's in-place ALTER capability matrix (rename, role change, predicate change for supported shapes). Falls back to drop + create for shapes Postgres can't ALTER in place.
  - `EnableRowLevelSecurityOp` / `DisableRowLevelSecurityOp`.
- [ ] Diff algorithm: compare declared `PostgresRlsPolicy[]` against introspected `pg_policies` rows by full wire name. Emit `Create` / `Drop` / `Alter` ops per the spec's diff rule.
- [ ] **Verifier** per FR23–FR29:
  - Introspection queries for `pg_policies`, `pg_roles`, `pg_class.relrowsecurity`.
  - Hash recompute on each introspected policy body; tamper check (FR25).
  - Rename detection: matching suffix, different prefix (FR26).
  - RLS-enabled state check (FR27).
  - Severity dispatch via control-policy primitive (FR29).
- [ ] Integration tests (PGlite-backed):
  - Round-trip: declare policies in contract, run `prisma-next push`, query `pg_policies`, assert match by full wire name. Run verifier, assert zero issues.
  - Tamper detection: manually `ALTER POLICY` outside the framework, re-run verifier, assert `rls_policy_tampered`.
  - Rename detection: change prefix in contract while keeping body identical, re-run planner, assert `ALTER POLICY ... RENAME TO`.
  - RLS-enabled state: declare policy on `rls: 'auto'` table, push, query `pg_class.relrowsecurity`, assert `true`. Manually `DISABLE ROW LEVEL SECURITY`, re-run verifier, assert `rls_not_enabled`.
  - Postgres expression-printer reformatting: declare predicate `user_id = (auth.uid())::uuid`, manually `ALTER POLICY ... USING (auth.uid() = user_id)`, re-run verifier, assert `rls_policy_tampered` (not `policy_mismatch` — proves AC8).
  - Roles: declare `PostgresRole` with `control: 'external'` that doesn't exist in `pg_roles`, verify `missing_role` is surfaced.
- [ ] Composition tests with cross-contract refs: a policy using `using: ({ ref }) => \`... ${ref(AuthUser)} ...\`` (AuthUser from extensionPacks) lowers correctly when both projects' machinery is wired up.

**Validation:** AC4, AC7, AC8, AC9, AC10, AC11 all green. End-to-end Postgres integration suite passes against PGlite.

### M5 — Documentation + close-out

**Goal:** capture the durable design decisions in subsystem docs and ADRs; clean up project artefacts.

**Tasks:**

- [ ] Promote `projects/postgres-rls/specs/adr-content-addressed-policy-names.md` into `docs/architecture docs/adrs/`. The promotion includes folding the "Forward applicability" section (per umbrella offcut **OC4**) into the canonical ADR so future projects can reach for the pattern.
- [ ] Promote `projects/postgres-rls/specs/adr-psl-two-body-forms.md` (drafted in M3) into `docs/architecture docs/adrs/`. Covers offcut **OC1**.
- [ ] Subsystem doc update: `docs/architecture docs/subsystems/adapters-and-targets.md` (or its analog) gains a Postgres-specific section covering `PostgresRlsPolicy`, `PostgresRole`, the content-addressed naming pattern, and the verifier's RLS algorithm.
- [ ] Update `docs/reference/typescript-patterns.md` if the `.rls(...)` stage represents a new pack-aware-typing application worth documenting; otherwise skip.
- [ ] Update [umbrella `decisions.md`](../supabase-integration/decisions.md) marking the relevant decisions (A1–A8, B1–B6, C9, C10, C11) as ✅ shipped, with links to merged PRs. Mark offcuts OC1 + OC4 as having an ADR (linked).
- [ ] Close-out: delete `projects/postgres-rls/` per the project workflow rule (after durable docs land).

**Validation:** docs review by the team; AC1–AC12 all green and verified through merged PRs.

## Walking-skeleton integration (cross-cutting DoD)

Per the umbrella's walking-skeleton strategy (decisions [C13/C14](../supabase-integration/decisions.md); [README](../supabase-integration/README.md) §"Walking skeleton"), this project's definition of done includes wiring its feature into the running `examples/supabase` app:

- [ ] Add RLS policies to `Profile` in the `examples/supabase` app contract (`anon` SELECT, `authenticated` UPDATE-own), via `.rls([...])` and — once the [target-contributed-psl-blocks](../target-contributed-psl-blocks/spec.md) substrate lands — the PSL `policy {}` form. Confirm the planner emits `CREATE POLICY` + `ENABLE ROW LEVEL SECURITY` and the verifier diffs clean against `pg_policies`.
- [ ] Prove **policy correctness** in the hermetic lane (PGlite + `bootstrapSupabaseShim`) by setting the role **by hand** (`SET LOCAL role = 'authenticated'; SET LOCAL request.jwt.claims = '…'`) and asserting RLS filters rows. The automatic `asUser`/`asAnon` live-query e2e is added later by `extension-supabase` M2 — not blocked on it (decision [C14](../supabase-integration/decisions.md)).

## Risks and mitigations

- **Risk:** the canonical normalizer doesn't cover the full Postgres expression-printer reformatting space. A real-world predicate slips through the normalizer's equivalence relation and surfaces as `rls_policy_tampered` on every build despite being semantically unchanged.
  - **Mitigation:** the M1 normalizer's test surface should include corpus testing — collect a sample of real Postgres-stored predicates from a live database (e.g. a fresh Supabase project), pair each with the corresponding authored predicate, assert the normalizer puts both in the same equivalence class. If a real-world reformatting escapes the normalizer, the test catches it before the verifier does.
- **Risk:** PSL grammar changes break round-trip fidelity with the existing fixture corpus. Subtle formatter or parser bugs cause `formatPsl(parsePsl(x)) !== x` for some existing contracts.
  - **Mitigation:** M3 runs the full PSL fixture suite before merge. The fixture coverage in `packages/*/test/fixtures` is broad enough to catch real-world tokenization regressions.
- **Risk:** the content-addressed naming pattern, designed only for policies in v0.1, gets retrofit-painfully when the next object kind (indexes, per offcut **OC4**) wants to use it.
  - **Mitigation:** M1 places the normalizer + hash machinery in a target-internal location (`core/rls/canonicalize.ts`) but writes the public surface (`computeContentHash`, `normalizePredicate`) in a way that's straightforward to lift into a shared `core/content-addressing/` module when the next consumer arrives. The lifting is a mechanical refactor, not a redesign.
- **Risk:** the rename detection (matching hash, different prefix) misclassifies cases where two policies coincidentally hash to the same suffix.
  - **Mitigation:** 32-bit hash space gives ~65k entries before 1% birthday-collision probability; a single table with >1000 policies is wildly outside any real-world contract size. The lowering-time `duplicate prefix within (schema, table)` error (FR8) catches the actual mutually-exclusive case the user would care about. The vanishingly rare cross-table coincidence is a non-issue: rename detection runs per `(schema, table)` and only reclassifies declared-vs-introspected within that table.
- **Risk:** the verifier's `pg_roles` check fails noisily for development databases that haven't provisioned the Supabase role set yet.
  - **Mitigation:** the `missing_role` severity dispatches through the control-policy primitive. Roles declared `control: 'external'` (the Supabase pack's default) surface as errors; roles declared `control: 'observed'` (a sensible default for dev environments) surface silently. The user controls the severity by choosing the control policy; the verifier doesn't impose a single policy globally.
