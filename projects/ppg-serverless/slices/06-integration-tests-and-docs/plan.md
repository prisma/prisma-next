# Slice 6 — Dispatch plan

Slice spec: [`./spec.md`](./spec.md)

## Sizing rationale

The slice now decomposes into four dispatches. The first dispatch (D1) halted under the original D6 assumption; the resolution chosen by the operator (see [`./spec.md § Status`](./spec.md), [`../../learnings.md § Slice 6 / D1`](../../learnings.md), [`../../spec.md § D4`](../../spec.md)) is to **re-export the existing TCP control surface through the serverless driver and facade**, then write the integration test using the facade's ORM end-to-end against a real cloud Prisma Postgres database provisioned via the Management API.

Splitting:

- **D2** is mechanical re-export work at the driver and facade layers. ~30 LoC of new code plus three stub replacements. Validation is purely typecheck + workspace build.
- **D3** is the substantive integration test rewrite. It depends on D2 having shipped the control re-export (the test uses the facade's new `./control` to set up the schema, then the facade's ORM to query). Validation is typecheck + the test skipping locally + workspace tests staying green.
- **D4** is the docs that describe the now-finalised surface.

Splitting D2 from D3 keeps D2's commit purely additive (no behaviour change for runtime consumers; new exports + new test setup capability) and makes D3 reviewable as a single "the integration test works now" diff.

Both D2 and D3 pass dispatch-INVEST *Small*: D2 touches ~8 files all of which are exports / package manifests / tsdown configs; D3 rewrites one test file using the new surfaces. Each fits one focused implementer session.

## Dispatch plan

### Dispatch 1: `@prisma-next/test-utils` extension + in-process integration tests — **HALTED**

Status: superseded by D2 + D3. Kept as historical record of the original (falsified) D6 path. See [`./dispatches/01-integration-tests.md`](./dispatches/01-integration-tests.md) and [`../../learnings.md § Slice 6 / D1`](../../learnings.md) for the full context.

What landed from this attempt and remains in the worktree as forward-compatible scaffolding:

- The `ppgUrl: string` field added to `DevDatabase` in `@prisma-next/test-utils` (JSDoc documents the protocol mismatch with `@prisma/dev`'s endpoint at the field).
- Empirical + source-level confirmation that `@prisma/dev@0.24.7`'s `server.ppg.url` serves Accelerate, not PPG.

What did NOT land: the integration tests themselves (the partial attempt at `test/integration/test/prisma-postgres-serverless/cloud-integration.test.ts` is on disk but typecheck-failing; D3 will rewrite it from scratch).

### Dispatch 2: control re-exports at driver + facade

**Outcome:** `@prisma-next/driver-ppg-serverless` ships a `./control` entrypoint that re-exports `@prisma-next/driver-postgres/control`. `@prisma-next/prisma-postgres-serverless`'s three currently-stubbed exports (`./config`, `./contract-builder`, `./control`) become thin re-exports of `@prisma-next/postgres/{config, contract-builder, control}`. The runtime entry of both packages stays edge-clean (bundlers tree-shake the unimported control / config / contract-builder surfaces; the `pg` transitive dep enters the install graph but never the runtime bundle).

**Builds on:** Slice 5's facade runtime is untouched. This dispatch adds new exports alongside it.

**Hands to:** D3 (the integration test consumes the new `./control` to set up the schema before running the facade's ORM queries against the cloud database). Also closes the Slice-5 open question OQ1 ("stub status of `./config` and `./contract-builder`") in favour of the re-export resolution.

**Focus:**

- **Driver layer first.** Create `packages/3-targets/7-drivers/ppg-serverless/src/exports/control.ts` that re-exports `@prisma-next/driver-postgres/control`. Add `./control` to the package's `exports` map. Add `@prisma-next/driver-postgres: workspace:0.12.0` to `dependencies`. Add the new entry to `tsdown.config.ts`.

- **Facade layer second.** Replace the three call-time-throwing stubs (`src/exports/config.ts`, `src/exports/contract-builder.ts`, `src/exports/control.ts` — the last one does not exist yet) with `export * from '@prisma-next/postgres/<surface>'` style re-exports. The `./control` export needs to be added to the facade's `package.json` exports map AND to `tsdown.config.ts`. Add `@prisma-next/postgres: workspace:0.12.0` to facade `dependencies` (it is not currently there — verify before adding).

- **No runtime behaviour change.** Existing facade tests (`prisma-postgres-serverless.test.ts`, `prisma-postgres-serverless.e2e.test.ts`) must stay green. The driver's 77 tests must stay green.

- **NFR2 invariant: the runtime entry stays edge-clean.** Confirm by inspecting the generated `dist/runtime.mjs` of the driver — `pg` should not appear in the imports of that bundle. (The control bundle WILL import pg, by design.)

- **Spec already updated.** D4 and FR1/FR2 in `projects/ppg-serverless/spec.md` were amended ahead of this dispatch; no spec changes needed in this dispatch.

#### Completed when

1. `pnpm install` succeeds (catalog + new workspace deps resolve). Re-running with `--frozen-lockfile` is idempotent.
2. `pnpm --filter @prisma-next/driver-ppg-serverless build` exits 0. `dist/control.mjs` materialises. `dist/runtime.mjs` does not import `pg` (verify by `grep -l pg dist/runtime.mjs` returning nothing relevant).
3. `pnpm --filter @prisma-next/prisma-postgres-serverless build` exits 0. `dist/control.mjs`, `dist/config.mjs`, `dist/contract-builder.mjs` all materialise as real re-exports (not call-time-throwers).
4. `pnpm --filter @prisma-next/driver-ppg-serverless typecheck` + `pnpm --filter @prisma-next/prisma-postgres-serverless typecheck` exit 0.
5. `pnpm --filter @prisma-next/driver-ppg-serverless test` exits 0 (77 existing tests still pass). `pnpm --filter @prisma-next/prisma-postgres-serverless test` exits 0 (20 existing facade tests still pass).
6. `pnpm lint:deps` exits 0. `pnpm lint:manifests` exits 0.
7. No transient project IDs in source / READMEs (canonical regex on +diff empty; manual prose-attribution sweep empty).
8. No bare `as` casts in production code added this dispatch.

#### Halt conditions

- `@prisma-next/postgres`'s `./config` or `./contract-builder` exports a value-side surface that can't be cleanly forwarded via `export * from` (e.g. a default export that needs to be re-aliased). Surface the shape and the proposed alias.
- `@prisma-next/driver-postgres/control` has a type or runtime shape that doesn't match what the existing serverless facade's stubs declare (the stubs' `defineConfig` signature is `(options: PrismaPostgresServerlessConfigOptions) => never`; the real `defineConfig` from postgres has a different signature). Surface the delta; the resolution is likely "drop the stub interface and re-export the real types verbatim", but the type-flow change deserves a confirm.
- Adding the workspace deps changes import-lint layering (`lint:deps`) — surface the violation; the resolution would need an `architecture.config.json` amendment.
- Building the facade triggers a circular dependency through `@prisma-next/postgres`'s control / config / contract-builder packages — surface the cycle.

### Dispatch 3: integration test rewrite using ORM + Management API

**Outcome:** A working integration test at `test/integration/test/prisma-postgres-serverless/cloud-integration.test.ts` that (1) provisions a fresh cloud Prisma Postgres project via the Management API in `beforeAll`, (2) applies a TypeScript-authored contract to the database via the facade's new `./control` surface, (3) exercises the facade's ORM (`db.orm.<model>.create`, `.findMany`) and explicit transactions (`db.transaction(fn)` with commit + with rollback-on-throw), (4) deletes the project in `afterAll`. The test skips silently when `PRISMA_POSTGRES_SERVICE_TOKEN` is unset; runs against a real cloud DB when set. The workflow YAML changes from earlier WIP (env var + `Require PPG service token` step) stay as-is.

**Builds on:** D2 (the facade's new `./control` surface is the schema-setup mechanism). The Management API SDK at `@prisma/management-api-sdk@1.35.0` (catalog pin from earlier WIP). The workflow YAML changes (already on disk). The test-file scaffolding (partial WIP on disk; D3 rewrites it).

**Hands to:** D4 (READMEs + repo docs describe the now-end-to-end-verified surface).

**Focus:**

- **The current test on disk is a failed first attempt.** It uses `RuntimeConnection.query()` for raw SQL, which doesn't exist on that interface. Delete and rewrite, don't try to patch.
- **Use the facade's ORM API.** Define a minimal contract via the new `./contract-builder` (one model, e.g. `Item { id Int @id @default(autoincrement()); name String }`). Use `db.orm.item.create(…)`, `db.orm.item.findMany(…)`, `db.transaction(async (tx) => …)` for queries.
- **Use the facade's `./control` for schema setup.** Provision via SDK → get connection details (PPG URL for queries + TCP direct connection for control). Set up the schema via `createPostgresControlClient` (re-exported by the facade) against the TCP URL.
- **Skip on missing token.** `describe.skipIf(!process.env.PRISMA_POSTGRES_SERVICE_TOKEN)`. The workflow's `Require PPG service token` step (already on disk) hard-fails own-repo CI runs that don't have the secret configured; fork PRs skip silently because the env var won't be exposed.
- **Region pinned.** `us-east-1` (matches the documentation example). Don't make it env-configurable for this dispatch.
- **`db.transaction()` for both commit and rollback.** The facade's `transaction(fn)` callback semantic is: commit on return, rollback on throw. Force the rollback path by throwing inside the callback and catching the throw outside.

#### Completed when

1. `pnpm --filter @prisma-next/integration-tests typecheck` exits 0.
2. `pnpm --filter @prisma-next/integration-tests test test/prisma-postgres-serverless/cloud-integration.test.ts` reports the suite as SKIPPED (the token is not set in the implementer's environment).
3. `pnpm lint:deps` exits 0; `pnpm lint:manifests` exits 0.
4. Static review of the test: no raw SQL paths (only ORM calls + `./control` for schema setup), no bare `as` casts in test code that aren't justified, no transient project IDs.
5. The workflow YAML's `test-integration` job parses cleanly (`node -e 'yaml.parse(require("fs").readFileSync(...))'`).
6. The earlier WIP on disk (workspace catalog entry, integration-tests `package.json` devDeps, workflow YAML, doc updates) is preserved exactly as-is — D3 only touches the test file.

#### Halt conditions

- The facade's ORM doesn't expose a method needed for the test (e.g. transaction handle for rollback semantics) — surface; that's a facade-runtime issue, not a test-rewrite issue.
- The Management API SDK at `1.35.0` returns a connection-string shape that's incompatible with `@prisma/ppg` consumption — surface; that would be a project-wide blocker.
- The new `./control` surface from D2 doesn't expose `dbInit` or whatever schema-apply method the test needs — surface; D2's re-export shape might need extension.
- TypeScript-authored contract via the new `./contract-builder` (D2) can't represent a simple `Item { id Int @id; name String }` model — surface; the contract-builder surface is upstream postgres facade's; should be a non-issue but worth a runtime check.

### Dispatch 4: READMEs + repo docs

Unchanged scope from the original D2 in the previous plan version. Defers to D3 for the verified ORM surface that the docs describe.

(Body identical to the prior "Dispatch 2: READMEs + repo docs" section in this plan's earlier version — kept here so the slice plan is self-contained.)

**Outcome:** `packages/3-targets/7-drivers/ppg-serverless/README.md` has its Slice-1 TODO placeholders replaced with real Architecture + Usage content. `packages/3-extensions/prisma-postgres-serverless/README.md` ships full Usage section + Cloudflare Workers example. `docs/onboarding/Repo-Map-and-Layering.md` lists both new packages. All content uses neutral wording.

**Builds on:** D3 (the validated facade behaviour is what the docs describe).

**Hands to:** Project close-out (`drive-close-project`).

**Focus:**

- Driver README — mirror `@prisma-next/driver-postgres/README.md`'s structure. Architecture mermaid for the WS session flow. Usage for both binding variants.
- Facade README — mirror `@prisma-next/postgres/README.md`'s structure. Cloudflare Workers example. Note the dual-plane structure: `./runtime` for data via PPG/WS, `./control` (re-exported from the TCP-side postgres facade) for migrations via TCP — same package, two transport modes for two planes. The previously-flagged "stub-export workaround" callout (in earlier plan versions) is obsolete; the facade is now feature-complete.
- Repo Map — one-line entries for both new packages.

#### Completed when

1. Driver README ships Architecture mermaid + Usage code block.
2. Facade README ships Usage + Cloudflare Workers example + dual-plane (runtime / control) story.
3. Repo Map lists both new packages.
4. No transient project IDs in source / docs.
5. Build / lint / lint:deps clean.

## Hand-off completeness check

Slice-DoD per [`./spec.md`](./spec.md):

- [ ] Integration test passes (in CI when the token is present; skips silently otherwise) — D3's `Completed when` #2.
- [ ] `pnpm test:packages` workspace-wide green — D2 + D3's lint:deps + typecheck gates plus D3's skip-locally assertion.
- [ ] Driver README's TODO placeholders replaced — D4's `Completed when` #1.
- [ ] Facade README + Workers example — D4's `Completed when` #2.
- [ ] Repo Map updated — D4's `Completed when` #3.

D2 + D3 + D4 together close the slice. Project close-out (`drive-close-project`) runs after.
