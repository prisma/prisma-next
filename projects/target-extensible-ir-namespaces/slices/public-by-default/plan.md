# Dispatch plan — public-by-default

Slice spec: [`spec.md`](./spec.md). Branch `tml-public-by-default`, based on `main` (`7ac37dd96`). Three sequential dispatches.

### Dispatch 1: Postgres default namespace → `public` (substrate flip + fixture regen)

- **Outcome:** An un-namespaced Postgres model resolves to namespace id `public` (not the `__unbound__` sentinel); `namespace unbound { … }` still round-trips to `__unbound__`; the PSL interpreter and the TS contract builder agree (parity test green); the ~53 Postgres `contract.json`/`.d.ts` fixtures are regenerated under `public`; SQLite and Mongo fixtures are byte-unchanged.
- **Builds on:** The spec's chosen design (the single decision point `resolveNamespaceIdForSqlTarget` in `contract-psl/src/interpreter.ts` + the TS builder default in `build-contract.ts`).
- **Hands to:** A tree where `public` is the genuine default-namespace id for un-namespaced Postgres models throughout the emitted IR — the stable shape Dispatch 2's DDL-derivation and Dispatch 3's upgrade entries document. The two hardcoded `'public'` DDL fakes are still present here (they now coincidentally match the real namespace, so nothing is red).
- **Focus:** Interpreter + TS-builder default; tests pinning the old `__unbound__`-for-Postgres / parity behaviour; fixture regeneration. **Not** the DDL-fake deletion (Dispatch 2). **Not** SQLite/Mongo defaults (the `targetId !== 'postgres'` guard isolates them — verify by grep that their fixtures are untouched).
- **Gates:** `pnpm fixtures:check` clean; `pnpm typecheck`; targeted PSL/TS parity test; `rg` gate confirming no Postgres default model still emits under `__unbound__` and SQLite/Mongo fixtures unchanged.

### Dispatch 2: Delete the two hardcoded `'public'` DDL fakes (derive from the namespace)

- **Outcome:** `planner.ts` (`defaultSchema: 'public'`, ~line 47) and `postgres-schema.ts` (`ddlSchemaName` projection, ~line 176) derive the DDL schema name from the model's now-real namespace id instead of a hardcoded string literal; the two `'public'` literals are gone from those sites; Postgres migration/DDL emission stays schema-qualified. The legitimate introspection/runtime fallbacks in `control-adapter.ts` and `enum-control-hooks.ts` are left intact.
- **Builds on:** Dispatch 1's hand-off (`public` is the genuine namespace id, so deriving from it produces the same `"public"` schema the fakes hardcoded).
- **Hands to:** A Postgres DDL path with no faked prefix — the honest base that `runtime-qualification` (TML-2605) later extends to the query path.
- **Focus:** Only the two DDL-schema-naming fakes. **Halt-and-report** if removing them cannot stay green without adding query-path identifier qualification — that is `runtime-qualification`'s scope (PDoD5), and pulling it forward is a slice-boundary violation. Do not touch the runtime query path or the projection helpers.
- **Gates:** `rg "'public'"` / `"public"` in the two named files returns nothing (retired-literal gate); `pnpm test:packages` for `@prisma-next/target-postgres` + migration/planner packages green; `pnpm fixtures:check` still clean.

### Dispatch 2b (discovered): Relax the required `__unbound__` brand so public-only contracts typecheck

- **Discovered during WIP inspection of D2**, not in the original plan. D1's public flip produces public-only Postgres contracts, but the `SqlStorage`/`SqlStorageInput` type still required an `__unbound__` namespace key (a brand added in TML-2727), so `Contract<SqlStorage>` rejected valid public-only contracts — `prisma-next-postgis-demo` failed to typecheck at its `postgres<Contract>()` call.
- **Outcome:** The required-`__unbound__` intersection is dropped from `SqlStorageInput.namespaces` and the `SqlStorage` class field (now `Readonly<Record<string, SqlNamespace>>`); the builder's inferred storage type keys its primary namespace off the target (`public` for Postgres, `__unbound__` otherwise) via `DefaultStorageNamespaceId`; the runtime serializer keeps injecting an empty `__unbound__` shim but its comments/`blindCast` reasons now describe it as a compatibility convenience, not a type guarantee; the sql-orm-client source table lookups scan all namespaces (the package's existing `codecRefForStorageColumn` pattern) instead of hardcoding `namespaces['__unbound__']`.
- **Boundary:** Relaxing the brand is the type-level completion of public-by-default. The query-builder's `UnboundTables<C>` (which still indexes `['__unbound__']`) compiles generically and is **not** reworked here — cross-namespace query-path addressing is `runtime-qualification` (TML-2605).
- **Gates:** full `pnpm typecheck`; `pnpm fixtures:check`; `prisma-next-postgis-demo` build; sql-orm-client + target-postgres tests; `pnpm lint:deps`.

### Dispatch 3: Author the `0.11-to-0.12` upgrade entries (both clusters, both transitions)

- **Outcome:** Following the `record-upgrade-instructions` skill, the `upgrades/0.11-to-0.12/instructions.md` in **both** the user-upgrade cluster (`skills/upgrade/prisma-next-upgrade`) and the extension-author cluster (`skills/extension-author/prisma-next-extension-upgrade`) carries entries covering: (a) **public-by-default** — un-namespaced Postgres models re-emit under `public`, `__unbound__` via `namespace unbound {}`; (b) **extension migration-baseline shift** — published Postgres extension packs (pgvector/postgis/paradedb) flip their empty default namespace `__unbound__ → public`, changing their `storageHash` + migration head ref + `migration.json` hashes (extension-author cluster: re-emit contract-space + regenerate the migration baseline; the migration ops are unchanged); and (c) **domain-plane backfill** — `contract.models`/`valueObjects` moved under `contract.domain.namespaces.<ns>` (user cluster: re-emit; extension cluster: the SPI reshape + the removed `@prisma-next/contract/testing` subpath, factories now in `@prisma-next/test-utils`). Colocated codemod scripts where the skill prescribes them. Note: the domain-plane changes (c) already shipped on `main` (#653), so validate those entries against the pre-#653 substrate state, not `origin/main`.
- **Builds on:** Dispatch 1's final contract shape (the public-default transition) + the already-merged domain-plane change (TML-2751) the predecessor never documented.
- **Hands to:** The slice-DoD's upgrade-coverage condition — both transitions documented in the in-flight transition directory.
- **Focus:** Upgrade-instructions authoring only; no production-code change. Follow the skill's authoring workflow (in-flight transition `0.11-to-0.12`, both substrates touched → both clusters).
- **Gates:** `pnpm check:upgrade-coverage` green; the new entries name both transitions; any colocated codemod scripts run on a sample and produce the documented translation.

## Handoff linearity

D1 → D2 → D3 is linear: each `builds on` references the immediately-prior `hands to`. D3 also draws on the merged domain-plane change (non-linear, external — surfaced here so the brief carries that context). The final hand-off (D3) plus D1/D2's gates compose to the slice-DoD: public default + fixtures clean + no faked prefix + both upgrade transitions recorded.
