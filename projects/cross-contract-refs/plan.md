# Project Plan

## Summary

The project ships in four PRs sequenced foundation → authoring surfaces → planner/verifier integration → documentation. M1 introduces the FK reference carrier extension (`source: 'local' | 'space'`) at the framework + SQL family layers and the contract-aggregate dependency-graph + namespace-ownership checks. M2 ships the TS authoring surface (model-handle brands, `ColumnRef<TSpaceId>`, lowering-pass cross-contract handling) and the PSL grammar/AST extension (colon-prefix tokenizer change, `PslField.typeContractSpace?`). M3 wires the carrier through the planner (qualified vs unqualified `REFERENCES` clause, composition with control-policy dispatch on the target table) and the verifier (target-table-existence check defers to control policy; FK-constraint check is identical to local FKs). M4 closes out documentation — the cross-contract pattern is captured in the canonical extension-authoring guidance and the namespace-ownership rules land in a subsystem doc.

**Spec:** [`projects/cross-contract-refs/spec.md`](spec.md)
**Linear:** _(to be created — see project tracker in umbrella `projects/supabase-integration/README.md`)_

## Cross-project dependencies

This project depends on [TML-2459 — Target-Extensible IR](../target-extensible-ir/spec.md). Specifically:

- **TML-2459 M1 (foundation).** The framework `SchemaNode`/`Namespace` interfaces and the `Storage` shape carrying `namespaces`. The cross-contract FK carrier extends the local FK carrier introduced here.
- **TML-2459 M5a (namespace exemplar).** The `Namespace` framework concept and `__unspecified__` singleton subclass pattern.
- **TML-2459 M5b (cross-namespace FKs).** The within-contract cross-namespace FK shape this project's `source: 'space'` discriminator slots in *next to*.

This project can land in parallel with [postgres-rls](../postgres-rls/spec.md) and [runtime-target-layer](../runtime-target-layer/spec.md) once TML-2459 ships through M5b. It is a hard dependency of [extension-supabase](../extension-supabase/spec.md), which consumes the cross-contract FK shape to model the canonical `Profile.user → AuthUser.id` example.

Resulting global sequence (within the Supabase umbrella): **TML-2459 (through M5b)** → **this project ∥ postgres-rls ∥ runtime-target-layer** → **extension-supabase** (consumes all three).

## Milestones

The four PRs below correspond to the four milestones (M1, M2, M3, M4). Each milestone is one PR.

### M1 — Foundation (IR carrier + aggregate-load checks)

**Goal:** declare the cross-contract FK carrier shape at the framework + SQL family layers, and add the cross-contract-specific checks to contract-aggregate loading. No authoring surface yet; the new shape compiles but is unreachable except through synthetic test fixtures.

**Tasks:**

- [ ] Extend the FK reference carrier (in the SQL family `SqlForeignKey` family abstract base + Postgres concretion) to discriminate `source: 'local' | 'space'`. The `'space'` variant carries `spaceId`, `namespace: NamespaceCoordinate`, `tableName`, `columnName`. The `'local'` variant retains its TML-2459 M5b shape.
- [ ] Mirror the carrier extension in the Mongo family (no cross-family FKs in v0.1 per Non-goals, but the abstract base shape stays parallel across families).
- [ ] Extend `ContractSerializer` round-trip in both SQL + Mongo families to cover the new variant. JSON-clean by construction; no `toJSON()` needed.
- [ ] Implement contract-aggregate dependency-graph construction from `extensionPacks` (depends-on relationships, including extensions-depending-on-extensions). Reject cycles at load time.
- [ ] Implement namespace-ownership tracking on the loaded aggregate: every primitive `(namespace.id, name)` is owned by exactly one contributing contract. Duplicate declarations fail load with a diagnostic naming both contributors (FR16/AC6).
- [ ] Implement reverse-reference rejection: an extension contract referencing an app model fails load with a clear diagnostic (FR14).
- [ ] Round-trip property tests for the new IR carrier (AC8).
- [ ] `pnpm lint:deps` passes.

**Validation:** new IR carrier round-trips cleanly; synthetic test fixtures exercising aggregate-load checks produce the expected diagnostics. No authoring path yet — call sites and PSL grammar land in M2.

### M2 — Authoring surfaces (TS brands + PSL grammar)

**Goal:** make the carrier reachable through user code. After this milestone, an app contract can declare a cross-contract FK in both TS and PSL forms; the surfaces produce the M1 IR shape.

**Tasks:**

- [ ] **TS surface:**
  - Add `ColumnRef<TSpaceId>` brand parameter to the column-reference type. Local refs are `ColumnRef<'<self>'>`; extension refs are `ColumnRef<TExtSpaceId>`.
  - Brand model handles exported from extension `/contract` subpaths with the extension's `spaceId`. Local model handles produced by `model(...)` inside `defineContract` carry the `<self>` brand.
  - Extend `rel.belongsTo(OtherModel, …)` and `constraints.foreignKey(cols.x, OtherModel.refs.y, …)` to inspect the target handle's brand at lowering time. Cross-contract refs lower to `source: 'space'` carriers; local refs continue to lower to `source: 'local'`.
  - Lowering produces the fail-fast missing-pack diagnostic (FR11, AC5 TS half) when a referenced handle's brand isn't declared in `extensionPacks`.
- [ ] **PSL surface:**
  - Lexer change: treat `:` as a distinct token in identifier position. Document the new lexeme in the PSL grammar reference.
  - Parser change: accept `<space>:<namespace>.<name>` and `<space>:<name>` (no-namespace form for `__unspecified__` targets) in field-type positions. Bare `<namespace>.<name>` and `<name>` retain their TML-2459 semantics.
  - AST change: `PslField.typeContractSpace?: string` carries the colon-prefix coordinate.
  - PSL → Contract IR lowering threads `typeContractSpace` into the FK carrier as `spaceId`. The lowering pass produces the same missing-pack diagnostic as the TS half (AC5 PSL half).
  - PSL formatter handles the new token in field-type positions. Round-trip authored PSL through the formatter unchanged (modulo the open-question stylistic call).
- [ ] **`onDelete: 'cascade'` cross-contract permission (FR6, AC4):** no diagnostic emitted at any framework layer when a cross-contract FK carries a non-default referential action. Verify by inspection of the diagnostic call sites and a regression test asserting silence.
- [ ] End-to-end authoring smoke tests for both surfaces against a synthetic two-contract fixture (one extension, one app contract).

**Validation:** AC1, AC2, AC3, AC4, AC5 verified end-to-end through authoring. The carrier shape is now reachable through user code in both TS and PSL.

### M3 — Planner + verifier integration

**Goal:** the carrier round-trips through the planner and verifier ends. Cross-contract FKs reach a live Postgres database; the verifier confirms them against `pg_constraint`.

**Tasks:**

- [ ] Planner DDL emission:
  - Named target namespace: emit qualified `REFERENCES "<schema>"."<table>"("<col>")`.
  - `__unspecified__` target namespace: emit unqualified `REFERENCES "<table>"("<col>")`.
  - The planner consults the target's control policy (the parallel `control-policy` project's primitive) to decide whether to emit `CREATE TABLE` for the target. The normal case is `control: 'external'` — no DDL for the target table. The planner composes through the control-policy dispatch; no cross-contract-specific code in the planner beyond the qualifier rule (FR20).
- [ ] Verifier:
  - The FK-constraint existence + shape check walks `source: 'space'` carriers identically to `source: 'local'` ones.
  - The target-table existence + shape check defers to the target's control policy. Verified by inspection of the verifier walk + an integration test that proves the verifier doesn't try to apply DDL drift detection to an `external` target table.
- [ ] Integration test (PGlite-backed): an app contract declares `Profile.user_id → auth.users.id`; the test brings up Postgres with both schemas, runs `prisma-next push`, verifies the FK exists in `pg_constraint`, runs the framework verifier, and asserts zero issues (AC7).
- [ ] Integration test for `__unspecified__` cross-contract refs: a SQLite-style extension publishes models in `__unspecified__`; the app references them; the planner emits unqualified `REFERENCES` (AC3).

**Validation:** AC3, AC7, AC9 (existing TML-2459 local FK tests still green), AC10 (`pnpm lint:deps` green).

### M4 — Documentation + close-out

**Goal:** capture the durable design decisions in subsystem docs and the extension-authoring guide; clean up project artefacts.

**Tasks:**

- [ ] Subsystem doc update: `docs/architecture docs/subsystems/` gains (or updates an existing doc covering) "Contract aggregates and cross-contract references" — covering dependency-graph construction, namespace-ownership rules, the FK carrier discriminator, and the resolution rule.
- [ ] Extension-authoring guidance (a skill or rulecard, depending on where this lands during execution) documents:
  - How an extension exposes branded model handles via its `/contract` subpath.
  - How the app declares a dependency via `extensionPacks`.
  - The colon-prefix PSL syntax and when to use it vs the TS form.
- [ ] Promote any ADR drafts produced during execution from `projects/cross-contract-refs/specs/` into `docs/architecture docs/adrs/` per the project workflow rule.
- [ ] Update [umbrella `decisions.md`](../supabase-integration/decisions.md) to mark cross-contract refs as ✅ shipped, with links to the merged PRs.
- [ ] Close-out: delete `projects/cross-contract-refs/` per the project workflow rule (after the durable docs land).

**Validation:** docs review by the team; AC1–AC10 all green and verified through merged PRs.

## Walking-skeleton integration (cross-cutting DoD)

Per the umbrella's walking-skeleton strategy (decisions [C13/C14](../supabase-integration/decisions.md); [README](../supabase-integration/README.md) §"Walking skeleton"), this project's definition of done includes wiring its feature into the running `examples/supabase` app:

- [ ] Add the `Profile.userId → auth.User.id` cross-contract FK (with `onDelete: 'cascade'`) to the `examples/supabase` app contract; confirm the planner emits qualified `REFERENCES "auth"."users"("id")`.
- [ ] Cover it in the example's hermetic test lane (PGlite + `bootstrapSupabaseShim`): migration creates the FK; a cascade delete from `auth.users` removes the dependent `public.profile` row.

## Risks and mitigations

- **Risk:** the colon-prefix tokenizer change in PSL is a backwards-incompatible lexer change. Any existing code that used `:` inside a type position (unlikely, but possible in malformed contracts) breaks.
  - **Mitigation:** PSL is in 0.x. Run the full fixture suite on the new lexer before landing M2. The fixture coverage in `examples/` + the per-package test fixtures is broad enough to catch any real-world tokenization regression.
- **Risk:** the `<self>` brand on local model handles requires threading a contract identifier through the `model(...)` builder. This is type-system gymnastics that can degrade autocomplete performance if done naively.
  - **Mitigation:** the open question in the spec acknowledges the implementer has two paths (closure-captured contract id vs post-hoc tagging). Either works for AC purposes; the implementer picks based on autocomplete responsiveness measured against a realistic schema.
- **Risk:** namespace-ownership collision detection has to run at aggregate-load time, before any single contract is fully validated. Subtle ordering bugs could cause the detection to miss a collision or report a false positive.
  - **Mitigation:** the M1 milestone lands aggregate-load checks before any authoring surface exists. Synthetic test fixtures exercise every collision shape (two extensions same-namespace, app + extension same-namespace, cycle in dependency graph, reverse reference) before M2 begins.
- **Risk:** the planner needs to compose with the control-policy project's dispatch on the target table. If `control-policy` lands later than expected, this project's M3 either blocks or ships with a stub.
  - **Mitigation:** the projects are parallel-able. If `control-policy` slips, this project's M3 stubs the dispatch with a temporary `if (table.spaceId !== self.spaceId) skipDdl()` shim and replaces the shim with the real dispatch when `control-policy` lands. The shim is well-scoped; replacement is mechanical.
