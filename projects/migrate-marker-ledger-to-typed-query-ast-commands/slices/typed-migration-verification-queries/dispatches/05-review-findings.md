# Brief: D5 — address PR #825 review findings (namespace default + codec-filter invariant)

Resume-context dispatch on the open PR #825 (branch tml-2889-typed-migration-verification-queries). Two findings from the local review (`reviews/pr-825/system-design-review.md` + `code-review.md`). Single writer; granular commits; push to `bot` at the end. Read CLAUDE.md (pnpm; no import extensions; no bare `as`; do NOT invoke vitest directly — use the package `test` script; explicit staging only — a prior agent swept stray untracked files into the index, so stage ONLY files you changed; commit `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`).

## Finding 1 (architect + operator) — migration schema default must follow the PSL `public` convention

**Decided (operator):** an absent `schema` on a `Migration` method must default to the target's DEFAULT namespace (`public` on Postgres), NOT the unbound/`search_path` namespace. Binding to unbound must be an EXPLICIT opt-in. This restores symmetry with PSL/TS authoring (which defaults un-namespaced → `public` via `target.defaultNamespaceId`). See `design-notes.md` § "Migration schema-default convention".

Current (wrong) behaviour: the new `Migration` methods default absent `schema` → `UNBOUND_NAMESPACE_ID` → `PostgresUnboundSchema` → `current_schema()`. Relevant code: `packages/3-targets/3-targets/postgres/src/core/migrations/postgres-migration.ts` (the method option handling that resolves `schema`, ~lines 117+), `packages/3-targets/3-targets/postgres/src/core/postgres-schema.ts` (`PostgresSchema` vs `PostgresUnboundSchema`, `schemaFilterExpression()`, the `defaultNamespaceId`/`UNBOUND_NAMESPACE_ID` constants), `descriptor-meta.ts` (`defaultNamespaceId`).

Task:
1. Change the absent-`schema` default in the Postgres `Migration` methods to resolve to the target default namespace (`public`) — reuse `defaultNamespaceId` (the same source PSL/TS authoring uses), do not hardcode the string `'public'` if a constant exists.
2. Preserve an EXPLICIT way to opt into the unbound/`search_path` namespace (e.g. passing `UNBOUND_NAMESPACE_ID` / the existing unbound id as `schema`). Confirm the opt-in path still resolves through `PostgresUnboundSchema` → `current_schema()`. If there is no clean explicit-opt-in token and inventing one is non-trivial, HALT and report rather than guessing the API.
3. JSDoc on the affected `Migration` methods: state that an absent `schema` defaults to `public` and how to opt into unbound.
4. Tests (tests-before-impl): pin that a `Migration` method with NO `schema` resolves/lowers to the `public`-qualified form (NOT `current_schema()`), and that the explicit unbound opt-in still lowers to the `current_schema()`/search_path form. Put them with the existing postgres migration/verification-check tests.
5. Confirm no regression: the planner path passes an explicit schema (unaffected); the examples carry explicit `'public'` (unaffected). Run the postgres migration + verification-check suites + a fresh workspace typecheck.

SQLite has no schemas — this finding is Postgres-only. Confirm SQLite is genuinely unaffected (no absent-schema-defaulting concern) and note it.

## Finding 2 (principal-engineer F01) — close the codec-filter invariant

`packages/3-targets/6-adapters/sqlite/src/core/descriptor-meta.ts` filters execution codecs by `d.renderOutputType === undefined`. This couples "codec emits a TS type name" to "codec not needed at execution" — an unstated, unenforced invariant that would silently re-break the codec saga if a codec ever needs BOTH an emit renderer AND execution registration.

Task — pick the cheapest robust closure (your judgment, justify in report):
- **(a) Explicit split:** give codec descriptors (or the registry) an explicit marker for "needed in the control/execution codec lookup" vs "emit-only," and filter on THAT instead of the incidental `renderOutputType` proxy. Most intention-revealing if the descriptor type can carry it cleanly.
- **(b) Property test:** if (a) is too invasive for this PR's scope, keep the filter but add a test that asserts the invariant (every codec the SQLite control/execution path can bind is included by the filter; and no included codec emits an unresolvable named type), so a future violation fails loudly instead of silently.
Prefer (a) if it's contained; fall back to (b) with a recorded rationale + a follow-up note. Either way: after the change, re-run the sqlite verification-checks-lowering (incl. the production-filtered-lookup test), runner.ledger, db-init-update.cli suites, and confirm `grep -c 'Char<' examples/prisma-next-demo-sqlite/src/prisma/contract.d.ts` is still 0.

## Gates (all)

Fresh non-cached workspace typecheck (`pnpm turbo typecheck --force`); `pnpm --filter @prisma-next/adapter-postgres --filter @prisma-next/target-postgres --filter @prisma-next/adapter-sqlite --filter @prisma-next/target-sqlite test` (the migration/verification suites; PGlite suites flake under load — re-run isolated before treating as real); `pnpm fixtures:check` (clean — and if the namespace default change alters any emitted/regenerated migration fixture, regenerate + commit it; expectation: planner path is unaffected so fixtures should NOT change — if they DO, that's a signal the change reached more than intended, investigate); `pnpm lint:deps`; cast ratchet `pnpm lint:casts` delta 0.

## Wrap

Granular commits (one per finding), push `git push bot tml-2889-typed-migration-verification-queries`. Heartbeat to wip/heartbeats/implementer.txt. Final report: F1 — the opt-in mechanism you used + the test added + whether any fixture changed; F2 — which closure (a/b) + why + test/result; gate results (call out any isolated flake re-runs); commit shas; push confirmation.