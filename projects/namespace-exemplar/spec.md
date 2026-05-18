# Namespace Exemplar — Spec

Refs [TML-2520](https://linear.app/prisma-company/issue/TML-2520). Supersedes the namespace work originally scoped as PR2 of the [target-extensible-ir](../target-extensible-ir/spec.md) project.

## Summary

Ship **Namespace as a first-class IR container** end-to-end in a single PR: every storage object (table, type, function, …) lives **inside** a `Namespace` instance, and `Storage` is a map of namespaces. Postgres concretises Namespace as `PostgresSchema` with a `PostgresUnboundSchema` singleton for connection-bound late binding; SQLite and Mongo each ship a single concretion mapped to their respective binding semantics. PSL gains `namespace <name> { … }` blocks; the TS builder gains a `namespaces` declaration list and per-model `namespace` field. Cross-namespace foreign keys are first-class — PSL uses dot-qualified type references in `@relation`, the TS builder propagates namespace coordinates automatically through model handles, the planner emits qualified DDL, and the verifier dispatches FK matches on `(namespace_id, table_name)`.

## Context

### What PR1 of the parent project shipped

The [target-extensible-ir PR1](../target-extensible-ir/spec.md) shipped the IR class-hierarchy substrate (framework interface → family abstract → target concrete), the enum exemplar as proof, and the `entityTypes` pack-contribution mechanism. PR1 left the `SqlStorage.namespaces` map populated with a default `__unbound__` singleton (`SqlUnboundNamespace.instance`) as a family-layer placeholder, with the per-target Namespace concretions deferred to this PR.

### Why a fresh project (not a continuation of target-extensible-ir/spec.md)

The original PR2 work entered a 3-PR project umbrella with 13 acceptance criteria, ~600 lines of cross-referencing prose, and an internally inconsistent FR15 that mandated `tables: Record<NamespaceId, Record<TableName, StorageTable>>` while FR13 simultaneously mandated `Storage { namespaces: Record<string, Namespace> }`. The implementation followed FR15, producing a Storage shape where the `namespaces` field is a degenerate label registry and the actual contents live in sibling slot maps (`tables`, `types`, …) keyed *also* by namespace id. The mistake didn't surface until 110 commits and ~20K LoC of consumer migration were on the branch — at which point unwinding became more expensive than starting fresh.

This spec replaces that scope with a focused, self-consistent description of a single deliverable: **the namespace exemplar with the correct shape, taken in one pass.** The acceptance criteria are six, not thirteen. There is no two-PR split inside this project. There is no parallel "M5c substrate sweep" because the substrate ships correct on first commit.

### What this PR delivers

A single PR that:

1. Makes `Namespace` a real polymorphic container (its `tables`, `types`, and target-specific slots live as fields on the Namespace instance).
2. Ships PostgresSchema + PostgresUnboundSchema + SqliteUnboundDatabase + MongoTargetUnboundDatabase concretions.
3. Lifts the `namespace { … }` PSL block into the framework parser (per-target interpreter validates whether the target supports it).
4. Lifts the TS builder `namespaces` declaration + per-model `namespace` field into the SQL DSL.
5. Restructures `ForeignKey` IR to `{ source, target }` and renames `ForeignKeyReferences` → `ForeignKeyReference` (singular).
6. Implements cross-namespace foreign keys end-to-end (PSL lowering, TS builder lowering, planner DDL, verifier dispatch).
7. Demonstrates the feature live with a 2-namespace `prisma-next-demo` (User in `auth`, Post/Task in `public`, cross-namespace FK) and a multi-tenancy AC integration test (Postgres `namespace unbound { … }` + `search_path`).

## At a glance

### Storage shape (canonical, in both `contract.json` and the generated `contract.d.ts`)

```jsonc
{
  "target": "postgres",
  "storage": {
    "namespaces": {
      "public": {
        "id": "public",
        "kind": "postgres-schema",
        "tables": {
          "post": {
            "columns": { "id": { … }, "user_id": { … } },
            "primaryKey": { "columns": ["id"] },
            "foreignKeys": [
              {
                "source": { "columns": ["user_id"] },
                "target": { "namespaceId": "auth", "tableName": "user", "columns": ["id"] },
                "onDelete": "restrict"
              }
            ]
          }
        },
        "types": {}
      },
      "auth": {
        "id": "auth",
        "kind": "postgres-schema",
        "tables": {
          "user": { "columns": { "id": { … }, "email": { … } }, "primaryKey": { "columns": ["id"] } }
        },
        "types": {}
      }
    },
    "storageHash": "sha256:…"
  }
}
```

The framework promise: `Storage { namespaces: Record<NamespaceId, Namespace>, storageHash: …, … }`. Each `Namespace` carries `tables`, `types`, and any target-specific slots its target defines. There is exactly one source of truth for "what's in namespace X": `storage.namespaces[X]`.

### PSL surface

```prisma
namespace auth {
  model User {
    id    String @id @default(uuid())
    email String
    posts public.Post[]
  }
}

namespace public {
  model Post {
    id     String    @id @default(uuid())
    userId String
    user   auth.User @relation(fields: [userId], references: [id])
  }
}

// Backwards-compatible: top-level models without a namespace block stay valid
// and lower (per target) to that target's default slot.
model LegacyThing { id Int @id }
```

### TS builder surface

```ts
defineContract({
  namespaces: ['public', 'auth'],
  models: {
    User: model('User', { namespace: 'auth', fields: { id, email } }),
    Post: model('Post', {
      namespace: 'public',
      fields: { id, userId },
      relations: ({ rel }) => ({ user: rel.belongsTo(User, { fields: [userId], references: [User.refs.id] }) }),
    }),
  },
});
```

The model handle returned by `model(…)` carries its namespace coordinate, so `User.refs.id` already knows it lives in `auth` — `rel.belongsTo` and `constraints.foreignKey` lower to cross-namespace IR automatically with no new syntax.

## Decisions

These are the load-bearing decisions for this PR. Anything not on this list is out of scope (see Non-goals).

- **D1. Namespace is a real container.** Tables, types, and any target-specific slot kinds live as fields on the `Namespace` instance, not as sibling fields on `Storage`. `Storage` is `{ namespaces, storageHash, … }` and nothing more at the slot-kind level. This forecloses the dual-source-of-truth failure mode that doomed the previous attempt — the value at `storage.namespaces[X]` is the *only* place anything in namespace X is recorded.

- **D2. `__unbound__` is a per-target singleton subclass.** Each target that ships Namespace also ships exactly one singleton subclass for the late-bound slot: `PostgresUnboundSchema extends PostgresSchema` (qualifier-eliding DDL emission), `SqliteUnboundDatabase extends SqliteDatabase` (trivial singleton — SQLite has only one database), `MongoTargetUnboundDatabase extends MongoTargetDatabase` (connection-`db` binding). Accessed via a stable static reference (`PostgresSchema.unbound`, etc.). Call sites stay polymorphic — no `if (namespace.id === '__unbound__')` branches anywhere.

- **D3. Cross-namespace FK syntax: PSL uses dot-qualified type references; TS builder uses model handles unchanged.** PSL: `user auth.User @relation(fields: [userId], references: [id])`. The `@relation` attribute is unchanged; the parser knows which model the columns belong to from the type position. TS builder: the model handle returned by `model(…)` carries the namespace coordinate, so existing `rel.belongsTo(OtherModel, …)` and `constraints.foreignKey(cols.x, OtherModel.refs.y, …)` call sites lower to cross-namespace IR automatically when the referenced model lives in a different namespace.

- **D4. `ForeignKey` IR shape: `{ source, target }`.** Source = `{ columns: TableName[] }` (the local columns; the source table is implicit — it's the table the FK lives on). Target = `{ namespaceId, tableName, columns }` (always present, never optional; the namespace is a coordinate, not an annotation). Renames the misnamed plural `ForeignKeyReferences` → singular `ForeignKeyReference`. Verifier dispatches FK matches on `(namespaceId, tableName)` rather than just `tableName`.

- **D5. Per-target acceptance of `namespace { … }` PSL blocks.** Postgres: accepts named namespaces, accepts explicit `namespace unbound { … }`, **rejects** user-declared `namespace unbound { … }` whose contents collide with a separate IR `public` namespace (the framework constant `UNBOUND_NAMESPACE_ID = '__unbound__'` is reserved). SQLite and Mongo: reject all explicit `namespace { … }` blocks today with a target-flavoured diagnostic. Implicit (top-level, no block) declarations are accepted by every target and lower to that target's default slot (Postgres → `public`; SQLite → its singleton; Mongo → connection-`db`).

- **D6. `__unspecified__` PSL AST identifier ≠ `__unbound__` IR sentinel.** PSL parser collects top-level declarations into `PslNamespace { name: '__unspecified__', … }` (syntactic absence — what the parser sees when the user wrote no block). IR uses `__unbound__` (semantic — "the connection resolves this at runtime"). Per-target interpreters bridge between the two. The two spellings are deliberate.

## Functional requirements

- **FR1. Storage shape.** `interface Storage extends IRNode { readonly namespaces: Record<NamespaceId, Namespace>; readonly storageHash: StorageHashBase<...>; … }`. Per family: `abstract class SqlStorage extends SqlNode implements Storage` carries the same shape; per target: `class PostgresStorage extends SqlStorage` (if target-specific Storage state earns a subclass) or the target consumes `SqlStorage` directly. **There is no `tables` field on `Storage`** — that surface lives one level deeper, on each `Namespace`.

- **FR2. Namespace shape.** `interface Namespace extends IRNode { readonly id: NamespaceId; readonly tables: Record<TableName, StorageTable>; readonly types: Record<TypeName, StorageType>; … }`. Target concretions extend this with target-specific slot kinds (Postgres may add `functions`, `sequences`, `views` in follow-on work — out of scope here, but the shape admits them without churn). The Namespace subclass IS the container; the namespace's id appears once, on the Namespace value, not duplicated as a stamp on every contained Table/Type.

- **FR3. PSL parser.** `PslDocumentAst` carries `namespaces: readonly PslNamespace[]` as the *only* models container. Top-level declarations (no enclosing `namespace { … }` block) are collected into an implicit `PslNamespace { name: '__unspecified__', … }`. Nested `namespace a { namespace b { … } }` is a parse error (database namespaces are flat). Multiple `namespace foo { … }` blocks for the same name merge into one logical entry. `types { … }` blocks remain document-scoped and may not appear inside a `namespace { … }` block.

- **FR4. Per-target PSL → IR lowering.** Each target's PSL interpreter maps `PslDocumentAst.namespaces` to its IR slots per its semantics:
  - **Postgres.** Implicit `__unspecified__` → IR `public` slot (single-tenant default, backward compatible). Explicit `namespace unbound { … }` → IR `__unbound__` slot (`search_path` resolution). Named blocks (`auth`, `foo`, …) → IR named schemas (`PostgresSchema` instances). Rejects user-declared `namespace unbound` whose use semantically collides with a sibling `namespace public`.
  - **SQLite.** Accepts only the implicit `__unspecified__` entry → IR singleton slot. Rejects all explicit `namespace { … }` blocks with diagnostic "SQLite does not support namespace blocks".
  - **Mongo.** Same as SQLite; diagnostic is Mongo-flavoured.

- **FR5. TS builder surface.** `defineContract(config)` accepts `config.namespaces?: readonly string[]` declaring the namespaces this contract owns (defaulting to the implicit AST bucket when omitted, preserving single-tenant authoring). `model(name, config)` accepts `config.namespace?: string` naming one of the declared namespaces. The returned model handle (`.refs.<field>`, etc.) carries its namespace coordinate so downstream FK lowering needs no syntax change.

- **FR6. `ForeignKey` IR.** `interface ForeignKey { source: ForeignKeyReference; target: ForeignKeyReference; … }`; `interface ForeignKeyReference { namespaceId: NamespaceId; tableName: TableName; columns: readonly ColumnName[] }`. Both source and target carry their namespace coordinate — for an FK declared on table `(public, post)` referencing `(auth, user)`, source is `{ namespaceId: 'public', tableName: 'post', columns: ['user_id'] }`, target is `{ namespaceId: 'auth', tableName: 'user', columns: ['id'] }`. **`namespaceId` is required**, never optional — the namespace is part of the FK's identity, not an annotation.

- **FR7. Serializer round-trip.** Each family's `ContractSerializer` (`SqlContractSerializerBase`, `MongoContractSerializerBase`) round-trips the new shape: `deserializeContract(JSON.parse(JSON.stringify(serializeContract(contract))))` yields a structurally equivalent class hierarchy. `JSON.stringify` over the class instance produces the same canonical JSON shape as `serializeContract`. The shape is the same in JSON and in memory — no transitional dual-shape view, no helper that "flattens" or "nests" between them.

- **FR8. Emitter.** `prisma-next contract emit` generates `contract.d.ts` with literal types matching the runtime IR exactly: `{ readonly storage: { readonly namespaces: { readonly auth: { readonly tables: { readonly user: { … } } }, readonly public: { … } } } }`. No `FlatTablesOf<C>` bridge — the DSL surface uses the namespace-keyed shape directly. (Namespace-aware DSL ergonomics — `db.auth.user.create(…)` style — are TML-2550, out of scope here. Within scope: the DSL surface accepts the new shape without a transitional bridge type.)

- **FR9. DDL emission (Postgres).** Named-schema namespaces emit qualified DDL: `CREATE TABLE "auth"."user" (…)`, `ALTER TABLE "public"."post" ADD CONSTRAINT … REFERENCES "auth"."user"("id")`. The IR `__unbound__` slot (`PostgresUnboundSchema`) emits unqualified DDL: `CREATE TABLE "user" (…)`, `REFERENCES "user"("id")`. `CREATE SCHEMA "auth"` is emitted as a planner-step when the contract introduces a new named namespace that isn't already in the introspected schema.

- **FR10. Backward compatibility — single-tenant contracts unchanged.** A contract with top-level models and no `namespace { … }` blocks lowers (in Postgres) to the IR `public` slot, emits qualified DDL the same way as a contract that explicitly declared `namespace public { … }`, and exhibits no behavioural difference from how single-namespace contracts behave today. Existing demos that don't use namespaces continue to compile, emit, verify, and pass tests.

## Acceptance criteria

- [ ] **AC1. Two-namespace Postgres contract end-to-end.** A Postgres contract declares `namespaces: ['public', 'auth']` with User in `auth` and Post + Task in `public`. Emitter generates `contract.{json,d.ts}` with the canonical shape (`storage.namespaces.auth.tables.user`). Planner emits `CREATE SCHEMA "auth"`, then `CREATE TABLE "auth"."user" (…)`, then `CREATE TABLE "public"."post" (…)`, then `ALTER TABLE "public"."post" ADD CONSTRAINT … REFERENCES "auth"."user"("id")`. Verification against a live database with both schemas + the FK passes. Tested via PGlite in `examples/prisma-next-demo` and a matching integration test.

- [ ] **AC2. TS builder + PSL round-trip parity for namespaces.** Authoring the same 2-namespace contract via PSL and via TS builder produces structurally equivalent `Contract` IR (same `storage.namespaces` keys, same per-namespace `tables` keys, same per-table column shapes, same FK source/target). Tested via a parity test (`psl-ts-namespace-parity.test.ts`).

- [ ] **AC3. SQLite + Mongo reject explicit namespace blocks.** Authoring `namespace foo { model X { … } }` in a SQLite or Mongo PSL contract fails interpretation with a diagnostic naming the target and pointing at the offending block span. Implicit (top-level, no block) declarations continue to work.

- [ ] **AC4. Postgres reserves user-declared `unbound`.** Authoring `namespace unbound { … }` in a Postgres PSL contract that also declares a sibling `namespace public { … }` fails interpretation with a diagnostic explaining that `unbound` is reserved for the late-binding sentinel mapping and naming the offending block span.

- [ ] **AC5. Multi-tenancy via `namespace unbound { … }`.** A Postgres contract declares `namespace unbound { … }` and emits unqualified DDL. A live PGlite test sets `search_path` to a per-tenant schema, runs the contract's migration plan against it, and verifies that tables are created in the tenant schema and FKs resolve correctly. Single-tenant Postgres contracts (top-level models, no `unbound` block) continue to lower to `public` and emit qualified DDL — verified separately.

- [ ] **AC6. All in-repo demos + extensions emit cleanly.** `pnpm fixtures:check` exits 0 (no diff after `fixtures:emit`). Every example app's `contract.d.ts` reflects the canonical shape. `examples/multi-extension-monorepo`'s aggregate `build:contract-spaces` succeeds end-to-end and produces a namespace-keyed app contract.

## Non-goals (explicit)

- **Namespace-aware DSL surface** ([TML-2550](https://linear.app/prisma-company/issue/TML-2550)). The query DSL today is `db.<tableName>.find(…)` — flat by table name. With namespaces, two tables can share a name across namespaces (`auth.user`, `tenant1.user`). The right answer is `db.auth.user.find(…)` style or some equivalent — but the design space is large (default-namespace policy, collision handling, implicit-unbound shortcut, …) and the in-repo demos don't currently hit any name collisions. Deferred to TML-2550. **This PR's scope:** the DSL surface continues to work with no collisions in the current demos. If a demo ever introduces a name collision, the existing flat DSL produces a clear type error; that's the trigger to land TML-2550.

- **Target-contributed top-level PSL blocks** ([TML-2537](https://linear.app/prisma-company/issue/TML-2537)). PR3 of the original umbrella, still alive as a separate ticket. `namespace` stays a framework-level keyword in this PR (the parser accepts it regardless of target; the per-target interpreter decides whether to lower or reject).

- **Cross-contract-space FK references.** Foreign keys spanning contract spaces are a separate problem (different contracts, different versioning, different lifecycle). Out of scope; deferred to a separate ticket.

- **Postgres-domain entities** (RLS policies, roles, views, functions). Real-world consumers of the namespace mechanism but explicitly deferred — they ship in their own projects on the namespace foundation this PR lays.

- **Mongo multi-database namespaces.** Mongo could plausibly grow multi-database semantics in the future; today's Mongo target rejects explicit `namespace { … }` blocks. Out of scope; admitted to the roadmap when a use case demands it.

## Non-functional constraints

- **No transitional dual-shape phase.** The new shape ships in one pass. There is no `tablesByNamespace` helper, no `nestedTablesView` blind-cast, no `FlatTablesOf<C>` bridge, no period where flat and nested shapes coexist. Either the substrate is on the new shape or it's not.

- **No `as unknown as` casts** in any IR or serializer code. If the types don't line up, the types are wrong — not the casts. (Test fixtures may use narrowly-scoped casts where TypeScript's structural inference is genuinely too weak, but only with an explicit comment naming the gap; no silent smuggling.)

- **No `if (kind === '<literal>')` branches** in framework or family code. Per-kind dispatch goes through the polymorphic class hierarchy (overridden methods on the IR class) or through the discriminator-registry pattern (FR8e of the parent project, family-shared). Target code may freely switch on its own target-specific kinds; framework/family code may not.

- **No biome/lint suppressions, no `@ts-expect-error` outside negative type tests, no `@ts-nocheck`.**

- **No FR-shape drift inside the spec.** If a later edit to this spec touches the storage shape (FR1/FR2), the change is mirrored in the At-a-glance JSON sample and in any AC text that names the shape. If a contradiction appears between two spec sections, the spec edit is wrong — fix the spec, don't ship contradictory text and let the implementation pick one. (Calibration entry from the prior attempt: agent-introduced concrete type expressions must be diff'd against sibling FR text in the same document; FR15 contradicting FR13 is the failure mode this constraint exists to prevent.)

## Open questions

None at spec-write time. If implementation surfaces a design question, stop and add it here; do not silently pick a direction.

## Failure modes the previous attempt taught us

These are documented in [`plan.md`](./plan.md) (§ Calibration backlog), to be filed into the agile-agent-orchestration project at close-out. Summary:

1. **Concrete type expressions in spec contradicting prose.** FR15 (`tables: Record<NamespaceId, Record<TableName, StorageTable>>`) contradicted FR13 (`Storage { namespaces: Record<string, Namespace> }`); the agent transcribing the design decision didn't diff the new FR against existing FRs. Spec rewrite uses one type story consistently.
2. **Dual-shape transitional helpers.** `tablesByNamespace`, `nestedTablesView`, `FlatTablesOf<C>` — every intermediate helper added new failure modes (which view is canonical? which view does the JSON envelope match? which view does the verifier walk?). Banned in this PR.
3. **Optional `namespaceId` (F01).** The original spec made `namespaceId` optional, which let the verifier's FK comparator silently pass mismatches. `namespaceId` is required end-to-end in this spec.
4. **Wide-scope substrate dispatches.** The M5c "kill dual-shape" dispatch touched 35 files in one commit; the implementer drifted into adjacent fixes. This plan sizes dispatches at M (≤30 min) and explicitly enumerates what each dispatch may and may not touch.
5. **Spec internal inconsistency surviving review.** No review process caught FR15 vs FR13. The orchestrator now diffs each spec edit against sibling text and adds a "consistency check" step before any dispatch starts (DoR gate).
