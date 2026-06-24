# Dispatch D1 — Un-leak (rls-walking-skeleton)

Slice `rls-walking-skeleton` (TML-2868), dispatch 1 of 7. Implementer tier: sonnet. **Operator checkpoint after this dispatch** — the orchestrator confirms the substrate is clean before D2 builds on it.

## Task

Remove and relocate the RLS leaks the prior foundation introduced into shared layers, returning the branch to a clean substrate where the framework and SQL-family/core carry **no** RLS knowledge. The exact, authoritative manifest is **[slice spec §6-A](../spec.md)** — follow it literally (it lists every file with the 2026-06-09 line numbers; confirm each by grep before editing). Summary of the manifest:

- **Delete** the three RLS issue interfaces + their `SchemaIssue` union members + exports in `framework-components/src/control/control-result-types.ts` and `exports/control.ts`.
- **Delete** the three RLS `case` arms in SQL-family `verifier-disposition.ts` (`classifySqlVerifierIssueKind`).
- **Delete** the RLS narrowing guards in the SQLite planner (`issue-planner.ts`, `planner-strategies.ts`, `operations/tables.ts`) and the Postgres planner (`issue-planner.ts`) — they exist only because the kinds were in the shared union.
- **Delete** `StorageTable.rls`/`RlsMode` (in `storage-table.ts`), its re-exports (`types.ts`, `exports/types.ts`), and `StorageTableSchema.rls` (`validators.ts`).
- **Relocate** `PostgresRoleSchema` + `PostgresRlsPolicySchema` out of SQL-core `validators.ts` into the Postgres target, attached via the existing `entityTypes` `validatorSchema` fragment channel in `postgres/src/core/authoring.ts` (the `role`/`rlsPolicy` entries already exist there). Remove the hardcoded `role?`/`rlsPolicy?` fallback wiring in `createNamespaceEntrySchema`.

**Keep** (do not touch): `PostgresRlsPolicy`, `PostgresRole`, their `entityTypes` registration, `PostgresSchema.entries.role/rlsPolicy`, the serializer slots, `canonicalize.ts`.

## Scope

**In:** only the removals/relocations in spec §6-A. **Out:** everything else in the slice (the differ, introspection, PSL, planner, verify, test are D2–D7). Do **not** start building the generic differ here.

## Completed when

- [ ] Every item in spec §6-A done; the relocated validators are contributed from the Postgres target and the serializer still validates `role`/`rlsPolicy` entries (the relocation is behavior-preserving).
- [ ] `grep -rin 'rls\|RlsMode\|rls_policy_\|relrowsecurity' packages/1-framework packages/2-sql` returns **nothing** (no RLS in framework or SQL-family/core).
- [ ] Gates green (run once at end): `pnpm build` then workspace `pnpm typecheck`; `pnpm lint:deps`; the kept foundation tests (IR classes + serializer round-trip) pass; SQLite + Mongo suites green; `pnpm fixtures:check` clean.

## Standing instruction

Stay focused on the goal; control scope. This is deletions + one relocation — no new behavior. If a removal forces a change beyond §6-A (e.g. a consumer genuinely needs one of the deleted kinds), **halt and surface** rather than improvising.

## Halt conditions (surface, do not improvise)

- Removing a `SchemaIssue` member or a classify case breaks an exhaustive consumer that needs *real* handling (not a trivial deletion) — surface.
- The validator relocation can't go through the `entityTypes` fragment channel cleanly (e.g. the channel doesn't validate `role`/`rlsPolicy` entries without the SQL-core fallback) — surface; do not leave the validators in SQL core.

## Commit hygiene

Explicit staging; `tml-2868:` prefixed message. No amend, no push (the orchestrator handles the branch).

## References

- **Authoritative manifest:** [slice spec §6-A](../spec.md) + the file:line list therein.
- Design context: [`../../../specs/design-generic-schema-differ.md`](../../../specs/design-generic-schema-differ.md) § 1 (the leak).
- Heartbeat: `wip/heartbeats/implementer.txt`.

## Operational metadata

- **Model tier:** sonnet — mechanical removals + one relocation against a precise manifest.
- **Time-box:** ~40 min. Overrun → halt and surface.
