# Dispatch plan — facade-completion

Sequential. Seven dispatches, each M or smaller. Sequencing constraint: façade subpaths (D1–D3) land before the renderer switch (D4); renderer switch + in-workspace fixture regen is one commit; example + test-fixture sweep (D5a + D5b) lands after D4 so user-shaped TS doesn't briefly point at a not-yet-emitted specifier; docs sweep (D6) lands last.

**Mid-flight split.** D5 was originally one M-sized dispatch (~17 files) covering example apps + extension-pack contracts. While preparing the D5 brief the orchestrator grepped for `@prisma-next/(family-(sql|mongo)|target-(postgres|sqlite|mongo))/pack` across the workspace and found ~60 additional user-shaped TS files (CLI-journey + parity test fixtures under `test/integration/test/fixtures/cli/cli-e2e-test-app/fixtures/**/contract*.ts` and `test/integration/test/authoring/parity/**/contract.ts`, plus a handful of `test/e2e/framework/` fixtures and a CLI-recording fixture pair). These weren't in the original D5 inventory but are structurally identical to user contracts (`import sqlFamily from '@prisma-next/family-sql/pack'` + `defineContract({ family: sqlFamily, target: postgresPack, ... })`) and break under the D1/D2/D3 wraps' input-type drop. Folding ~80 files into one dispatch would have pushed D5 to L; per the M-cap, split into D5a (original inventory, ~19 files) + D5b (test fixtures, ~60 files). Each is M-sized and mechanical; D5a establishes the migration pattern on a small surface before D5b scales it. D6 unchanged.

## Pre-dispatch orchestrator context-gathering (complete; not a dispatch)

Before the dispatch loop opened, the orchestrator did inline research to firm up the spec + plan — reading files, grepping for pinned specifiers, sampling representative renderer/adapter call sites, and walking the Mongo control SPI. This was **orchestrator-scope work**, not a dispatch — no source changes, no subagent delegation, scope confined to project artifacts (`spec.md`, `plan.md`).

Findings folded into the project + slice specs:

- **A3 verified** — `migrationHash` is content-addressed over `ops.json`, not over `migration.ts`. Renderer flip doesn't shift hashes.
- **A4 verified** — Mongo `/control` SPI shape matches Postgres's pattern; `createMongoControlClient` is straight composition.
- **A5 verified** — no internal consumer imports `@prisma-next/mongo` without a subpath; the existing `"."` barrel re-exports BSON value constructors from `mongodb`, which move to a new `/bson` subpath.
- **A6 verified** — TML-2526 referenced in `skills/prisma-next-migrations/SKILL.md` + `skills/DEVELOPING.md` only.
- **A7 added** — application-level rendered migrations stay on the target specifier (NFR2-protected); extension-pack migrations stay on the target specifier deliberately (extension authoring contract).

Newly surfaced scope items folded into D1/D2/D3/D4/D5/D6:

- D1 + D2 + D3 each absorb a `defineContract` pre-binding wrap (one per facade) so user `contract.ts` files don't reach into family/target packs.
- D2 grows to add a new `/bson` subpath alongside the barrel drop.
- D4 grows to also flip `TARGET_MIGRATION_MODULE` in both `op-factory-call.ts` files (necessary for the renderer flip to actually take effect), plus ~15 string-pinned tests (target tests, adapter tests, cli-journey e2e tests).
- D5 grows to also cover `examples/*/prisma/contract.ts` + two extension-pack contracts (`pgvector`, `postgis`).
- D6 grows to flip the ts-render README, the cli README, the ADR 208 example, and `skills/DEVELOPING.md`.

Pre-dispatch research that *is* dispatchable (would touch source or change diffs) would have been a true D0 spike dispatched to a subagent. None of the above qualified — every finding came from read-only inspection of existing files and the result lived only in `projects/` artifacts.

---

### Dispatch 1: Postgres `/migration` + contract-builder pre-binding + arch config

**Intent.** Add `@prisma-next/postgres/migration` as a re-export of `@prisma-next/target-postgres/migration`. Wrap `defineContract` in `@prisma-next/postgres/contract-builder` to pre-bind `sqlFamily` + `postgresPack` (drop both from the input scaffold's type). Register the new subpath in `architecture.config.json`. Add parity + wrap-shape tests. Do NOT yet flip the renderer; renderer change is D4.

**Files in play.**

- `packages/3-extensions/postgres/src/exports/migration.ts` (new; one-line `export *`).
- `packages/3-extensions/postgres/src/contract/define-contract.ts` (new; wrapped `defineContract` pre-binding `sqlFamily` + `postgresPack`).
- `packages/3-extensions/postgres/src/exports/contract-builder.ts` (replace re-exported `defineContract` with the wrapped version; keep `field`, `model`, `rel`, type re-exports as-is).
- `packages/3-extensions/postgres/package.json` (add `./migration` to `exports`).
- `packages/3-extensions/postgres/test/migration/re-export.test.ts` (new; named-export parity assertion against `@prisma-next/target-postgres/migration`).
- `packages/3-extensions/postgres/test/contract-builder/define-contract.test.ts` (new; assert the wrapped `defineContract` (a) accepts a scaffold with no `family`/`target` keys, (b) produces a contract whose family/target IDs are `'sql'`/`'postgres'`, (c) still accepts an `extensionPacks` map, (d) type-check: `family`/`target` not in the input type).
- `packages/3-extensions/postgres/README.md` (add `### @prisma-next/postgres/migration` section; update the `contract-builder` section to show the new no-family/target shape).
- `architecture.config.json` (add entry: `packages/3-extensions/postgres/src/exports/migration.ts` → `domain: extensions, layer: adapters, plane: migration`).

**"Done when":**

- [ ] `pnpm build --filter @prisma-next/postgres` clean.
- [ ] `pnpm typecheck --filter @prisma-next/postgres` clean.
- [ ] `pnpm test:packages --filter @prisma-next/postgres` clean (parity + wrap-shape tests pass).
- [ ] `pnpm lint:deps` clean.
- [ ] Importing `Migration`, `MigrationCLI`, `placeholder`, `createTable`, `addColumn`, `dataTransform`, `rawSql` from `@prisma-next/postgres/migration` in a smoke-test snippet typechecks against the same types `@prisma-next/target-postgres/migration` exposes.
- [ ] The wrapped `defineContract` smoke-test: `defineContract({ extensionPacks: {} }, ({ field, model }) => ({ models: { Foo: model('Foo', { fields: { id: field.id.uuidv4() } }) } }))` typechecks and returns a `SqlContractResult<...>` whose family/target IDs are `'sql'`/`'postgres'`.
- [ ] Intent-validation: diff covers exactly the new `/migration` subpath + the contract-builder wrap + tests + README + arch config; no behaviour change to the underlying types.

**Size.** M (was S; grew with the contract-builder wrap, but the wrap is mechanical mirror-of-Postgres pattern).

**Tier.** Orchestrator-or-mid (the contract-builder wrap's generic signature needs careful mirroring of the base `defineContract`'s overloads to preserve inference; verify against `packages/2-sql/2-authoring/contract-ts/src/contract-builder.ts` before writing).

**DoR confirmed.** [ ]

---

### Dispatch 2: Mongo `/config` parity + `/control` + `/bson` + contract-builder pre-binding + drop barrel

**Intent.** Bring `MongoConfigOptions` to parity with `PostgresConfigOptions` (`extensions`, `migrations.dir`). Add `@prisma-next/mongo/control` exporting `createMongoControlClient`. Add `@prisma-next/mongo/bson` re-exporting the BSON value constructors currently behind the `"."` barrel. Drop the `"."` barrel and delete `src/exports/index.ts`. Wrap `defineContract` in `@prisma-next/mongo/contract-builder` to pre-bind family + target (mirror of D1 for the mongo family). Add covering tests.

**Files in play.**

- `packages/3-extensions/mongo/src/config/define-config.ts` (extend `MongoConfigOptions`, thread through to `coreDefineConfig`).
- `packages/3-extensions/mongo/src/exports/config.ts` (re-export the new option type).
- `packages/3-extensions/mongo/src/exports/control.ts` (new; mirror of postgres `control.ts` against mongo descriptors).
- `packages/3-extensions/mongo/src/exports/bson.ts` (new; `export { Binary, Decimal128, Long, MongoClient, ObjectId, Timestamp } from 'mongodb';`).
- `packages/3-extensions/mongo/src/contract/define-contract.ts` (new; wrapped mongo `defineContract` pre-binding family + target).
- `packages/3-extensions/mongo/src/exports/contract-builder.ts` (replace re-exported `defineContract` with the wrapped version).
- `packages/3-extensions/mongo/test/contract-builder/define-contract.test.ts` (new; mirror D1's wrap-shape test for the mongo family).
- `packages/3-extensions/mongo/src/exports/index.ts` (delete).
- `packages/3-extensions/mongo/package.json` (add `./control`, `./bson`; remove `"."`).
- `packages/3-extensions/mongo/test/config/define-config.test.ts` (extend with `extensions` + `migrations.dir` cases).
- `packages/3-extensions/mongo/test/control/create-mongo-control-client.test.ts` (new; assert the client composes the expected descriptors).
- `packages/3-extensions/mongo/test/bson/re-export.test.ts` (new; named-export parity against the deleted barrel's surface).
- `packages/3-extensions/mongo/README.md` (rewrite to mirror Postgres's structure; document `/config`, `/contract-builder`, `/control`, `/bson`, `/family`, `/runtime`, `/target`; note barrel removal + the `import { ObjectId } from '@prisma-next/mongo'` → `from '@prisma-next/mongo/bson'` migration for users).
- `architecture.config.json` (add entries for `mongo/src/exports/control.ts` + `bson.ts`; remove entry for the deleted `index.ts` barrel if one exists).

**"Done when":**

- [ ] `pnpm build --filter @prisma-next/mongo` clean.
- [ ] `pnpm typecheck --filter @prisma-next/mongo` clean.
- [ ] `pnpm test:packages --filter @prisma-next/mongo` clean.
- [ ] `pnpm lint:deps` clean.
- [ ] Mongo example apps' `pnpm typecheck` still clean (`mongo-demo`, `mongo-blog-leaderboard` — including any that imported BSON constructors from the barrel, which must now import from `/bson`).
- [ ] Grep gate: `rg "from '@prisma-next/mongo'(?!/)"` returns zero hits across `packages/` + `examples/` + `test/` (or only the deleted barrel file).
- [ ] Intent-validation: diff matches "Mongo parity + control + bson + barrel removal"; nothing else.

**Size.** M.

**Tier.** Orchestrator-or-mid (one design judgment on `createMongoControlClient`'s options interface; verify against Postgres precedent before writing).

**DoR confirmed.** [ ]

---

### Dispatch 3: SQLite façade — `/config`, `/contract-builder`, `/control`, `/migration`

**Intent.** Add all four missing SQLite façade subpaths in one dispatch. Each is a thin composition / re-export file mirroring the Postgres precedent; the bundle stays M-sized because each individual file is small and follows the same pattern. Update `package.json` deps. Add tests covering each new subpath. Add `architecture.config.json` entries. Do NOT yet flip the SQLite renderer (that's D4).

**Files in play.**

- `packages/3-extensions/sqlite/src/config/define-config.ts` (new; mirror of postgres `define-config.ts`).
- `packages/3-extensions/sqlite/src/exports/config.ts` (new; re-exports).
- `packages/3-extensions/sqlite/src/contract/define-contract.ts` (new; wrapped `defineContract` pre-binding `sqlFamily` + `sqlitePack`).
- `packages/3-extensions/sqlite/src/exports/contract-builder.ts` (new; exports the wrapped `defineContract`, plus re-exports `field`, `model`, `rel`, types from `@prisma-next/sql-contract-ts/contract-builder`).
- `packages/3-extensions/sqlite/src/exports/control.ts` (new; mirror of postgres `control.ts`).
- `packages/3-extensions/sqlite/src/exports/migration.ts` (new; `export * from '@prisma-next/target-sqlite/migration'`).
- `packages/3-extensions/sqlite/package.json` (add `./config`, `./contract-builder`, `./control`, `./migration` to `exports`; add `@prisma-next/cli`, `@prisma-next/config`, `@prisma-next/sql-contract-psl`, `@prisma-next/sql-contract-ts`, `pathe` to `dependencies`).
- `packages/3-extensions/sqlite/test/config/define-config.test.ts` (new; mirror of mongo's).
- `packages/3-extensions/sqlite/test/contract-builder/re-export.test.ts` (new; named-export parity).
- `packages/3-extensions/sqlite/test/control/create-sqlite-control-client.test.ts` (new; mirror of postgres's).
- `packages/3-extensions/sqlite/test/contract-builder/define-contract.test.ts` (new; mirror D1's wrap-shape test for sqlite).
- `packages/3-extensions/sqlite/test/migration/re-export.test.ts` (new; named-export parity).
- `packages/3-extensions/sqlite/README.md` (full rewrite to mirror Postgres's README shape).
- `architecture.config.json` (add four new entries; mirror the Postgres planes — `/config` shared, `/contract-builder` shared, `/control` migration, `/migration` migration).

**"Done when":**

- [ ] D0 confirmed the SQLite façade's new deps don't cycle (`pnpm install` succeeds; `pnpm lint:deps` clean).
- [ ] `pnpm build --filter @prisma-next/sqlite` clean.
- [ ] `pnpm typecheck --filter @prisma-next/sqlite` clean.
- [ ] `pnpm test:packages --filter @prisma-next/sqlite` clean.
- [ ] `pnpm lint:deps` clean.
- [ ] Importing from each new subpath in a smoke-test snippet typechecks against the expected surface.
- [ ] Intent-validation: diff covers exactly the four new subpaths + tests + README + arch config; no renderer change yet.

**Size.** M.

**Tier.** Orchestrator-or-mid (multiple files, mirror-pattern execution, low individual judgment).

**DoR confirmed.** [ ]

---

### Dispatch 4: Renderer switch + IR-constant flip + test-pin sweep

**Intent.** Flip the renderer end-to-end in one atomic commit. Two source changes (`BASE_IMPORTS` in `render-typescript.ts`, `TARGET_MIGRATION_MODULE` in `op-factory-call.ts`) for both Postgres and SQLite, plus ~15 string-pinned test files that assert on the rendered specifier. The constant + renderer must flip together because each op-factory call's `importRequirements()` overrides the renderer's `BASE_IMPORTS` for the same symbols; flipping only one yields mixed specifiers in rendered output.

**Files in play.**

- **Renderer sources (4 files):**
  - `packages/3-targets/3-targets/postgres/src/core/migrations/render-typescript.ts` (`BASE_IMPORTS` swap).
  - `packages/3-targets/3-targets/sqlite/src/core/migrations/render-typescript.ts` (`BASE_IMPORTS` swap).
  - `packages/3-targets/3-targets/postgres/src/core/migrations/op-factory-call.ts` (`TARGET_MIGRATION_MODULE` swap).
  - `packages/3-targets/3-targets/sqlite/src/core/migrations/op-factory-call.ts` (`TARGET_MIGRATION_MODULE` swap).
- **String-pinned tests (target + adapter):**
  - `packages/3-targets/3-targets/postgres/test/migrations/issue-planner.test.ts`.
  - `packages/3-targets/3-targets/sqlite/test/migrations/op-factory-call.test.ts`.
  - `packages/3-targets/3-targets/sqlite/test/migrations/planner.authoring-surface.test.ts`.
  - `packages/3-targets/6-adapters/postgres/test/migrations/op-factory-call.rendering.test.ts`.
  - `packages/3-targets/6-adapters/postgres/test/migrations/op-factory-call.lowering.test.ts`.
  - `packages/3-targets/6-adapters/postgres/test/migrations/planner.authoring-surface.test.ts`.
  - `packages/3-targets/6-adapters/postgres/test/migrations/render-typescript.roundtrip.test.ts`.
  - `packages/3-targets/6-adapters/sqlite/test/migrations/render-typescript.roundtrip.test.ts` (verify shape vs string pinning; update if string-pinned).
- **String-pinned e2e tests:**
  - `test/integration/test/cli-journeys/invariant-routing.e2e.test.ts` (2 occurrences).
  - `test/integration/test/cli-journeys/migration-round-trip.e2e.test.ts` (1 occurrence).
  - `test/integration/test/cli-journeys/init-journey/harness.ts` (1 occurrence — comment + harness).
- **Internal-source comments / docstrings that reference the specifier as the rendered output:**
  - `packages/3-targets/3-targets/postgres/src/core/migrations/postgres-migration.ts` (docstring at L22).
  - `packages/3-targets/3-targets/{postgres,sqlite}/src/exports/migration.ts` (file-header comments).
  - `packages/3-targets/3-targets/{postgres,sqlite}/src/core/migrations/render-typescript.ts` (file-header comments).

**"Done when":**

- [ ] D1 + D3 landed; `@prisma-next/postgres/migration` and `@prisma-next/sqlite/migration` resolve.
- [ ] `pnpm build --filter @prisma-next/target-postgres --filter @prisma-next/target-sqlite` clean.
- [ ] `pnpm test:packages` for both target packages and both adapters clean.
- [ ] `pnpm test:integration` clean (cli-journey e2e tests pass with the flipped specifier).
- [ ] `pnpm test:e2e` clean.
- [ ] `pnpm fixtures:check` clean.
- [ ] `pnpm lint:deps` clean.
- [ ] Intent-validation: diff covers exactly the 4 source files + the test-pin sweep + the docstring touch-ups; no façade source change in this dispatch.
- [ ] Grep gate: `rg "@prisma-next/target-(postgres|sqlite)/migration" -g '!**/node_modules/**' -g '!**/migrations/**'` returns only:
  - the internal target packages' own `src/exports/migration.ts` (the source of `/migration`),
  - the cipherstash extension's `src/exports/migration.ts` docstring (deliberate; documents the extension authoring contract),
  - the parity tests added in D1 and D3 (which assert the façade re-exports byte-match the target),
  - `skills/` / `docs/` / `README.md` references that get flipped in D6.

**Size.** M (mechanical + well-bounded by D0 inventory; ~20 files touched but each edit is a single-line swap of one identifier string).

**Tier.** Cheap (mechanical, D0 inventory in hand).

**DoR confirmed.** [ ]

---

### Dispatch 5a: Example apps migrate to façade form (extension-pack contracts exempted, see A7)

**Intent.** Migrate every user-authored TS file in `examples/` (and the two extension-pack `src/contract.ts` files) to façade form. Two surfaces:

- **`examples/<app>/prisma-next.config.ts`** — verbose → façade (`@prisma-next/{postgres,sqlite,mongo}/config`). Per D0's inventory: `react-router-demo` + `prisma-next-demo-sqlite` definitely verbose; spot-check `paradedb-demo`, `prisma-next-postgis-demo`, `retail-store`.
- **`examples/<app>/prisma/contract.ts`** + **`packages/3-extensions/{pgvector,postgis}/src/contract.ts`** — drop `import sqlFamily from '@prisma-next/family-sql/pack'` + `import postgresPack from '@prisma-next/target-postgres/pack'`; drop `family` / `target` from the `defineContract` call. Extension packs that ship a contract count as user-authored TS for this purpose.

For Mongo examples, opportunistically apply the now-available `extensions` / `migrations` fields only if the example needs them. Verify `pnpm typecheck` per example after migration.

**Files in play.**

- All `examples/*/prisma-next.config.ts` files (per D0 inventory, 13 files).
- All `examples/*/prisma/contract.ts` files (per D0 grep, 4 files: `paradedb-demo`, `prisma-next-demo-sqlite`, `prisma-next-demo`, `react-router-demo`).
- ~~`packages/3-extensions/pgvector/src/contract.ts`, `packages/3-extensions/postgis/src/contract.ts`~~ (**dropped post-D5a R1**: Turbo build cycle `postgres → sql-builder → extension-pgvector → would-be postgres` makes the migration impossible without architectural refactor. Folded into A7's extension-pack exemption; see spec § A7 for details and the `@prisma-next/postgres-contract` extraction follow-up option).
- `packages/3-extensions/sql-orm-client/test/fixtures/contract.ts` (test fixture — only migrate if doing so doesn't break the test's intent; if the fixture deliberately exercises the verbose form, leave + add a comment).
- Any `examples/*/scripts/*.ts` or `examples/*/test/utils/*.ts` that imports from `@prisma-next/cli/control-api`, `@prisma-next/target-*/control`, etc. — verified by grep; in scope if the façade now exposes the equivalent surface (`createSqliteControlClient`, `createMongoControlClient`, `createPostgresControlClient`).

**"Done when":**

- [ ] D2 + D3 landed; mongo + sqlite façade subpaths + wrapped `defineContract` exist.
- [ ] Grep gate (config): `rg "@prisma-next/(cli|family-(sql|mongo)|sql-(contract|contract-psl|contract-ts)|mongo-(contract|contract-psl|contract-ts)|target-(postgres|sqlite|mongo)|adapter-(postgres|sqlite|mongo)|driver-(postgres|sqlite|mongo))/" examples/*/prisma-next.config.ts` returns zero hits.
- [ ] Grep gate (contract): `rg "@prisma-next/(family-(sql|mongo)|target-(postgres|sqlite|mongo))/(pack|control)" examples/*/prisma/contract.ts packages/3-extensions/{pgvector,postgis}/src/contract.ts` returns zero hits.
- [ ] `pnpm typecheck` clean for every example (filter per example or run the all-examples task).
- [ ] `pnpm build` clean across the workspace.
- [ ] Intent-validation: diff covers only `examples/**/{prisma-next.config.ts,prisma/contract.ts}` + (if applicable) a handful of control-side test helpers; no façade or framework source change. (Extension-pack contracts exempted post-discovery — see A7.)
- [ ] FR9 partially satisfied (examples sweep complete; D5b closes the test-fixture remainder).

**Size.** M.

**Tier.** Mid or cheap (mechanical mirror-of-pattern, bounded fan-out; one extension-pack contract has `extensionPacks` wiring that needs careful migration to ensure the wrapped `defineContract` accepts it).

**DoR confirmed.** [ ]

---

### Dispatch 5b: Test fixtures migrate to façade form

**Intent.** Sweep the remaining user-shaped TS files outside `examples/` — the CLI-journey + parity + e2e test fixtures + CLI-recording fixtures + the single mongo-runtime test that constructs a contract — to the wrapped `defineContract`. Mechanically identical to D5a's contract.ts pattern (drop two imports, drop two arguments from the `defineContract` call) but at higher fan-out (~60 files). Most are templated identically — establish the sed-pattern on the first 2-3 files, scale to the rest. Verify the integration suite goes green afterward (this dispatch is what closes the 17 `pnpm test:integration` failures D4's full-suite run surfaced).

**Files in play.**

Per the orchestrator's grep (run before D5a; re-grep to refresh before D5b dispatches):

- **CLI-journey fixtures** (`test/integration/test/fixtures/cli/cli-e2e-test-app/fixtures/cli-journeys/contract-*.ts`) — ~18 files matching `contract*.ts` with `/pack` imports.
- **CLI-journey + DB-init contracts** (`test/integration/test/fixtures/cli/cli-e2e-test-app/fixtures/{db-init,db-init-with-contract-space,db-update-preflight-gaps,db-update-scenarios,db-verify,db-sign,db-introspect,emit,migration-apply,migration-plan,vite-plugin,mongo-cli-journeys}/contract*.ts`) — ~15 files.
- **CLI-integration fixtures** (`test/integration/test/fixtures/cli/cli-integration-test-app/fixtures/{emit-command,emit-contract,verify-database}/contract*.ts`) — ~5 files.
- **Parity test fixtures** (`test/integration/test/authoring/parity/**/contract.ts`) — ~15 files.
- **Side-by-side test fixtures** (`test/integration/test/authoring/side-by-side/{postgres,mongo}/contract.ts`) — 2 files.
- **Top-level integration fixtures** (`test/integration/test/{fixtures,sql-builder/fixtures,mongo/fixtures}/contract.ts` + `.../prisma-next.config.ts` + `mongo-cli-journeys/prisma-next.config.with-db.ts`) — ~6 files.
- **Disallow-rule fixtures** (`test/integration/test/fixtures/cli/{disallowed-import,exact-prefix-import,custom-allowlist,valid-contract,valid-contract-default}.ts`) — VERIFY before migrating; these may deliberately exercise the verbose form to test the import-allowlist disallow rules. If a fixture's intent is "demonstrate a disallowed import" then leave it + add a comment; if it's just predates the facade then migrate.
- **E2E framework fixtures** (`test/e2e/framework/test/fixtures/contract.ts`, `test/e2e/framework/test/sqlite/fixtures/contract.ts`, `test/e2e/framework/test/sqlite/migrations/harness.ts`) — 3 files.
- **CLI recordings** (`packages/1-framework/3-tooling/cli/recordings/fixtures/contract-{base,additive}.ts`) — 2 files.
- **Mongo runtime test** (`packages/2-mongo-family/7-runtime/test/query-builder.test.ts`) — 1 file (constructs a contract inline; may be deliberately testing the verbose form, verify intent).
- **Test helpers** (`test/integration/test/utils/cli-test-helpers.ts`, `test/integration/test/family.schema-verify.helpers.ts`, `test/integration/utils/framework-components.ts`) — check usage; only migrate the parts that construct user-shaped contracts. Control-plane wiring stays on `/control` subpaths.
- **Test files that inline-construct contracts** (`test/integration/test/contract-builder.test.ts`, `test/integration/test/contract-builder.types.test-d.ts`, `test/integration/test/dsl-type-inference.test-d.ts`, `test/integration/test/control-api.test.ts`, `test/integration/test/family.{introspect,schema-verify.*,verify-database.*,sign-database}.{test,integration.test}.ts`, `test/integration/test/referential-actions.integration.test.ts`, `test/integration/test/authoring/{paradedb-bm25-narrowing,mongo-pack-composition,callback-mode-terseness}.test.ts`, `test/integration/test/authoring/psl-index-type-options.integration.test.ts`, `test/integration/test/authoring/parity/ts-psl-parity.real-packs.test.ts`) — these are tests, not fixtures; check each one's intent. Many are testing the wrap shape itself or the underlying `defineContract`; migrating them might invalidate the test. **Implementer judgment per file.**

**"Done when":**

- [ ] D5a landed.
- [ ] Grep gate: `rg "@prisma-next/(family-(sql|mongo)|target-(postgres|sqlite|mongo))/(pack|control)" -g '!**/node_modules/**' -g '!**/dist/**' -g '!projects/**'` returns only:
  - the facade source files that re-export from packs (`packages/3-extensions/{postgres,sqlite,mongo}/src/{exports/{family,target}.ts,contract/define-contract.ts}`),
  - the facade test files that assert pack rejection via `@ts-expect-error` (`packages/3-extensions/{postgres,sqlite,mongo}/test/contract-builder/define-contract.test-d.ts`),
  - cipherstash migration files (A7 exemption),
  - extension-pack `src/contract.ts` files (`pgvector`, `postgis`) — A7 exemption (Turbo cycle blocks migration without architectural refactor),
  - disallow-rule fixtures left deliberately verbose (with explanatory comments),
  - any test file deliberately exercising the verbose form (with explanatory comments).
- [ ] `pnpm test:integration` clean (the 17 failures D4 surfaced are gone).
- [ ] `pnpm test:e2e` clean.
- [ ] `pnpm lint:deps` clean.
- [ ] `pnpm fixtures:check` clean (if not pre-existing-env-broken).
- [ ] Intent-validation: diff covers only test-fixture / test-file user-contract migration; no source change to packages.
- [ ] FR9 fully satisfied.

**Size.** M (mechanical, templated; if file fan-out genuinely exceeds 60 non-trivial diffs at dispatch time, escalate and re-split).

**Tier.** Mid (some judgment required on which test fixtures are deliberately verbose vs need migration).

**DoR confirmed.** [ ]

---

### Dispatch 6: Docs sweep + final lint/test/fixtures pass

**Intent.** Flip every prose / example-code reference to the old specifier across docs, skills, and READMEs that the renderer dispatch leaves behind. Remove all TML-2526 references outside `projects/`. Final repo-wide lint + test + fixtures pass.

**Files in play.**

- `skills/prisma-next-migrations/SKILL.md` (L52-62 paragraph rewrite; drop TML-2526 + "until then" framing).
- `skills/DEVELOPING.md` L86 (same flip; drop TML-2526).
- `packages/1-framework/1-core/ts-render/README.md` L45 (example code in the README uses façade specifier).
- `packages/1-framework/3-tooling/cli/README.md` L1063 (paragraph describing the scaffolded migration's import line).
- `docs/architecture docs/adrs/ADR 208 - Invariant-aware migration routing.md` L9 (illustrative-code example flips; the ADR's *decision* text stays as-is — it's historical).
- Verify the three façade READMEs reflect their final shape after D1/D2/D3; touch up if anything stale.

**"Done when":**

- [ ] D1–D5b all landed.
- [ ] `rg 'TML-2526' -- skills/ docs/ packages/ examples/ test/ projects/` returns hits only inside `projects/facade-import-surface-completion/`.
- [ ] `rg '@prisma-next/target-(postgres|sqlite)/migration' -g '!**/node_modules/**'` returns only:
  - internal target package source (`packages/3-targets/3-targets/{postgres,sqlite}/src/exports/migration.ts` and internal callers),
  - extension-pack hand-authored migrations (`packages/3-extensions/{cipherstash,pgvector,postgis,paradedb}/migrations/**/migration.ts`) — deliberate per A7,
  - extension-pack export docstrings that document the extension authoring contract (cipherstash),
  - pre-existing `examples/**/migrations/app/**/*.ts` files — deliberate per A7 (existing rendered output stays valid),
  - the parity tests in D1/D3 that explicitly bridge the two specifiers.
- [ ] `pnpm lint:deps` clean.
- [ ] `pnpm test:packages`, `pnpm test:integration`, `pnpm test:e2e` clean.
- [ ] `pnpm fixtures:check` clean.
- [ ] Intent-validation: diff covers only docs / skills / READMEs; no source change.

**Size.** S.

**Tier.** Cheap.

**DoR confirmed.** [ ]

---

## Sequencing summary

```text
D1 (postgres /migration + contract-builder wrap) ─┐
D2 (mongo parity + ctrl + bson + cb-wrap + drop barrel) ─┤
                                                  ├→ D4 (renderer + IR-constant flip + test sweep) → D5a (examples + ext-pack contracts) → D5b (test fixtures) → D6 (docs)
D3 (sqlite façade + contract-builder wrap) ───────┘
```

D1, D2, D3 are independent — they can land in any order or in parallel commits within a single PR. D4 requires D1 + D3 (it switches both renderers; postgres + sqlite façade `/migration` must both resolve). D5a requires D1 + D2 + D3 (example apps + contract.ts files consume all three facades' new APIs and the wrapped `defineContract`). D5b requires D5a only to establish the migration pattern. D6 requires everything else; it's the closing dispatch.

Each merged commit must keep `pnpm test:packages`, `pnpm fixtures:check`, and `pnpm lint:deps` green. The renderer switch is the only dispatch where multiple files change atomically; everything else is independently revertable.
