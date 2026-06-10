# Brief — open the namespace `entries` dictionary (ADR 224/225 compliance)

**Audience:** an implementing agent with no prior context, working against `main`.
**Deliverable:** one PR against `main`. No RLS code is involved — this is a substrate refactor of code already on `main`.

## Mission

Bring the namespace `entries` implementation into compliance with two accepted ADRs it currently violates:

- `docs/architecture docs/adrs/ADR 224 - Namespace concretions address entities by coordinate.md`
- `docs/architecture docs/adrs/ADR 225 - Three-layer extensibility for pack-contributed entity kinds.md`

Read both in full before writing code. ADR 224 is the spec for this work; treat it as authoritative over any existing code it contradicts.

The mandated model, in one sentence: **`entries` is an open dictionary keyed by entity kind — `entries[node.kind][entityName]` resolves any entity, built-in or pack-contributed, with no translation table and no per-kind framework knowledge.**

## The one-string rule (operator decision, 2026-06-10)

There is exactly **one** identifying string per entity kind. The node class's `kind` literal, the authoring contribution's routing key (ADR 225 calls it `discriminator` — same concept, same string), the entity coordinate's `entityKind`, and the `entries` slot key are **the same string**. It just has to be unique; nothing else about its shape matters. Any mechanism that maps between a "kind" and a "slot name" (stemming, pluralizing, prefix-stripping, lookup fields) is forbidden — that is the exact consumer-side translation table ADR 224 rejects.

## Current violations (file:line, verified 2026-06-10)

1. **Closed `entries` types.** ADR 224 (§Decision, and the "enforced by construction" paragraph) requires `entries: Readonly<Record<string, Readonly<Record<string, unknown>>>>`. Instead, these declare closed objects with named fields:
   - `packages/2-sql/1-core/contract/src/ir/sql-storage.ts` ~23-38 (`SqlNamespaceTablesInput.entries`: `table`, `valueSet?`) and ~73-77 (`SqlNamespace.entries`)
   - `packages/2-sql/1-core/contract/src/ir/sql-unbound-namespace.ts` ~43-45
   - `packages/2-sql/1-core/contract/src/ir/build-sql-namespace.ts` ~30-33
   - `packages/3-targets/3-targets/postgres/src/core/postgres-schema.ts` ~18-26, ~54-59 (`table`, `type`)
   - `packages/3-targets/3-targets/sqlite/src/core/sqlite-unbound-database.ts` ~55-61
   - `packages/3-mongo-target/1-mongo-target/src/core/mongo-target-database.ts` ~8-13, ~32-34 (`collection`)
2. **Slot key ≠ node kind.** ADR 224 mandates "the kind *is* the property name." Today: slot `type` holds nodes with `kind: 'postgres-enum'`; slot `valueSet` holds `kind: 'value-set'`; slot `collection` holds `kind: 'mongo-collection'`. (Slot `table` holds `StorageTable`, which has no kind literal at all.)
3. **Hardcoded per-slot schema wiring.** `packages/2-sql/1-core/contract/src/validators.ts` ~252-335: `slotMapSchema(...)` / `createNamespaceEntrySchema(...)` hardcode the slot set (`table?`, `type?`, `valueSet?`, plus dynamically appended pack slots). ADR 224's open model needs validation dispatched by kind, not by a hardcoded slot list.

(Context, not in scope here: a feature branch added `extensionEntities` + `entrySlotName` to smuggle pack-contributed kinds past the closed type — direct consequences of these violations. They live only on that branch; once this refactor lands on `main`, that branch rebases and deletes them. Do not try to fix that branch.)

## The reference implementation — copy this pattern

`packages/1-framework/1-core/framework-components/src/control/psl-ast.ts` ~230-280, `PslNamespaceNode` + `makePslNamespace`. It is already ADR-224-shaped:

- `entries: Readonly<Record<string, Readonly<Record<string, PslNamespaceEntry>>>>` — open, kind-keyed.
- Typed convenience views are **prototype getters** (`get models()`, `get enums()`), non-enumerable by construction, deriving from `entries` via `blindCast<T, 'entries[model] holds only PslModel by construction'>` — so spreading/`JSON.stringify` copies only `entries`, never a duplicate view.
- `Object.freeze(this)` in the constructor; ADR 224 additionally requires freezing the outer `entries` object and each inner per-kind map.
- A single factory (`makePslNamespace`) enforces construction discipline.

## Tasks

### 1. Open the `entries` types

Re-type every namespace/schema `entries` listed in Violation 1 as the open kind-keyed dictionary. Keep the strong per-kind typing as **non-enumerable prototype getters** on the concretion classes, mirroring `PslNamespaceNode` exactly:

- `SqlNamespace` / `PostgresSchema`: `get table(): Readonly<Record<string, StorageTable>>` (keep returning the name-keyed map — do NOT change call-site shape; `ns.entries.table['user']` becomes `ns.table['user']` or stays as a raw `entries['table']` read, see Task 4), plus `type`, `valueSet` getters; Mongo: `collection`; etc. Match existing call-site expectations when choosing getter return shapes (map vs array) — inventory the call sites first.
- Freeze `entries` (outer + each inner map) at construction, per ADR 224.
- Inputs (`SqlNamespaceTablesInput`, `PostgresSchemaInput`, `MongoTargetDatabaseInput`) follow the same opening: `entries: Readonly<Record<string, Readonly<Record<string, <family entity input union or unknown>>>>>`. Builders/factories (`build-sql-namespace.ts`, `postgresCreateNamespace`, the Mongo factory) consume the open dict and construct per-kind instances by dispatching on the **kind key**, not on hardcoded field names.

### 2. Align node `kind` literals with the entries keys (the one-string rule)

To keep the persisted `contract.json` shape and `storageHash` byte-stable (ADR 224: "the persisted shape is fixed by hashing — this is the long-term shape"), **adopt the existing entries keys as the canonical kind strings** and change the node literals to match:

- `PostgresEnumType.kind`: `'postgres-enum'` → `'type'`
- `StorageValueSet.kind`: `'value-set'` → `'valueSet'`
- `MongoCollection.kind`: `'mongo-collection'` → `'collection'`
- `StorageTable`: give it `kind = 'table'` if absent (non-enumerable, per the frozen-node pattern), or document why it stays structural.

Update every site that matches on the old literals (serializer dispatch, validators' fragment maps, any switch/guards — grep for each old string). These literals are in-memory discriminators; the wire format does not carry them in the entries path, so no fixture churn. If you find a place where the old literal IS persisted (e.g. inside a serialized node body), stop and surface it rather than silently changing wire bytes.

Where authoring contributions exist for these kinds (e.g. the Postgres enum's `entityTypes` entry with `discriminator: 'postgres-enum'` in `packages/3-targets/3-targets/postgres/src/core/authoring.ts` ~127), the contribution's routing key changes to the same string (`'type'`). One string, everywhere.

### 3. Kind→schema registry for validation/deserialization

Replace the hardcoded slot wiring in `validators.ts` (`slotMapSchema`, the literal `table?`/`type?`/`valueSet?` fields, and the dynamically-appended pack slots) with a **kind→schema registry**: validation walks `Object.entries(entries)` and validates each inner map's values against the schema registered for that kind; unknown kinds are an error naming the kind (fail closed — never silently accept or drop). The registry is populated from the family's built-ins plus target/pack contributions (the same `entityTypes` contributions that already carry `validatorSchema` — see `postgres-contract-serializer.ts` ~46-71 for the current fragment collection to replace). The deserialize/reviver path dispatches to the IR class factory by the same kind key.

Note the repo rule `prefer-assertions-over-defensive-checks` — validate at the JSON boundary (deserialization), don't re-validate internally-constructed instances.

### 4. Migrate call sites

~150 production + ~170 test call sites read `entries.<slot>` today (dominant: `.entries.table` ~194 across prod+test; then `.collection`, `.valueSet`, `.type`). With the getters named identically to the keys, most reads keep working with at most a mechanical change. Choose ONE canonical read style and apply it consistently:
- generic/walker code: `entries[kind][name]` (the coordinate path), and
- typed target/family code: the class getters.

Do not leave a third style. `packages/1-framework/1-core/framework-components/src/ir/storage.ts` (`elementCoordinates`) already walks `Object.entries(entries)` structurally — it should need no change; treat it as the consumer the refactor must keep working unchanged.

## Non-goals (do not do these)

- Anything RLS. No `rlsPolicy`/`role` slots, no `extensionEntities`/`entrySlotName` deletion — those live on the feature branch, which rebases onto this work afterwards.
- The migration planner. Untouched.
- Renaming persisted wire keys (`entries.table` etc. stay as-is — that's the point of Task 2's direction).
- New "slot"/"slot map" vocabulary anywhere. The concept is *entity kind*; the container is `entries`. If you find yourself writing `slot`, stop.

## Acceptance criteria (operator-observable)

1. Every namespace/schema `entries` type in Violation 1 is the open `Record<kind, Record<name, entity>>`; typed access is via non-enumerable getters; `JSON.stringify(namespace)` emits only `entries` (no duplicated views) — proven by an exact-shape serialization test.
2. `node.kind === <its entries key>` for every entity kind (one-string rule) — proven by a test that walks a representative contract's `entries` and asserts `entries[k][n].kind === k` for nodes that carry a kind.
3. Validation/deserialization dispatches by kind via the registry; an entries map with an unregistered kind fails validation with an error naming the kind — proven by a negative test.
4. Wire stability: `pnpm fixtures:check` clean (no committed `contract.json`/`storageHash` changes); the contract round-trip (serialize → JSON → deserialize) tests pass unchanged.
5. Whole-workspace gates green: `pnpm build`, `pnpm typecheck` (workspace — must be 138/138-equivalent), `pnpm test:packages`, `pnpm test:integration`, `pnpm lint:deps`, `pnpm fixtures:check`.

## Constraints (repo golden rules — non-negotiable)

- Tests before implementation. No `any`; no bare `as` in production (`blindCast<T,'reason'>`/`castAs` from `@prisma-next/utils/casts`; the getter casts follow the `PslNamespaceNode` precedent verbatim). Never `@ts-expect-error`/`@ts-nocheck`. Arktype, not zod. `pnpm`, never npm/npx. Don't branch on target — dispatch structurally by kind. Run `pnpm lint:deps` and fix violations, never bypass.
- Read `CLAUDE.md` + `.agents/rules/README.md` before starting; the patterns referenced by ADR 225 (`three-layer-polymorphic-ir.md`, `frozen-class-ast.md`, `json-canonical-class-in-memory.md` under `docs/architecture docs/patterns/`) govern the IR classes you touch.
- Update the docs that describe the closed shape if any exist (grep `docs/` for `entries.table`-style examples; keep ADR 224 as-is — the code is moving to it, not vice versa).

## Suggested sequencing (budget-aware: keep each step independently green + committable)

1. Read ADRs + inventory call sites (no code).
2. Task 2 (kind-literal alignment) — small, mechanical, independently shippable.
3. Task 1 on the SQL family core (`sql-storage.ts`, `build-sql-namespace.ts`, unbound) + Postgres schema class + getters; fix call sites as they break.
4. Task 3 (registry) + serializer dispatch.
5. SQLite + Mongo concretions.
6. Full gates; exact-shape + one-string + negative-kind tests.
