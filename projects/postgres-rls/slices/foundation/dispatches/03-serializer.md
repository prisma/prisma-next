# Dispatch D3 — serializer round-trip + validator schemas

Slice `foundation` (TML-2868), dispatch 3 of 4. Implementer tier: sonnet. Builds on D1's IR classes + `entries` slots. Depends on the built types (node_modules + dist already present).

## Task

Extend `PostgresContractSerializer` so the new `role` and `rlsPolicy` `entries` slots and `StorageTable.rls` round-trip through `contract.json` (serialize → deserialize) to structurally-identical frozen instances, preserving the `prefix` vs full-`name` asymmetry on policies. **Also add arktype `validatorSchema`s for the `postgres-role` and `postgres-rls-policy` entity kinds** (closing the D1 carry-forward — see § Validator-schema decision). Add a round-trip property test over a representative spread of policies + roles.

## Surface map (confirmed by recon — confirm by grep, paths are real)

- **Serializer:** `packages/3-targets/3-targets/postgres/src/core/postgres-contract-serializer.ts`
  - `serializePostgresNamespace()` (~lines 168–185): currently emits only `table` + `type` slots. Add `role` and `rlsPolicy` the same way `type` is done (`Object.entries(ns.entries.X).map(... serializeJsonValue ...)`), and include them in the returned `entries` object.
  - `hydrateSqlNamespaceEntry()` (~lines 82–127): currently extracts the `type` slot via `this.entityTypeRegistry.get('postgres-enum')` factory dispatch. Extract `role` (`'postgres-role'`) and `rlsPolicy` (`'postgres-rls-policy'`) the same way; pass them into the `new PostgresSchema({ entries: { table, type, role, rlsPolicy } })` construction. Update the `UNBOUND_NAMESPACE_ID` empty-namespace short-circuit so it also accounts for empty `role`/`rlsPolicy` (only return `PostgresSchema.unbound` when ALL slots are empty).
- **IR (D1, landed — do not modify):** `PostgresRlsPolicy` (`src/core/postgres-rls-policy.ts`: `kind`,`name`,`prefix`,`tableName`,`operation`,`roles`,`using?`,`withCheck?`,`permissive`), `PostgresRole` (`src/core/postgres-role.ts`: `kind`,`name`,`namespaceId`), `PostgresSchema.entries` (`src/core/postgres-schema.ts:54-59` — already has `role`/`rlsPolicy` slots + constructor normalization), `StorageTable.rls` (`packages/2-sql/1-core/contract/src/ir/storage-table.ts`: `RlsMode='auto'|'enabled'|'disabled'`, omit-when-`'auto'`).
- **Entity registration:** `packages/3-targets/3-targets/postgres/src/core/authoring.ts:45-69` — `postgresAuthoringEntityTypes`. The `enum` entry carries `validatorSchema: PostgresEnumTypeSchema`; `role` and `rlsPolicy` currently have **none**. Add validatorSchemas to those two entries.
- **Validator precedent:** `packages/2-sql/1-core/contract/src/validators.ts:125-131` — `PostgresEnumTypeSchema = type({ kind: "'postgres-enum'", ... })`. `validatorSchema` type is arktype `Type<unknown>` (`framework-authoring.ts:155`). Validators compose via `collectEntityRegistryContributions` → `validatorFragments` → `createSqlContractSchema`; an unregistered kind falls through to the fallback validator (silently allowed) — that is the gap you are closing.
- **Round-trip test convention:** `packages/3-targets/3-targets/postgres/test/postgres-contract-serializer.test.ts` (see the existing `serializeContract round-trips...` test ~lines 117-148 and the `control` round-trip test ~191-271 for the `deserialize → serialize → JSON.parse(JSON.stringify) → toMatchObject` + omit-when-default pattern).

## Validator-schema decision (orchestrator-decided — implement, don't relitigate)

Add `PostgresRoleSchema` and `PostgresRlsPolicySchema` arktype schemas mirroring `PostgresEnumTypeSchema`, and register them as the `validatorSchema` for the `role`/`rlsPolicy` entries in `postgresAuthoringEntityTypes`. Shapes (match the IR fields exactly; `?` for the optional/omit-when-default ones):
- `PostgresRoleSchema`: `kind: "'postgres-role'"`, `name: 'string'`, `namespaceId: 'string'`.
- `PostgresRlsPolicySchema`: `kind: "'postgres-rls-policy'"`, `name`,`prefix`,`tableName`: `'string'`; `operation`: the closed set `"'select'|'insert'|'update'|'delete'|'all'"`; `roles: type.string.array().readonly()`; `'using?'`,`'withCheck?'`: `'string'`; `permissive: 'boolean'`.
Place the schemas where `PostgresEnumTypeSchema` lives (`validators.ts`) unless a grep shows a better-fit home. Rationale (for the report, not for debate): consistency with the enum precedent; the serialization floor that slices 3–4 build on should validate hydrated entries rather than silently accept malformed ones.

## Scope

**In:** the two serializer methods (`serializePostgresNamespace`, `hydrateSqlNamespaceEntry`); the two new arktype schemas + their registration in `authoring.ts`; the round-trip property test; whatever minimal export plumbing the test import needs.

**Out:** the IR classes (D1, frozen), `canonicalize.ts` (D2, done — the serializer stores the already-computed full `name`; it does NOT call the hasher), the `SchemaIssue` union (D4), any authoring helper / PSL / planner / verifier / DDL, cross-space role resolution (slice 2). The `roles` field stays `readonly string[]`.

## Completed when

- [ ] `serialize → deserialize` round-trips a contract containing `role` + `rlsPolicy` entries and a `StorageTable` with non-default `rls`, yielding structurally-identical frozen instances; `prefix` and full `name` both preserved distinctly; `rls` omitted from JSON when `'auto'`, present otherwise.
- [ ] Round-trip property test covers a representative spread: permissive + restrictive; using-only + using+withCheck; single-role + multi-role policies; ≥1 `PostgresRole` entity; a table with `rls: 'enabled'` and one defaulting to `'auto'`.
- [ ] `postgres-role` and `postgres-rls-policy` carry `validatorSchema`s; a malformed entry (e.g. wrong `operation` literal, missing `permissive`) is rejected on deserialize (add a negative test).
- [ ] Gates green (run once at end): `cd packages/3-targets/3-targets/postgres && pnpm typecheck`; the serializer test file; `pnpm lint:deps`; **`pnpm fixtures:check`** (no fixture drift); SQLite + Mongo suites green (`pnpm --filter <sqlite-pkg> test` + the mongo suite — or the workspace `pnpm test:packages` if cheaper) to confirm no non-Postgres regression.

## Standing instruction

Stay focused on the goal; control scope. Trivial-and-related fixes that obviously serve the goal go in this dispatch with a one-line note. Anything that pulls you off the goal halts and surfaces.

## Halt conditions (surface, do not improvise)

- Round-tripping the new slots forces touching a framework/family-layer exhaustive `entries` walker (i.e. the change can't stay inside the Postgres serializer) — note it and stop; that is a layering signal.
- The validator-fragment composition (`createSqlContractSchema`) doesn't accept the new fragments cleanly (e.g. the kind-dispatch in `namespaceSlotEntrySchema` needs structural change) — surface rather than refactor the shared validator machinery.
- `fixtures:check` shows drift in an existing fixture (it shouldn't — no fixture carries these kinds) — stop and surface; it means a serialization change leaked into existing output.

## Commit hygiene

Explicit staging; `tml-2868:` prefix; commits split sensibly (e.g. validators+registration, serializer+test) if that reads cleaner. No amend, no push. Side-quests separate.

## References

- Slice spec: `projects/postgres-rls/slices/foundation/spec.md` (§ Chosen design → Serializer round-trip; § Slice-specific done conditions 1, 4, 5).
- Content-hash ADR (the `prefix` vs full-`name` asymmetry): `projects/postgres-rls/specs/adr-content-addressed-policy-names.md` (§ IR shape implications).
- Reconciliation (real file paths): `projects/postgres-rls/specs/reconciliation-2026-06-08.md`.
- D2 module (context only — not called here): `packages/3-targets/3-targets/postgres/src/core/rls/canonicalize.ts`.
- Heartbeat: `wip/heartbeats/implementer.txt`.

## Operational metadata

- **Model tier:** sonnet — bounded single-package serialization work with a clear precedent (the `type` slot + `enum` validator).
- **Time-box:** ~60 min wall-clock. Overrun → halt and surface.
