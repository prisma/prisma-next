# Slice — `pg-addcolumn-opid-and-codecref-roundtrip` (plan)

**Spec:** `./spec.md` · **Base:** current `origin/main` (post-#825). One dispatch; one PR; design settled in the spec — no spike.

## Dispatch

### D1 — implement both fixes + tests + fixture regen

Tests-first per fix. Targeted gates only; orchestrator runs the heavy suites.

- **Item 1 — `AddColumnCall.toOp` op id includes `schemaName`** ([op-factory-call.ts:355](packages/3-targets/3-targets/postgres/src/core/migrations/op-factory-call.ts:355)).
  - Ground sibling op-id formats in the file (grep `id: \`.*\.\${`) and choose the separator consistent with the prevailing convention (most likely `\`column.${schemaName}.${tableName}.${columnName}\``).
  - Quick grep: do other Call classes share the same omit-schema bug? Record the answer in the dispatch artifact — if yes, do NOT widen this slice; flag as follow-up.
  - Update tests that pin the op-id literal (likely in `packages/3-targets/3-targets/postgres/test/migrations/op-factory-call.test.ts` and any planner/runner integration tests asserting on op ids). Add an explicit cross-schema uniqueness test.

- **Item 2 — `renderDdlColumnAsTsCall` emits `codecRef`** ([op-factory-call.ts:141](packages/3-targets/3-targets/postgres/src/core/migrations/op-factory-call.ts:141)).
  - Grep how `CodecRef` is otherwise rendered in this file/package (`jsonToTsSource` form vs a `codecRef(...)` factory). Match that form.
  - Confirm `col()` accepts `codecRef` via its options object (it does — `DdlColumnOptions` spread).
  - Add a round-trip test: build an `AddColumnCall` with a `DdlColumn` whose `codecRef` is set; assert `renderTypeScript()` includes the codecRef; assert that parsing the rendered TS (or constructing the equivalent call inline) yields a `DdlColumn` whose `codecRef` deep-equals the original. The mongo-side `mongo-ops-serializer` round-trip pattern is the model; here it's TS-render round-trip via the migration authoring API.
  - Verify no other consumer of `renderDdlColumnAsTsCall` is broken (it's used by `CreateTableCall` columns too — that's a bonus benefit, but check that emitted TS still parses + behaves identically).

- **Fixture regen.** `pnpm fixtures:check` will regenerate any committed `ops.json` whose AddColumn ops live in non-default schemas. Commit the regen as part of the same change — don't read individual fixtures, just `git add examples/**`.

### Gates (targeted; orchestrator runs the heavy ones)

`pnpm build`, `pnpm typecheck`, `pnpm --filter @prisma-next/target-postgres test`, `pnpm --filter @prisma-next/adapter-postgres test`, `pnpm --filter @prisma-next/sql-relational-core test`, `pnpm lint:code`, `pnpm lint:packages`, `pnpm lint:deps`, `pnpm lint:casts` (delta ≤ 0), `pnpm fixtures:check`. Known-ignorable flakes: extension-supabase `jose`; PG `portal "C_n"`; PGlite V8 jit_page; CLI parallel/PATH. Leave full `test:packages`/`test:integration` to the orchestrator.

### Commits + push

One or two legible commits (suggested: (1) `fix(postgres): namespace AddColumn op ids by schema`, (2) `fix(postgres): round-trip codecRef through renderDdlColumnAsTsCall` + fixture regen). `-s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`, `--no-verify`, no GIT_AUTHOR_*. Push: `git push -u bot pg-addcolumn-opid-and-codecref-roundtrip`.

### Report

The op-id separator chosen + grep evidence; the codecRef render shape chosen + grep evidence; whether sibling Call classes share the schema-omit defect (and if so, the follow-up to file); fixture regen scope (which examples regenerated); per-gate pass/fail; commit SHAs.

## Sequencing

D1 → orchestrator gates → review (architect lens, opus) if anything beyond the spec'd two fixes needs scrutiny — otherwise straight to PR + babysit. Single dispatch; one PR.

## Risks

- **Sibling Call classes with the same op-id defect** (e.g. future `DropColumnCall` etc.). Address: don't widen scope mid-flight; surface as follow-up, fix in a separate sweep.
- **`codecRef` round-trip via a missing factory shape.** If `CodecRef` isn't trivially TS-renderable (e.g. typeParams contain non-JSON values), narrow the test to the trivial case + flag the gap. Don't ship a half-working renderer.
- **Op-id collision in committed examples.** `fixtures:check` will surface this — accept regenerated ids.
