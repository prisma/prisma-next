# Brief: integration test rewrite using ORM + control plane

> **Scope amendment (mid-dispatch):** the live-verification path surfaced two real bugs that block AC-4 from passing. Both fixes are now in-scope for D3, overriding the brief's original "halt on facade modification" rule for these specific cases.
>
> 1. **SDK 1.35.0 typegen drift** — the live response carries one `connections[0]` with all endpoint variants, not multiple `connections[]` keyed by `kind`. Fix in the test's beforeAll lookup.
> 2. **Facade URL validator rejects `prisma+postgres://`** — the canonical URL form the SDK returns and the whole product positioning of the facade. The validator at `packages/3-extensions/prisma-postgres-serverless/src/runtime/binding.ts:52-67` only accepts `postgres:` / `postgresql:`. This rejects any real user passing the canonical Management-API-issued URL, not just this test. Fix the validator + update its unit tests in `packages/3-extensions/prisma-postgres-serverless/test/` if they assert the rejection list.
>
> A third operational adjustment landed during diagnostics:
>
> 3. **TCP-gateway warm-up retry** — the Prisma Postgres TCP gateway has a ~5s warm-up window after `POST /v1/projects` returns `status: "ready"`. The dbInit call must retry with backoff during this window. Add a `retryWithBackoff` helper in the test (in-test, no shared util).
>
> The original brief's halt-condition for #2 ("Modifying the facade to make the test easier — halt") is suspended for the validator fix specifically; the bug affects any real user, not just this test, and fixing it now keeps the diagnosis fresh. See `code-review.md § Orchestrator notes § Slice 6 / D3 — in-flight scope expansion` for the operator's decision context.

## Task

Write the cloud-PPG integration test that exercises the facade's ORM end-to-end against a real Prisma Postgres database provisioned per-run via the Management API. The schema is set up via the facade's new `./control` surface (D2 landed it as a re-export of `@prisma-next/postgres/control`); the queries use `db.orm.<model>` and `db.transaction(fn)`; the lifecycle is `beforeAll` (provision via SDK + apply schema via control) → tests → `afterAll` (delete the project via SDK).

**The partial test file already on disk** at `test/integration/test/prisma-postgres-serverless/cloud-integration.test.ts` is a failed first attempt that used `RuntimeConnection.query()` (which doesn't exist on that interface) and accessed the SDK response shape incorrectly. **Delete it and rewrite from scratch.** Do not try to patch it.

This dispatch ships in **two phases**:

1. **Phase 1 — static.** Write the test, define the contract via the facade's `./contract-builder`, run all static / compile-time gates. Surface back to the orchestrator with a "ready for live verification" signal. **Do not declare the dispatch done.**
2. **Phase 2 — live verification.** Orchestrator obtains a `PRISMA_POSTGRES_SERVICE_TOKEN` from the operator, re-prompts you, you run the test end-to-end against real cloud PPG, verify the assertions all pass, and verify the project is cleaned up. Only then does the dispatch declare done.

This split is required because static-only verification would let a test pass that doesn't actually exercise the wire protocol — the suite would skip silently locally (no token) and the only proof of correctness would be the eventual CI run. Per operator instruction: do not close out D3 until the test has actually been verified to run end-to-end against real cloud PPG.

Full slice plan: [`projects/ppg-serverless/slices/06-integration-tests-and-docs/plan.md § Dispatch 3`](../plan.md). Project spec D6 (the architectural decision this dispatch implements): [`projects/ppg-serverless/spec.md § D6`](../../../spec.md).

## Scope

**In:**

- **Delete** `test/integration/test/prisma-postgres-serverless/cloud-integration.test.ts` (the failed first attempt). Use `git rm` so the deletion is staged.

- **Rewrite** `test/integration/test/prisma-postgres-serverless/cloud-integration.test.ts` from scratch with:

  - `describe.skipIf(!process.env['PRISMA_POSTGRES_SERVICE_TOKEN'])` at the top level.

  - `beforeAll`: provision via `@prisma/management-api-sdk`'s `createManagementApiClient`. POST `/v1/projects` with `{ name, region: 'us-east-1' }`. The response carries the project + a single nested `database` object (not an array; the existing test got this wrong). The database object carries the PPG connection string AND (per the SDK type definitions) a `directConnection: { host, user, pass } | null` field for TCP access. Capture the project ID for teardown, capture both connection forms.

  - Apply the schema to the cloud database via the facade's `./control` surface (D2's re-export). The exact method depends on what `createPostgresControlClient` exposes — likely `dbInit` or `dbPush`. **Read [`packages/3-extensions/postgres/src/exports/control.ts`](../../../../../packages/3-extensions/postgres/src/exports/control.ts) + [`packages/1-framework/3-tooling/cli/src/control-api/`](../../../../../packages/1-framework/3-tooling/cli/src/control-api/) to confirm which method takes a contract and applies it directly without requiring a migrations directory.** If the only path requires a migrations directory, generate a tiny one inline (write the schema SQL to a `tempDir` per the existing journey-test pattern at [`test/integration/test/cli-journeys/`](../../../../../test/integration/test/cli-journeys/) — they use `createTempDir` from `test/integration/utils/`).

  - Define a minimal contract via the facade's `./contract-builder` re-export (`defineContract` + `model()` + `field()`). One model is enough — e.g. `Item` with two fields: `id` (Int, primary key, autoincrement) and `name` (String). Read [`packages/3-extensions/postgres/src/exports/contract-builder.ts`](../../../../../packages/3-extensions/postgres/src/exports/contract-builder.ts) for the surface shape; the implementation is in [`packages/2-sql/2-authoring/contract-ts/src/contract-builder/`](../../../../../packages/2-sql/2-authoring/contract-ts/src/contract-builder/). If `defineContract` requires more than one model to be valid, add a second trivial model.

  - **Tests** (`it` blocks inside the describe):
    1. **SELECT + INSERT round-trip via ORM** — `await db.orm.item.create({ data: { name: 'alice' } })`, then `await db.orm.item.findMany()`, assert the row appears with the right shape.
    2. **Transaction COMMIT** — `await db.transaction(async (tx) => { await tx.orm.item.create({ data: { name: 'bob' } }); })`, then `findMany`, assert both rows present.
    3. **Transaction ROLLBACK** — `await db.transaction(async (tx) => { await tx.orm.item.create({ data: { name: 'carol' } }); throw new Error('rollback'); }).catch(() => {})`, then `findMany`, assert only the previous two rows present.

  - `afterAll`: DELETE `/v1/projects/{id}`. If teardown errors, `console.warn` with the project ID so the leak is recoverable; do not fail the suite.

  - **Test budget:** total test runtime should be under 90 seconds (provision ~30s + schema apply ~10s + 3 ORM tests ~5s each + teardown ~10s). Per-it timeout of 60s; `beforeAll` timeout of 120s.

- No other files. The earlier WIP (workspace catalog, integration-tests package.json devDeps, workflow YAML, project docs) all stay as they are. D2 closed the facade surface; D3 only adds the test that consumes it.

**Out:**

- Anything in `packages/**`. The facade and driver are read-only for this dispatch.
- READMEs. That's D4.
- `architecture.config.json`. The cross-package edges D3 needs (integration-tests → prisma-postgres-serverless, integration-tests → management-api-sdk) should already be permitted by the rules D2 verified; if they're not, halt and surface.
- The `ppgUrl` field on `DevDatabase` in `@prisma-next/test-utils` (D1 keeper). Forward-compat scaffolding; not consumed by D3.

## Phase 1 — Completed when (static gates)

1. The new `cloud-integration.test.ts` file exists; the old version is deleted (`git rm` staged).
2. `pnpm install` is idempotent (`--frozen-lockfile` succeeds with no changes — the test file is a non-manifest addition).
3. `pnpm --filter @prisma-next/integration-tests typecheck` exits 0.
4. `pnpm --filter @prisma-next/integration-tests test test/prisma-postgres-serverless/cloud-integration.test.ts` reports the suite as **skipped** (no token in env; `describe.skipIf` evaluates true).
5. `pnpm lint:deps` exits 0; `pnpm lint:manifests` exits 0.
6. The test body contains **zero** raw-SQL strings (no `CREATE TABLE`, no `INSERT INTO`, no `SELECT`). All queries go through `db.orm.<model>.<method>` or `db.transaction(fn)`. Schema application uses the facade's `./control` surface; the only "raw SQL" allowed is what the control surface generates internally on your behalf (you don't write SQL strings yourself).
7. The test body contains no transient project IDs (canonical regex per `.agents/rules/no-transient-project-ids-in-code.mdc` returns empty on the +diff; manual prose-attribution sweep empty).
8. The test body contains no bare `as` casts that aren't justified per `.agents/rules/no-bare-casts.mdc`. Test files are exempt from the no-bare-casts rule (per AGENTS.md), but a justification comment for any cast helps the reviewer.
9. The test file's static structure is reviewable: `describe` titled clearly (no transient IDs), `it` blocks named by the behaviour they exercise, `beforeAll` and `afterAll` clearly marked, the SDK calls + control surface calls have minimal but sufficient comments explaining the intent.

After Phase 1 gates pass: surface a structured "ready for live verification" report including (a) the test file path + line count, (b) the contract you defined (the `Item` model shape), (c) the control surface method you chose (`dbInit` / `dbPush` / other), (d) any halt-conditions encountered while writing it, (e) explicit confirmation that all 9 static gates pass. **Do not declare D3 done.**

## Phase 2 — Completed when (live verification, after operator provides token)

10. `PRISMA_POSTGRES_SERVICE_TOKEN` is now set in the shell environment. Verify with `echo "${PRISMA_POSTGRES_SERVICE_TOKEN+SET}"` returning `SET`.
11. `pnpm --filter @prisma-next/integration-tests test test/prisma-postgres-serverless/cloud-integration.test.ts` exits 0. The suite **runs** (not skipped) and all 3 `it` blocks pass.
12. After the run, the test's `afterAll` ran cleanly — no leak warnings in stdout. Spot-check by listing projects via the SDK: `curl -H "Authorization: Bearer $PRISMA_POSTGRES_SERVICE_TOKEN" https://api.prisma.io/v1/projects | jq '.data[] | select(.name | startswith("pn-ci-"))'` should return no projects matching the `pn-ci-` prefix from this run (or only ones from earlier dispatches you should manually clean up).
13. The total test runtime (per vitest's reported timing) is under 90 seconds.
14. No unexpected errors in stderr that the test would otherwise swallow (provision errors, schema-apply errors, transient PPG WebSocket errors). The test should be deterministically passing, not pass-via-retry.

After Phase 2 gates pass: declare D3 done. Surface a wrap-up with (a) the live-run timing, (b) the cleanup confirmation, (c) any unexpected behaviour observed (PPG-side latency outliers, region selection issues, etc. — useful intel for D4's documentation).

## Standing instruction

Stay focused on the goal; control scope.

The goal is **a single ORM-based test that exercises the real PPG wire protocol via the facade**, proving AC-4 is satisfied. Three `it` blocks is enough — don't expand to 6-8. The mocked-driver tests already exercise the facade's composition; this test's narrow job is the wire protocol.

**Trivial-and-related fixes that serve the goal** (e.g. adding a missing JSDoc field to the test-helpers, the test file picks up the project's preferred import-ordering convention, a small adjustment to `test/integration/tsconfig.json` if needed to make the new SDK import resolve) — fine, in the same dispatch with a note in the wrap-up.

**Drift from the goal halts.** Examples:
- Modifying the facade to make the test easier — halt; that's a Slice-5 follow-up, not a Slice-6 dispatch.
- Generalizing the test into a reusable test harness for future drivers — halt; YAGNI.
- Adding more `it` blocks beyond the 3 listed because "it would be nice to test X" — halt; surface as a follow-up.
- Writing raw SQL through the runtime to work around an ORM surface gap — halt; if the ORM surface is genuinely incomplete, that's a real finding for the facade, not a workaround.

**Source-string rule:** the test's `describe` / `it` titles, error messages, and console.warn calls are source-shipping content — no transient project IDs.

## Halt conditions

- The facade's `./control` surface doesn't expose a method that applies a contract directly to a database without requiring pre-generated migration SQL files. If `dbInit` / `dbPush` / equivalent only takes a `migrationsDir`, halt and surface; we'll need to decide whether to (a) generate a one-shot migrations dir inline in the test, (b) extend the control surface, or (c) defer.

- The Management API SDK at `1.35.0` returns a `database` shape that doesn't match what the documented API guide implies (e.g. no `directConnection` field, or `connectionString` lives somewhere else). Surface the actual response shape from the typegen.

- The facade's `defineContract` / `model()` / `field()` surface (re-exported in D2) doesn't support a minimal `Item { id Int @id @default(autoincrement()); name String }` shape — e.g. `@default(autoincrement())` requires capabilities that need to be threaded through, or `Int` primary keys aren't supported, or the model needs additional metadata. Surface the actual constraint.

- The facade's ORM (`db.orm.<model>.create(…)` / `.findMany(…)`) doesn't exist on the returned `OrmClient`. Surface and re-derive the API from the postgres facade's analogous test (the existing `test/integration/test/sql-orm-client/` tests are the canonical references).

- The facade's `transaction(fn)` callback doesn't roll back on thrown errors (the current implementation per [`packages/3-extensions/prisma-postgres-serverless/src/runtime/prisma-postgres-serverless.ts`](../../../../../packages/3-extensions/prisma-postgres-serverless/src/runtime/prisma-postgres-serverless.ts) uses `withTransaction` from `@prisma-next/sql-runtime`; verify the rollback semantics). Surface if the assumed contract doesn't hold.

- **PPG-side errors during Phase 2 live run** that look like infrastructure flakes (5xx from `api.prisma.io`, intermittent WebSocket errors). One retry is acceptable; persistent failure surfaces as "PPG cloud-side issue" — capture the error and surface for orchestrator to decide whether to wait + retry, or escalate.

- **Project provisioning hits a rate limit** (P5011 per the Prisma Postgres error reference) — surface; we'd need to back off and retry, or batch differently.

- **Project cleanup fails after a successful test run** — the project leaks. Surface; the orchestrator will trigger a manual cleanup via the SDK before re-running.

## References

- **Slice plan:** [`projects/ppg-serverless/slices/06-integration-tests-and-docs/plan.md § Dispatch 3`](../plan.md).
- **Project spec D6:** [`projects/ppg-serverless/spec.md § D6`](../../../spec.md) — the architectural decision this dispatch implements.
- **D2 commit (the surfaces this dispatch consumes):** `533e08deb` on local `ppg-serverless` branch. Re-exports landed: `@prisma-next/driver-ppg-serverless/control`, `@prisma-next/prisma-postgres-serverless/{config, contract-builder, control}`.
- **`@prisma/management-api-sdk@1.35.0`** documentation: <https://www.prisma.io/docs/management-api/sdk>. Use `createManagementApiClient({ token })` for service-token authentication. The `POST /v1/projects` body is `{ name, region }`; the response is `{ data: { id, name, database: { id, connectionString, directConnection?, ... } } }`.
- **Prisma docs — GitHub Actions guide:** <https://www.prisma.io/docs/guides/integrations/github-actions> — has the canonical example of provisioning a PPG database per CI run via the Management API and seeding it. Mirrors the lifecycle this test needs.
- **Existing integration tests in the workspace:** [`test/integration/test/sql-orm-client/`](../../../../test/sql-orm-client/) for the ORM API patterns; [`test/integration/test/cli-journeys/`](../../../../test/cli-journeys/) for the `dbInit` / control-client patterns. Read at least one of each before writing.
- **Facade runtime under test:** [`packages/3-extensions/prisma-postgres-serverless/src/runtime/prisma-postgres-serverless.ts`](../../../../../packages/3-extensions/prisma-postgres-serverless/src/runtime/prisma-postgres-serverless.ts).
- **Facade control surface (re-exported in D2):** [`packages/3-extensions/postgres/src/exports/control.ts`](../../../../../packages/3-extensions/postgres/src/exports/control.ts).
- **Facade contract-builder surface (re-exported in D2):** [`packages/3-extensions/postgres/src/exports/contract-builder.ts`](../../../../../packages/3-extensions/postgres/src/exports/contract-builder.ts) → see [`packages/2-sql/2-authoring/contract-ts/src/contract-builder/`](../../../../../packages/2-sql/2-authoring/contract-ts/src/contract-builder/) for the actual `defineContract` / `model` / `field` implementation.
- **Workflow YAML (already on disk):** [`.github/workflows/ci.yml`](../../../../../.github/workflows/ci.yml) — the `test-integration` job has the env-var + require-token step that wires the secret into CI. The test's `skipIf` works against the env var exposed by the job; the workflow itself enforces "secret must be configured on prisma/prisma-next PR runs".

## Edge cases

| Edge case | Disposition |
|---|---|
| **`defineContract` requires a contract name + version.** Some signatures take `defineContract('mydb', '0.1', () => …)` — others take an object. | Read the actual signature in the postgres facade's contract-builder surface before guessing. Use whatever minimal shape compiles. |
| **The `Item` model needs a `@map`** to handle table-name collisions with previous test runs. | Not needed — every CI run gets a fresh project + database, so no collision. Use the model name verbatim as the table name. |
| **The SDK response carries `database.apiKeys[0].connectionString`** in addition to `database.connectionString` (the docs example shows both). | Use whichever the typegen says is the canonical field for "the URL you pass to `@prisma/ppg`". `connectionString` on `database` is the most direct candidate. |
| **`afterAll` runs even on test failure** in vitest. | Yes — but `beforeAll`'s `projectId` capture must precede any throws inside `beforeAll` itself, otherwise the `afterAll` has nothing to delete. Capture `projectId` immediately after the SDK call succeeds; only then proceed to schema apply (which is more likely to fail). |
| **The PPG WebSocket connection has a cold-start latency** of a few hundred ms to a couple seconds on first session. | Each `it` block opens a new session via the driver's one-shot lifecycle. The first `it` will be slower than subsequent ones; account for this in the per-it timeout (60s is plenty). |
| **The Management API uses Bearer token auth** with the workspace-scoped service token. The `directConnection` field on `database` carries Postgres-protocol credentials (user/pass) separately from the api-key on the connection string. | The test only needs the api-key form (for `@prisma/ppg` consumption). If schema apply via the facade's control requires the TCP `directConnection`, use that for the control client; use the `connectionString` (api-key form) for the facade's runtime/data plane. The two are separate. |
| **Test cleanup on `beforeAll` failure**: if provisioning succeeds but schema apply fails inside `beforeAll`, the project leaks. | Wrap the schema-apply step in try/catch inside `beforeAll`; on catch, delete the project via SDK before rethrowing. The `afterAll` still runs but finds nothing to delete. |
| **`pnpm install` is run by the implementer at the start** to make sure devDeps are present. | Should be idempotent (everything is already installed from D2 / earlier WIP). If it churns the lockfile, surface — that's a sign something has drifted. |

## Operational metadata

- **Model tier:** Sonnet. Substantive new test composition with non-trivial setup; needs reasoning about contract definition + control-surface choice + cleanup invariants. Not Opus territory — the test itself is straightforward once the API surfaces are pinned.
- **Time-box Phase 1:** 90 minutes wall-clock for the write + static gates. Overrun → halt and surface.
- **Time-box Phase 2:** 15 minutes wall-clock for the live verification (provision + run + teardown). Includes one retry budget for transient PPG flakes.
- **Validation gate Phase 1:** items 1–9. Validation gate Phase 2: items 10–14.
- **WIP heartbeat cadence:** standard. Update at phase boundaries (post-delete-old-test → post-test-write → post-typecheck → post-skip-run → post-static-gate → post-token-verification → post-live-run → post-cleanup-verify).

## Carry-over from prior rounds

D2 / R1 / SATISFIED landed commit `533e08deb` — the surfaces this dispatch consumes. Reviewer notes flagged the `export * + export { default }` pattern at driver layer as worth a sanity check (validated); the `PrismaPostgresServerlessConfigOptions` interface dropped (no impact on D3); same-layer dep edge `3-extensions → 3-extensions` permitted (no impact on D3). No findings outstanding from D2.

WIP on disk from D1's halt that stays untouched by D3 (already committed in D2 or already present): workspace catalog `@prisma/management-api-sdk` entry, integration-tests `package.json` devDeps, workflow YAML, doc updates in `projects/ppg-serverless/`.

The partial test file `test/integration/test/prisma-postgres-serverless/cloud-integration.test.ts` is the failed first attempt — delete it as the first step.

## Commit organisation

Suggested **two commits**:

1. Phase 1: test file authored (delete + rewrite), static gates pass.
2. Phase 2: ONLY if the live-run reveals adjustments needed (e.g. timeout tuning, retry logic, error-message tightening). If Phase 2 runs cleanly first time, no second commit needed.

A single commit is also acceptable if Phase 1 + Phase 2 land cleanly without adjustment.

**No `git add -A`.** **No `--amend`.** **No push** (single PR at project close-out).
