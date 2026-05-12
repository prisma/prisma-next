# Project Plan

## Summary

The project ships in seven PRs sequenced foundation → consumers → exemplars → docs. The opening foundation PR introduces the framework SPI interfaces, per-SPI family abstract bases, and the aggregating `Target<TContract, TSchema>` interface. Mongo lands as the first consumer of the foundation (rather than as a parallel stream) so SPI shape disagreements surface against a second family before SQL targets commit to the SPI shape. Postgres SPI shells follow, carrying the `validateContract` → `target.contractSerializer.deserializeContract(json)` migration alongside the structural lift to class-hierarchy IR. The two structural exemplars (enums, then namespace) build on the now-stable foundation; the namespace exemplar splits in two — M5a introduces the namespace concept, multi-tenancy, and the authoring-DSL surface; M5b adds cross-namespace FKs as the load-bearing user-facing capability. Documentation lands at close-out.

The user-facing capabilities this project delivers are: multi-schema Postgres contracts with namespace declarations in PSL (top-level `namespace { … }` blocks; namespaces do not recursively nest) and the TS builder; cross-namespace FK references within a contract space via dot-qualified type references in `@relation` (the FL-02 fix that unblocks Supabase's `auth.users` story); connection-bound multi-tenancy via `__unspecified__` + `search_path`. The IR refactor that underwrites these capabilities is invisible to users but is what makes the follow-up Supabase project (RLS policies, `supabase()` runtime facade, `auth.users` queryable surface) a series of focused feature PRs rather than another foundational reshape.

**Spec:** [`projects/target-extensible-ir/spec.md`](spec.md)
**Linear:** [TML-2459 — Target-Extensible IR](https://linear.app/prisma-company/issue/TML-2459)

## Cross-project dependencies

This project must land **after** the Contract Spaces work because both projects contend for the same files (test fixtures, Mongo IR, SQLite planner). The strict-precedence dependencies, in order:

1. **[TML-2457 — APP_SPACE_ID coupling audit](https://linear.app/prisma-company/issue/TML-2457).** Touches 294 sites across 75 files, mostly tests constructing contracts. This project's FR8/AC12 migration touches the same lines. Doing TML-2457 first means each test file has one stable contract construction site for this project to migrate, not two.
2. **[TML-2463 — SQLite multi-space planner upgrade](https://linear.app/prisma-company/issue/TML-2463).** Conflicts on SQLite planner files this project will reshape. Doing TML-2463 first means it builds against today's flat-data IR (well-understood); this project's foundation step then absorbs the SQLite IR-shape flip alongside Postgres. Independent of TML-2408 — can run in parallel with it.
3. **[TML-2408 — Port contract spaces to Mongo family](https://linear.app/prisma-company/issue/TML-2408).** Direct collision with this project's Mongo migration step (M2). Doing TML-2408 first means this project absorbs one well-understood migration (Mongo aggregate-aware infrastructure → 3-layer IR) instead of two simultaneous reshapings. Independent of TML-2463 — can run in parallel with it. **Sequencing constraint to flag in TML-2408's plan:** Mongo must land fully aggregate-native in TML-2408 (not in a half-migrated transition window); otherwise this project's Mongo step deals with mixed-state Mongo code.

Independent / non-blocking:

- **[TML-2458 — Remove vestigial `MigrationMetadata` fields](https://linear.app/prisma-company/issue/TML-2458).** Tiny, scoped to one type. No file conflict. Cheap to land before this project so we don't migrate fields that are about to be deleted, but it can land at any time.
- **[TML-2464 — Strip single/multi-space branching](https://linear.app/prisma-company/issue/TML-2464).** Blocked by TML-2463 + TML-2408 + this project. Should land **after** this project so the branch-removal touches IR-walking sites once (post-IR-flip) rather than twice.

Resulting global sequence: TML-2458 (any time) → TML-2457 → TML-2463 ∥ TML-2408 → **this project (M1 → M2 → M3 → M4 → M5a → M5b → M6)** → TML-2464.

## Milestones

The seven PRs below correspond to the seven milestones (M1, M2, M3, M4, M5a, M5b, M6). Each milestone is a single PR unless the diff size demands a split during execution; M3 specifically is large and is expected to split into M3a (Postgres) + M3b (SQLite) if its diff makes review unwieldy.

### M1 — Foundation (framework interfaces + family abstract bases)

**Goal:** declare the SPI interfaces and per-SPI family abstract bases. No targets touched yet; the framework + family layers compile but have no consumers. This is the largest single design surface and lands before any consumer commits to the shape.

**Tasks:**

- [ ] Declare framework SPI interfaces in `1-framework/`: `SchemaNode`, `Namespace`, `NamespaceBase`, `Target<TContract, TSchema>`, `SchemaVerifier<TContract, TSchema>`, `ContractSerializer<TContract>` (with `deserializeContract` + `serializeContract`).
- [ ] Declare SQL family abstract bases in `2-sql/`: `SqlNode`, `SqlContractSerializerBase`, `SqlSchemaVerifierBase`, plus the IR-node bases (`SqlTable`, `SqlColumn`, `SqlForeignKey`, `SqlIndex`, `SqlPrimaryKey`, `SqlUnique`).
- [ ] Declare Mongo family abstract bases in `2-mongo-family/`: `MongoContractSerializerBase`, `MongoSchemaVerifierBase`. Lift today's `MongoSchemaNode` to extend the framework `SchemaNode` interface (no behavioural change at this point).
- [ ] Family-shared utility helpers (`verifyCommonSqlSchema`, structural-validation helpers) co-land where the abstract bases call into them.
- [ ] `pnpm lint:deps` passes; layering is enforced.

**Validation:** the framework + family compile in isolation. No consumers exist; correctness is verified by typecheck + layering rules, not behavioural tests.

### M2 — Mongo migration (first consumer of the foundation)

**Goal:** Mongo becomes the first family to commit to the foundation's SPI shape. SPI shape disagreements surface here, in a PR scoped to one family, where they can be resolved without simultaneously breaking SQL.

**Tasks:**

- [ ] Introduce `MongoTargetContractSerializer extends MongoContractSerializerBase` and `MongoTargetSchemaVerifier extends MongoSchemaVerifierBase` (concrete SPI implementers).
- [ ] Flip Mongo Contract IR (`MongoIndex`, `MongoIndexOptions`, `MongoCollationOptions`, etc.) from `type =` data shapes to AST classes following the same recipe as Mongo's existing `MongoSchemaNode` AST.
- [ ] HAS-A `MongoTarget` facade composing `contractSerializer` + `schemaVerifier` as named properties; implements `Target<MongoContract, MongoSchemaIR>`.
- [ ] Migrate Mongo's framework-internal call sites to `target.contractSerializer.deserializeContract(json)` (Mongo-side share of the FR8 migration).
- [ ] Mongo unit + integration tests pass (`mongodb-memory-server`).
- [ ] If the SPI shape needs to flex to accommodate Mongo, the change lands in M1's interfaces — this is the cheapest moment to find such a need.

**Validation:** Mongo test suites pass. Family/target boundary is observable in code.

### M3 — Postgres SPI shells + `validateContract` migration

**Goal:** Postgres adopts the foundation. The `validateContract` → SPI migration lands here, including the test-cost share (FR8 / AC12).

**Tasks:**

- [ ] Introduce `PostgresContractSerializer extends SqlContractSerializerBase` and `PostgresSchemaVerifier extends SqlSchemaVerifierBase`.
- [ ] HAS-A `PostgresTarget` facade composing the SPIs as named properties; implements `Target<PostgresContract, SqlSchemaIR>`.
- [ ] Lift today's flat-data Postgres Contract IR to the AST-class hierarchy (`PostgresStorage`, `PostgresTable`, `PostgresColumn`, `PostgresForeignKey`, …) following the `OpFactoryCall` template.
- [ ] Lift Postgres SQL Schema IR (introspection-side) to the same class-hierarchy shape.
- [ ] Migrate every `validateContract` call site to `target.contractSerializer.deserializeContract(json)`. Remove the standalone `validateContract` function from public exports. The user-facing facade (`postgres<Contract>(...)`) wraps the SPI call so end-users do not see it.
- [ ] Migrate test suites: tests that exercise serialization import a real target; tests that don't satisfy `ContractSerializer<TContract>` with identity-function stubs.
- [ ] Apply the same SQLite-side IR-shape flip (no exemplars yet — just the structural lift).
- [ ] Postgres + SQLite unit + integration tests pass (PGlite).
- [ ] AC12 verified by inspection of migrated call sites and absence of `validateContract` from public exports.

**Validation:** existing Postgres + SQLite test suites green; round-trip property tests confirm fidelity (AC8).

### M4 — Enum exemplar (low-risk refactor)

**Goal:** prove the new IR pattern works end-to-end on a real existing concept by lifting enums from codec-hook glue into first-class IR nodes.

**Tasks:**

- [ ] Declare `abstract class SqlEnumType extends SqlNode` (family layer).
- [ ] Declare `class PostgresEnumType extends SqlEnumType` (target layer); Postgres-specific `CREATE TYPE` rendering, native-type-name resolution.
- [ ] Verifier walks `SqlEnumType` instances natively via the per-SPI verifier. Codec hooks for the enum case (`codecHooks.verifyType`, `expandNativeType` enum branches in `verify-sql-schema.ts`) are removed.
- [ ] Existing migration ops (`CreateEnumTypeCall`, `AddEnumValuesCall`, `DropEnumTypeCall`) consume the IR nodes directly without an intermediate translation layer.
- [ ] Authoring DSL preserved; internal lowering routes through the new IR.
- [ ] AC2 verified: enum tests pass without semantic change; codec-hook path removed for the enum case.

**Validation:** enum unit + integration tests pass; the diff visibly removes codec-hook glue.

### M5a — Namespace exemplar (new concept) + authoring DSL

**Goal:** introduce the higher-risk new framework-level concept on a foundation that is now well-exercised, and ship the authoring-DSL surface that makes namespaces usable in PSL and the TS builder.

**Tasks:**

- [ ] Declare `interface Namespace extends SchemaNode` and `abstract class NamespaceBase` in the framework layer.
- [ ] Declare `class PostgresSchema extends NamespaceBase` (target layer); search-path semantics, owner role, SQL rendering as `"<schema>"`.
- [ ] Reserve sentinel `id: '__unspecified__'`; SQLite uses the singleton; SQL emitter elides namespace qualifiers when the namespace is the singleton.
- [ ] Mongo's analog (database name or singleton) decided here in implementation; reflect the call in M2 if that step would benefit from foreshadowing.
- [ ] Re-key every storage object (table, enum, function, …) by `(namespace.id, name)` rather than `name` alone. Verifier walks two parallel trees of namespace-scoped objects. (FKs are still single-namespace at this milestone — M5b adds the cross-namespace FK shape.)
- [ ] Authoring DSL — TS builder: top-level `namespaces` declaration list + per-model `namespace` field; defaulting to `__unspecified__` when omitted (FR16a).
- [ ] Authoring DSL — PSL: top-level `namespace <name> { … }` blocks (reopenable; namespace blocks do not recursively nest; elements declared outside any block live in `__unspecified__`); the parser path lowers to the same Contract IR shape. AST changes: `PslDocumentAst.namespaces`, `PslField.typeNamespace?` (the latter consumed in M5b).
- [ ] Multi-tenancy `__unspecified__` resolution end-to-end via connection `search_path` (AC6).
- [ ] Existing single-namespace contracts migrate mechanically: Postgres contracts default to `__unspecified__` (search_path resolves to `public` at the database level, matching today's behaviour); SQLite gets singleton; Mongo gets analog.

**Validation:** ACs 4a, 5, 6 pass. Multi-namespace + multi-tenancy integration tests green. AC4 (cross-namespace FK demonstration) is *not* yet green at this milestone — it lands in M5b.

### M5b — Cross-namespace FK references

**Goal:** complete the namespace story by adding cross-namespace FK references within a single contract space — the FL-02 fix that unblocks Supabase's `auth.users` story.

**Tasks:**

- [ ] FK reference IR carries a namespace coordinate on both sides (the table side already gains one in M5a; this milestone adds it to the *reference* side). **Design discipline (FR16b extension-point note):** do not fuse `namespace.id` and `name` into a single composite key; keep them addressable separately so cross-*contract-space* refs can extend the shape additively to `(spaceId, namespace.id, name)` in a follow-up project without restructuring the IR.
- [ ] Verifier dispatches on `(namespace.id, name)` for both ends of an FK; walks across namespaces correctly.
- [ ] Planner-DDL builder emits qualified `REFERENCES "<schema>"."<table>"("<col>")` clauses for named namespaces and unqualified `REFERENCES "<table>"("<col>")` for `__unspecified__` (search_path resolves at migration time).
- [ ] Authoring DSL — TS builder: existing FK call sites (`constraints.foreignKey(cols.x, OtherModel.refs.y, …)` in the SQL-block constraints DSL and `rel.belongsTo(OtherModel, …)` in the relations DSL) lower to cross-namespace IR automatically when `OtherModel`'s namespace differs from the referencing model's — the model handle carries the namespace coordinate, no new syntax (FR16b).
- [ ] Authoring DSL — PSL: dot-qualified type references in the existing `@relation` mechanism (`user auth.User @relation(fields: [userId], references: [id])`). No new attribute; the namespace coordinate is carried by the type position.
- [ ] Integration test (PGlite): a Postgres contract with `public.profiles.user_id REFERENCES auth.users(id)` migrates, emits, and verifies end-to-end (FL-02 scenario).

**Validation:** AC4 (cross-namespace FK) passes. FL-02 acceptance demonstrated via PGlite integration test. The Supabase `auth.users` reference shape is now expressible in Prisma Next contracts.

### M6 — Documentation + ADR drafts

**Goal:** lift the convention out of the project workspace into durable repo docs so it outlives the project.

**Tasks:**

- [ ] Update `AGENTS.md` / `CLAUDE.md` Golden Rule on "Interface-Based Design" to split along the service-vs-AST/IR axis described in the spec § "Codifying the convention" (FR21).
- [ ] Add the AST/IR class-hierarchy section to `docs/reference/typescript-patterns.md` as a sibling to "Interface-Based Design with Factory Functions" (FR22).
- [ ] Update `docs/Architecture Overview.md` § "Guiding Principles" to surface "framework provides affordances; targets implement specifics" and "familiar with one target, fluent in another" (FR23).
- [ ] Update affected subsystem docs (`Data Contract`, `Contract Emitter & Types`, `Adapters & Targets`) to reflect the class-hierarchy IR shape (FR24).
- [ ] Draft ADRs under `projects/target-extensible-ir/specs/`: (a) the 3-layer polymorphic IR convention; (b) the architectural principles underwriting it (FR25 / AC10).

**Validation:** docs reviewable as diffs; ADR drafts ready for promotion at close-out.

## Close-out (required)

- [ ] Verify all acceptance criteria in [`projects/target-extensible-ir/spec.md`](spec.md).
- [ ] Promote ADR drafts (3-layer IR convention; architectural principles) from `projects/target-extensible-ir/specs/` to `docs/architecture docs/adrs/`.
- [ ] Confirm `AGENTS.md` / `CLAUDE.md` Golden Rule is updated and `docs/reference/typescript-patterns.md` carries the new AST/IR section.
- [ ] Confirm `docs/Architecture Overview.md` § "Guiding Principles" surfaces "framework provides affordances; targets implement specifics" and "familiar with one target, fluent in another".
- [ ] Confirm subsystem docs in `docs/architecture docs/subsystems/` (Data Contract, Contract Emitter & Types, Adapters & Targets) reflect the class-hierarchy IR shape.
- [ ] Migrate any other long-lived docs into `docs/`.
- [ ] Strip repo-wide references to `projects/target-extensible-ir/**` (replace with canonical `docs/` links or remove).
- [ ] Delete `projects/target-extensible-ir/`.
