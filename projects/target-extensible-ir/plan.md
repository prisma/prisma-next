# Project Plan

## Summary

The project ships in seven PRs sequenced foundation → consumers → exemplars → docs. The opening foundation PR introduces the framework SPI interfaces (`ContractSerializer<TContract>`, `SchemaVerifier<TContract, TSchema>`), the framework `SchemaNodeBase` abstract class, the `Storage` interface with `namespaces` shape, and the per-SPI family abstract bases. No new `Target<TContract, TSchema>` aggregator is introduced; the existing target descriptor pattern (`SqlControlTargetDescriptor`, etc.) grows two new named properties next to `migrations`. Mongo lands as the first consumer of the foundation (rather than as a parallel stream) so SPI shape disagreements surface against a second family before SQL targets commit to the SPI shape. Postgres + SQLite land together (M3) because they share family-level abstract bases — flipping one without the other would leave the family bases in a dual-shape state. The two structural exemplars (enums, then namespace) build on the now-stable foundation; the namespace exemplar splits in two — M5a introduces the namespace concept, multi-tenancy, and the authoring-DSL surface; M5b adds cross-namespace FKs as the load-bearing user-facing capability. Documentation lands at close-out.

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

The seven PRs below correspond to the seven milestones (M1, M2, M3, M4, M5a, M5b, M6). Each milestone is a single PR. **M3 is not splittable into Postgres-then-SQLite:** the two SQL targets share family-level abstract bases (`SqlTable`, `SqlColumn`, `SqlForeignKey`, …), and lifting one to the class-hierarchy shape without the other would leave the family bases in a dual-shape state — incompatible with NFR1 ("no dual-shape transition window"). The Postgres + SQLite lifts therefore land in one PR; SQLite's share of the work is mechanical within that scope.

### M1 — Foundation (framework interfaces + family abstract bases)

**Goal:** declare the SPI interfaces and per-SPI family abstract bases. No targets touched yet; the framework + family layers compile but have no consumers. This is the largest single design surface and lands before any consumer commits to the shape.

**Tasks:**

- [ ] Declare framework types in `1-framework/`:
  - `interface SchemaNode { readonly kind: string }` — bare alphabet, no `accept`/`freeze` methods.
  - `abstract class SchemaNodeBase implements SchemaNode` — centralised `freeze()` helper for subclasses (mirrors today's frozen-AST pattern in `OpFactoryCall` and `MongoSchemaNode`). Subclasses call `this.freeze()` in their constructors.
  - `interface Namespace extends SchemaNode { id: string; … }`.
  - `abstract class NamespaceBase implements Namespace`.
  - `interface Storage { readonly namespaces: Record<string, Namespace> }` — the framework-level promise that every IR carries namespaces (enforces FR15 at the type level).
  - `interface SchemaVerifier<TContract, TSchema>` and `interface ContractSerializer<TContract>` (with `deserializeContract(json: unknown): TContract` and `serializeContract(contract: TContract): JsonObject`).
  - `createIdentityContractSerializer<TContract>()` helper for tests that don't exercise serialization.
  - **No new `Target<TContract, TSchema>` aggregator interface.** SPI aggregation lives on the existing `*ControlTargetDescriptor` / `*RuntimeTargetDescriptor` types (in `framework-components/control/control-instances.ts`); those grow new typed properties for `contractSerializer` and `schemaVerifier` as part of the descriptor type definitions.
- [ ] Declare SQL family abstract bases in `2-sql/`: `SqlNode extends SchemaNodeBase`, `SqlContractSerializerBase`, `SqlSchemaVerifierBase`, plus the IR-node bases (`SqlTable`, `SqlColumn`, `SqlForeignKey`, `SqlIndex`, `SqlPrimaryKey`, `SqlUnique`) and `abstract class SqlStorage implements Storage`.
- [ ] Declare Mongo family abstract bases in `2-mongo-family/`: `MongoContractSerializerBase`, `MongoSchemaVerifierBase`, `abstract class MongoStorage implements Storage`. Lift today's `MongoSchemaNode` to extend `SchemaNodeBase` (no behavioural change at this point).
- [ ] Family-shared utility helpers (`verifyCommonSqlSchema`, structural-validation helpers) co-land where the abstract bases call into them.
- [ ] Draft the ADRs the foundation calls for under `projects/target-extensible-ir/specs/`, captured against the foundation they describe; drafts get refined throughout M2–M5b as the convention is exercised, and are promoted to `docs/architecture docs/adrs/` at close-out. AC10 names the two that must exist by close-out: (a) the **3-layer polymorphic IR convention** ADR, and (b) the **architectural principles underwriting it** ADR (FR25). M1 drafts both — and any further ADRs the implementer surfaces as load-bearing while drafting (e.g. if the SPI aggregation strategy or the `__unspecified__` model warrants its own ADR rather than living inside one of the two named drafts). (Convention is to draft ADRs at close-out at a minimum; drafting earlier here is cheap insurance against losing context.)
- [ ] `pnpm lint:deps` passes; layering is enforced.

**Validation:** the framework + family compile in isolation. No consumers exist; correctness is verified by typecheck + layering rules, not behavioural tests.

### M2 — Mongo migration (first consumer of the foundation)

**Goal:** Mongo becomes the first family to commit to the foundation's SPI shape. SPI shape disagreements surface here, in a PR scoped to one family, where they can be resolved without simultaneously breaking SQL.

**Tasks:**

- [ ] Introduce `MongoTargetContractSerializer extends MongoContractSerializerBase` and `MongoTargetSchemaVerifier extends MongoSchemaVerifierBase` (concrete SPI implementers).
- [ ] Flip Mongo Contract IR (`MongoIndex`, `MongoIndexOptions`, `MongoCollationOptions`, etc.) from `type =` data shapes to AST classes that extend `SchemaNodeBase`, following the same recipe as Mongo's existing `MongoSchemaNode` AST.
- [ ] **Mongo namespace concretion.** Declare `class MongoTargetDatabase extends NamespaceBase` (Namespace = the connection's `db` field) and the singleton subclass `class MongoTargetUnspecifiedDatabase extends MongoTargetDatabase` with `id = '__unspecified__'`. The singleton overrides the qualifier-emission methods to elide the database name from any rendered output. The Mongo storage gets `namespaces: { __unspecified__: MongoTargetDatabase.unspecified, … }`. **Implementing Mongo namespace semantics in M2 (rather than in M5a) keeps all families aligned on the same Storage shape from the first consumer commit; bolting it on later would require reshaping `MongoStorage` after consumers had begun depending on its shape.**
- [ ] Extend the Mongo target descriptor type with `contractSerializer` + `schemaVerifier` named properties; the runtime Mongo descriptor composes the two implementers.
- [ ] Migrate Mongo's framework-internal call sites to `descriptor.contractSerializer.deserializeContract(json)` (Mongo-side share of the FR8 migration).
- [ ] Mongo unit + integration tests pass (`mongodb-memory-server`).
- [ ] If the SPI shape needs to flex to accommodate Mongo, the change lands in M1's interfaces — this is the cheapest moment to find such a need.

**Validation gate** (must all pass for SATISFIED):

- `pnpm typecheck` (workspace-wide; catches consumer breakage from any rename or SPI-base lowering).
- `pnpm lint:deps` (no new layering violations).
- `pnpm --filter '@prisma-next/mongo*' --filter '@prisma-next/family-mongo*' --filter '@prisma-next/mongo-target*' test` (Mongo unit tests across foundation, family, and target packages).
- `pnpm test:integration` (the only path that exercises `mongodb-memory-server`).
- Cross-package grep guard: after the IR class flip, grep the workspace for the deleted-or-renamed type names (`MongoIndex`, `MongoIndexOptions`, `MongoCollationOptions`, …) and confirm no consumer outside the Mongo packages still references the old shape.

(Workspace-wide `pnpm test:packages` is intentionally not in the gate. The pre-existing fragility recorded under § Open items doesn't touch Mongo, but `pnpm test:packages` would run those failures and produce noise the implementer would have to manually triage every round. The Mongo-scoped `--filter` set is the surface M2 actually changes.)

**Other validation:** Family/target boundary observable in code (see m1 R2 watch-points in `learnings.md` — particularly the lowering of `verifyCommonMongoSchema` + `parseMongoContractStructure` from abstract to concrete at the family layer).

### M3 — Postgres SPI shells + `validateContract` migration

**Goal:** Postgres adopts the foundation. The `validateContract` → SPI migration lands here, including the test-cost share (FR8 / AC12).

**Tasks:**

- [ ] Introduce `PostgresContractSerializer extends SqlContractSerializerBase` and `PostgresSchemaVerifier extends SqlSchemaVerifierBase`.
- [ ] Extend `SqlControlTargetDescriptor` (and any sibling descriptor types) with `contractSerializer` + `schemaVerifier` named properties; the runtime Postgres descriptor (`postgresControlTargetDescriptor` in `packages/3-targets/3-targets/postgres/src/exports/control.ts`) composes the two implementers next to its existing `migrations` property.
- [ ] Lift today's flat-data Postgres Contract IR to the AST-class hierarchy (`PostgresStorage`, `PostgresTable`, `PostgresColumn`, `PostgresForeignKey`, …) following the `OpFactoryCall` template; all node classes extend `SchemaNodeBase` and call `this.freeze()` in their constructors.
- [ ] Lift Postgres SQL Schema IR (introspection-side) to the same class-hierarchy shape.
- [ ] Migrate every `validateContract` call site to `descriptor.contractSerializer.deserializeContract(json)`. Remove the standalone `validateContract` function from public exports. The user-facing facade (`postgres<Contract>(...)`) wraps the SPI call so end-users do not see it.
- [ ] Migrate test suites: tests that exercise serialization import a real target descriptor; tests that don't use `createIdentityContractSerializer<TContract>()`.
- [ ] Apply the same SQLite-side IR-shape flip (no exemplars yet — just the structural lift); extend the SQLite descriptor with the two new SPI properties; migrate SQLite's `validateContract` call sites.
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

- [ ] **Pre-flight: audit PSL consumer cascade.** Before lowering the PSL grammar, enumerate everywhere the existing flat-model AST (`PslDocumentAst.models`, `PslDocumentAst.enums`, …) is consumed downstream — emitter passes, formatter, code-completion, validation, doc tooling. Confirm which consumers can ignore the new `PslDocumentAst.namespaces` field (because they already see models via the model accessors) and which need to be taught namespace-awareness. The audit's output is a small table that informs the milestone's task scope — and prevents shipping a grammar feature that silently breaks downstream tooling.
- [ ] Declare `interface Namespace extends SchemaNode` and `abstract class NamespaceBase implements Namespace` in the framework layer.
- [ ] Declare `class PostgresSchema extends NamespaceBase` (target layer); search-path semantics, owner role, SQL rendering as `"<schema>"`.
- [ ] Declare `class PostgresUnspecifiedSchema extends PostgresSchema` (singleton, `readonly id = '__unspecified__' as const`); overrides qualifier-emission methods to elide the `"<schema>".` prefix. Stable static reference `PostgresSchema.unspecified`. Same pattern for SQLite (`SqliteUnspecifiedDatabase`).
- [ ] Postgres storage gains `namespaces` keyed by namespace id, with `__unspecified__` mapped to `PostgresSchema.unspecified` by default. The Mongo equivalent landed in M2; no additional Mongo work in M5a.
- [ ] Re-key every storage object (table, enum, function, …) by `(namespace.id, name)` rather than `name` alone. Verifier walks two parallel trees of namespace-scoped objects. (FKs are still single-namespace at this milestone — M5b adds the cross-namespace FK shape.)
- [ ] Authoring DSL — TS builder: top-level `namespaces` declaration list + per-model `namespace` field; defaulting to `__unspecified__` when omitted (FR16a).
- [ ] Authoring DSL — PSL: top-level `namespace <name> { … }` blocks (reopenable; namespace blocks do not recursively nest; elements declared outside any block live in `__unspecified__`); the parser path lowers to the same Contract IR shape. AST changes: `PslDocumentAst.namespaces`, `PslField.typeNamespace?` (the latter consumed in M5b). The pre-flight audit drives which downstream tooling touchpoints land in this milestone.
- [ ] Multi-tenancy `__unspecified__` resolution end-to-end via connection `search_path` (AC6).
- [ ] Existing single-namespace contracts migrate mechanically: Postgres contracts default to `__unspecified__` (search_path resolves to `public` at the database level, matching today's behaviour); SQLite gets singleton; Mongo retains the database-as-namespace shape introduced in M2.

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
- [ ] Refine the ADR drafts started in M1 under `projects/target-extensible-ir/specs/`. AC10 names the two that must exist by close-out — the 3-layer polymorphic IR convention and the architectural principles underwriting it (FR25) — plus any further ADRs M1 surfaced as load-bearing. M6 brings them all to "ready to promote" state; the close-out step moves them to `docs/architecture docs/adrs/`.

**Validation:** docs reviewable as diffs; ADR drafts ready for promotion at close-out.

## Open items

> Items surfaced during execution that are out of scope for this PR but worth tracking. Reviewed at close-out.

- **Pre-existing test fragility surfaced during M1 R1 review.** Running `pnpm test:packages` against the M1 HEAD surfaced ~9 files / ~12 tests / ~8 unhandled errors across `@prisma-next/adapter-postgres` (Postgres connection flakiness in integration tests) and `@prisma-next/cli` (mock-setup issues). None touch M1-modified files; failures vary across runs (different packages failing in different runs), confirming flakiness rather than regression. Out of M1's `typecheck + lint:deps` validation gate. The Postgres adapter integration-test flakiness will likely resurface and may block M3 R1 if it persists; revisit at M3 entry. No Linear tickets filed yet (per orchestrator/user decision E2 in m1 R1 triage).

## Close-out (required)

- [ ] Verify all acceptance criteria in [`projects/target-extensible-ir/spec.md`](spec.md).
- [ ] Promote ADR drafts (3-layer IR convention; architectural principles) from `projects/target-extensible-ir/specs/` to `docs/architecture docs/adrs/`.
- [ ] Confirm `AGENTS.md` / `CLAUDE.md` Golden Rule is updated and `docs/reference/typescript-patterns.md` carries the new AST/IR section.
- [ ] Confirm `docs/Architecture Overview.md` § "Guiding Principles" surfaces "framework provides affordances; targets implement specifics" and "familiar with one target, fluent in another".
- [ ] Confirm subsystem docs in `docs/architecture docs/subsystems/` (Data Contract, Contract Emitter & Types, Adapters & Targets) reflect the class-hierarchy IR shape.
- [ ] Migrate any other long-lived docs into `docs/`.
- [ ] Strip repo-wide references to `projects/target-extensible-ir/**` (replace with canonical `docs/` links or remove).
- [ ] Delete `projects/target-extensible-ir/`.
