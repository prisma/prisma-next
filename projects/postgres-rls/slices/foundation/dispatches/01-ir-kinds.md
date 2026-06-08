# Dispatch D1 — IR kinds + entityTypes registration + `StorageTable.rls`

Slice `foundation` (TML-2868), dispatch 1 of 4. Implementer tier: sonnet.

## Task

Introduce the two Postgres-target-only RLS IR kinds and the table-level RLS toggle, reachable only through synthetic test fixtures (no authoring, no planner, no verifier). Make `PostgresRlsPolicy` and `PostgresRole` exist as frozen, JSON-canonical IR classes that register as Postgres entity kinds and land in `PostgresSchema.entries`, and give `StorageTable` an `rls` field.

**Follow the `PostgresEnumType` precedent exactly** — it is the existing target-only entity kind, and your job is to add two siblings shaped the same way. Grep it first (`PostgresEnumType`, `PostgresEnumStorageEntry`, `postgresAuthoringEntityTypes`, `PostgresSchema`) and mirror its base class, `freezeNode(this)` constructor call, JSON-canonical readonly-field discipline, `kind` discriminant, and `entityTypes` registration.

## Surfaces (confirm by grep; paths from the reconciliation doc)

- `packages/3-targets/3-targets/postgres/src/core/postgres-schema.ts` — `PostgresSchema.entries` (currently `{ table, type }`); add `role` and `rlsPolicy` slots.
- `packages/3-targets/3-targets/postgres/src/core/authoring.ts` — `postgresAuthoringEntityTypes`; register the two new entity kinds (discriminators e.g. `'postgres-role'`, `'postgres-rls-policy'`) so they flow into `entries`.
- `packages/3-targets/3-targets/postgres/src/core/` — new class files for `PostgresRlsPolicy` and `PostgresRole` (mirror where `PostgresEnumType` lives).
- `packages/2-sql/1-core/contract/src/ir/storage-table.ts` — add `rls: 'auto' | 'enabled' | 'disabled'` as an own optional-ish field defaulting to `'auto'`, **absent-when-default** so it never serializes when equal to the default (mirror the existing `control?: ControlPolicy` field's discipline on this same class).

## Field shapes (from the slice spec)

- `PostgresRlsPolicy`: `kind`; `name` (full wire name `<prefix>_<8hex>` — just a stored string here, no hashing in this dispatch); `prefix`; `tableName`; `operation` (`'select'|'insert'|'update'|'delete'|'all'`); `roles: readonly string[]` (sorted role names — plain strings in this slice); `using?: string`; `withCheck?: string`; `permissive: boolean`.
- `PostgresRole`: `kind`; `name`; namespace coordinate (use the `UNBOUND_NAMESPACE_ID` / `__unbound__` singleton pattern the codebase already has — grep `UNBOUND_NAMESPACE_ID`). No role attributes.

## Completed when

- [ ] `PostgresRlsPolicy` and `PostgresRole` classes exist, extend the same base as `PostgresEnumType`, call `freezeNode(this)`, carry a `kind` discriminant, and are registered via `postgresAuthoringEntityTypes`.
- [ ] `PostgresSchema.entries` has `role` and `rlsPolicy` slots populated through the entity-kind registration; `StorageTable` has the `rls` field (default `'auto'`, absent-when-default).
- [ ] A synthetic-fixture test constructs frozen instances of both classes and a `StorageTable` with `rls`, and asserts immutability (mutation throws / is a no-op per the freeze discipline).
- [ ] Gates green: `cd packages/3-targets/3-targets/postgres && pnpm typecheck`; `pnpm --filter <postgres-pkg> test` (new fixtures); `pnpm lint:deps`.

## Halt conditions (surface, do not improvise)

- The `PostgresEnumType` precedent diverges from this brief's assumptions (e.g. enum entities are NOT registered via `entityTypes`, or `entries` is shaped differently than the reconciliation says) — **stop and report** what you found rather than inventing a new pattern.
- Adding the `role`/`rlsPolicy` `entries` slots forces touching the serializer or any consumer that exhaustively walks `entries` — that is D3's job; if a type error pushes you toward the serializer, note it and stop (a minimal "slot exists, empty by default" change is in scope; serializing populated slots is D3).
- Anything requires a normalizer/hash (`canonicalize.ts`), the authoring helper, a planner op, or a `SchemaIssue` change — **out of scope** (D2/D4/later slices). The `name` field is a plain stored string in this dispatch.

## Scope discipline

Stay focused on the goal; control scope. Trivial-and-related fixes that serve the goal go in this dispatch with a one-line note. Drift from the goal halts. Commit this dispatch's work on the current branch with a `tml-2868:` prefixed message; side-quests get their own commit.

## References

- Slice spec: `projects/postgres-rls/slices/foundation/spec.md` (chosen design + edge cases).
- Reconciliation (real file paths + the landed-code map): `projects/postgres-rls/specs/reconciliation-2026-06-08.md`.
- Heartbeat: write progress to `wip/heartbeats/implementer.txt` per the implementer persona contract.
