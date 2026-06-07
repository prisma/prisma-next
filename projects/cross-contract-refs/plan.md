# Project Plan

## Status / next-up (2026-06-07 — M2 merged) — resume here

- **M1: ✅ MERGED (PR #745).** Storage IR carrier + aggregate-load checks.
- **M2: ✅ MERGED (PR #752).** TS brands + PSL grammar + non-navigable cross-space relation + supabase `/contract` handles + CodeRabbit hardening.
- **M3a: ✅ COMPLETE (branch `tml-2500-m3-planner-verifier`, PR opening).** All 4 dispatches
  SATISFIED, trace backstop green (13 cumulative dispatches across M1+M2+M3a), full gate clean.
  Delivered:
  - **M3a.1** PSL aggregate resolution at the CLI loader (resolves cross-space FK `tableName` from
    the symbolic `modelName.toLowerCase()` fallback to the real `users`); column-existence
    validation; PSL↔TS parity test flip (closes AC2).
  - **M3a.2** Postgres planner DDL audit — dead-path `buildForeignKeySql` documented, live-path
    `renderForeignKeySql` pinned with regression tests for both qualified
    `REFERENCES "auth"."users"` and unqualified `__unbound__` (closes AC3 planner half).
  - **M3a.3** Verifier cross-space FK regression tests — no code change needed (the existing
    target-table-agnostic comparison walks cross-space identically).
  - **M3a.4** AC7 PGlite integration test — synthetic app contract with `Profile.userId →
    auth.users.id`, runs CLI `dbInit` apply, queries `pg_constraint` cross-joined for the
    cross-schema FK, asserts `confdeltype='c'`, runs `dbVerify` zero issues. Plus a 6-line
    `validate-domain.ts` fix for a pre-existing M2.2 gap (cross-space relations were tripping
    `validateRelationTargets` because no prior test deserialized a cross-space contract).
- **NEXT — M3b (separate PR, opens after M3a merges).** Walking-skeleton FK wiring +
  cascade-delete hermetic test + `BuiltStorageTables.spaceId` type-surface cleanup. Scope is
  recorded in `slices/M3a/plan.md` § Open items.

- **M1 — Foundation: ✅ MERGED (PR #745).** FK carrier (`ForeignKeyReference.spaceId`, presence =
  cross-space discriminator); cross-space dependency graph + cycle rejection; reverse-reference
  rejection; primitive-ownership collisions via a namespace-aware `disjointness`.
- **M2 — Authoring surfaces: ✅ COMPLETE (branch `tml-2500-m2-authoring-surfaces`, PR opening).**
  All 5 dispatches SATISFIED (M2.1–M2.5), trace backstop green, full gate green (typecheck 138/138,
  lint 79/79, lint:deps clean, lint:casts delta=0, fixtures:check exit 0). Delivered:
  - **M2.1** TS brand foundation (`TargetFieldRef<…, TSpaceId>`, `<self>`/spaceId; brand survives the
    staged builder) + storage cross-space FK lowering (`ForeignKeyReference.spaceId`) + missing-pack
    fail-fast (AC5 TS) + cascade no-diagnostic (AC4).
  - **M2.2** TS cross-space relation, **Option B non-navigable** — `spaceId` on
    `BelongsToRelation`/`RelationNode`/`CrossReference.space`; emitter renders cross-space relations as
    `never` so ORM `include` is a compile error (proven by a negative type test).
  - **M2.3** Supabase `/contract` branded handles (`AuthUser` etc.) via a new **`extensionModel(...)`
    factory** in contract-ts (`ContractModelBuilder` stays type-only); handle↔contract consistency test.
  - **M2.4** PSL colon-prefix grammar (`supabase:auth.User` / `supabase:User`) — `PslField.typeContractSpaceId`,
    parser branch, interpreter **symbolic** lowering (spaceId + namespace + columns) + missing-pack
    diagnostic (`PSL_UNKNOWN_CONTRACT_SPACE`, AC5 PSL).
  - **M2.5** PSL printer round-trip for the qualified form (also fixed the pre-existing TML-2459
    `typeNamespaceId` printer-drop bug); AC2 round-trip closed.
- **NEXT — M3 — Planner + verifier integration.** Scope: planner DDL (qualified vs unqualified
  `REFERENCES`), verifier walk of `source:'space'` FKs, PGlite integration test (AC7), the `__unspecified__`
  planner half of AC3, **and the deferred items below that M3 must resolve**:
  - **PSL cross-space target-table resolution** — M2.4 carries a *symbolic* coordinate; the PSL carrier's
    `tableName` is `modelName.toLowerCase()` (e.g. `user`), NOT the real table (`users`). M3 resolves
    model→table against the **loaded aggregate** (where the extension contracts are available — the PSL
    interpreter only has space *names*). The `psl-ts-namespace-parity.test.ts` pins this divergence with a
    failing-on-resolution assertion; M3 flips it. (FR10/FR19/FR20.)
  - **Walking-skeleton FK wiring** — add `Profile.userId → auth.User.id` (onDelete cascade) to
    `examples/supabase` + the cascade-delete hermetic test (needs the planner).
  - **FK-target `spaceId` type-surface gap** — `BuiltStorageTables<Definition>` omits `spaceId` on the FK
    target at the type level (runtime carrier has it). Small `contract-ts`/`sql-contract` cleanup.
- **Standing gate (M1+M2 lessons — apply every dispatch):** full `pnpm lint` + `pnpm fixtures:check` +
  full `pnpm typecheck` (not just package-scoped — implementers default to package scope and miss
  downstream); **run `pnpm build` / rebuild dependent `dist` before downstream tests and before
  fixtures:check** (fixtures:check executes the CLI dist + imports extension dist — missing dist like
  `extension-pgvector/dist/control.mjs` makes it red environmentally, not a regression); **emit trace
  events live**; orchestrator independently re-verifies the gate (implementer reports were thin/optimistic
  and two returned truncated mid-work — verify via git + re-run the risky gates).
- **Worktree note:** this worktree needed `pnpm install` (supabase/mongo had no `node_modules`) + a full
  `pnpm build` to materialize all dist; after that the full gate is genuinely clean (no mongo/cli caveat).
- **Deferred (recorded):** transitive auto-loading of unlisted contract spaces; runtime cross-space query +
  relation traversal (needs a runtime contract-space aggregate); Mongo cross-space *relationships*.

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

> **Reconciliation against landed substrate (2026-06-05).** The spec/plan were authored when TML-2459 + TML-2493 were future; both have landed. A read-only investigation of the current code corrected these M1 assumptions (drift IDs match the reconciliation report in chat / `rollups/2026-06-05-opening.md` lineage):
>
> - **D1/D2/D3 — FK carrier is a flat storage-layer class, not a `source`-discriminated union with model names.** Today `ForeignKey` (`packages/2-sql/1-core/contract/src/ir/foreign-key.ts`) holds `{ source, target }` where each side is `ForeignKeyReference { namespaceId: NamespaceId, tableName, columns }`. There is **no** `source: 'local' | 'space'` discriminator today and the carrier names tables/columns, **not** `modelName`/`fieldName` (model names live only in the pre-lowering domain-plane `ForeignKeyNode`). M1 **adds** the discriminator to a flat class; the spec's illustrative `{ source: 'local'; modelName; fieldName }` type is wrong — the `'local'` variant is `{ namespaceId, tableName, columns }`. Within-contract cross-namespace FKs (M5b) already work via `target.namespaceId`, with no discriminator.
> - **D6 — use `UNBOUND_NAMESPACE_ID = '__unbound__'`, not `'__unspecified__'`, for the IR/unqualified-DDL sentinel.** `__unspecified__` (`UNSPECIFIED_PSL_NAMESPACE_ID`) is a **parser-only** bucket that never reaches the IR. The carrier's `namespace` coordinate uses `'__unbound__'` (`packages/1-framework/1-core/framework-components/src/ir/namespace.ts`). Apply this correction wherever the spec/plan say `__unspecified__` at the IR/DDL layer.
> - **D5 — recursive `extensionPacks` resolution is NEW work.** Today only the top-level app contract's `extensionPacks` is consumed; extension-declared `extensionPacks` are not walked. The dependency-graph task below must build the recursive walk, not just validate an existing one.
> - **D8 — ArkType validator co-change.** The SQL serializer is identity-based (JSON-clean by construction holds), but the FK validator schema in `packages/2-sql/1-core/contract/src/validators.ts` must be extended for the new variant — add it as an explicit sub-task of the round-trip task.
> - **D9 — the build-contract assembler needs a space-FK code path.** `build-contract.ts` FK assembly looks up targets in local `allSpecs`; a `source: 'space'` carrier must bypass that lookup and accept pre-resolved coordinates. M1 is not purely a passive IR-class addition.
> - **D10 — drop the Mongo mirror.** Mongo's contract IR has no FK concept (`MongoCollection` has no FKs), so "mirror the carrier in the Mongo family" has no object to extend. Reduced to a no-op note below.
> - **Control-policy risk retired.** TML-2493's planner dispatch (`partitionIssuesByControlPolicy` in `packages/2-sql/9-family/src/core/migrations/control-policy.ts`, called from the Postgres planner) already drops `external` tables from planner input — so the M3 shim in "Risks and mitigations" is unnecessary. M3 calls the real dispatch directly.

**Tasks:**

- [ ] Extend the FK reference carrier (`ForeignKey` / `ForeignKeyReference` in `packages/2-sql/1-core/contract/src/ir/`, + any Postgres concretion) to discriminate `source: 'local' | 'space'`. The `'space'` variant carries `spaceId`, `namespace` (the IR namespace coordinate, admitting `UNBOUND_NAMESPACE_ID`), `tableName`, `columnName`. The `'local'` variant retains today's flat `{ namespaceId, tableName, columns }` shape (per D1/D2/D3 above — this is a discriminator added to a non-discriminated class, not an extension of an existing union).
- [ ] ~~Mirror the carrier extension in the Mongo family.~~ **No-op (D10):** Mongo's contract IR has no FK concept; nothing to mirror. Record this as a one-line note rather than a code change.
- [ ] Extend the FK round-trip to cover the new variant. JSON-clean by construction; no `toJSON()` needed — **but** update the ArkType FK validator schema in `packages/2-sql/1-core/contract/src/validators.ts` (D8) and confirm the `new StorageTable(...) → new ForeignKey(...) → new ForeignKeyReference(...)` deserialization path handles both variants.
- [ ] Implement contract-aggregate dependency-graph construction from `extensionPacks` (depends-on relationships, including extensions-depending-on-extensions). **This includes building the recursive walk of extension-declared `extensionPacks`, which does not exist today (D5)** — currently only the top-level app contract's list is consumed. Reject cycles at load time.
- [ ] Implement namespace-ownership tracking on the loaded aggregate: every primitive `(namespace.id, name)` is owned by exactly one contributing contract. Duplicate declarations fail load with a diagnostic naming both contributors (FR16/AC6).
- [ ] Implement reverse-reference rejection: an extension contract referencing an app model fails load with a clear diagnostic (FR14).
- [ ] Round-trip property tests for the new IR carrier (AC8).
- [ ] `pnpm lint:deps` passes.

**Validation:** new IR carrier round-trips cleanly; synthetic test fixtures exercising aggregate-load checks produce the expected diagnostics. No authoring path yet — call sites and PSL grammar land in M2.

### M2 — Authoring surfaces (TS brands + PSL grammar)

**Goal:** make the carrier reachable through user code. After this milestone, an app contract can declare a cross-contract FK in both TS and PSL forms; the surfaces produce the M1 IR shape.

> **Design decision (2026-06-05, operator-approved): Option B — declared, non-navigable cross-space relations.** A cross-space ref declares a domain-plane *relationship* (not just a storage FK), via the unified surface (`rel.belongsTo(ExtModel, …)` in TS, `ext:ns.Model @relation(…)` in PSL). It is **non-navigable** — the emitter makes ORM `include` of a cross-space relation a compile-time error; runtime query/traversal across spaces is out of scope (spec Non-goals). Concrete M2 work this adds, grounded in the current code:
> - Add a foreign-`spaceId` slot to the domain-plane relation carriers: `TargetFieldRef` / `RelationModelSource` (`packages/2-sql/2-authoring/contract-ts/src/contract-dsl.ts`) and `RelationNode` (`contract-definition.ts`). Today none carry `spaceId`.
> - Gate the relation lowering: `lowerBelongsToRelation` (`contract-lowering.ts`) and `assertKnownTargetModel` (`build-contract.ts`) currently throw when the target isn't a local model. For a branded (cross-space) target, skip the local-model lookup and resolve the target table/columns from the loaded aggregate instead.
> - Emitter: render cross-space relations as non-navigable so `include` is a compile error (sub-choice deferred to implementation: omit from the include surface vs `never`-type it — lean toward omit for a clearer error).
> - The storage-plane FK path (`constraints.foreignKey(cols.x, ExtModel.refs.y, …)` + `ColumnRef<TSpaceId>` brand) is unchanged from this milestone's plan; it is what actually emits the DDL constraint.

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
- **Risk (RETIRED 2026-06-05):** the planner needs to compose with the control-policy project's dispatch on the target table.
  - **Resolution:** TML-2493 has landed. The real dispatch (`partitionIssuesByControlPolicy` in `packages/2-sql/9-family/src/core/migrations/control-policy.ts`, called from the Postgres planner at `planner.ts`) already drops `external` tables from planner input — no `CREATE TABLE` is generated for them. The planned shim is unnecessary; M3 calls the landed dispatch directly.
