# Brief: control re-exports at driver + facade

## Task

Re-export the existing TCP control surface through the serverless driver and facade, so users get a single-import experience symmetric with `@prisma-next/postgres`. The project does not build a new control driver — this dispatch is pure wiring of existing surfaces.

Two layers, both required:

1. **`@prisma-next/driver-ppg-serverless` (driver layer):** new `./control` entrypoint that re-exports `@prisma-next/driver-postgres/control`.

2. **`@prisma-next/prisma-postgres-serverless` (facade layer):** the three currently-stubbed exports (`./config`, `./contract-builder`, `./control`) become thin re-exports of the corresponding surfaces from `@prisma-next/postgres`. The `./control` entrypoint does not exist yet on the facade — both the file and the `exports` map entry need to be added.

Full slice spec + design context: [`projects/ppg-serverless/slices/06-integration-tests-and-docs/spec.md`](../spec.md). Slice plan + sizing: [`projects/ppg-serverless/slices/06-integration-tests-and-docs/plan.md § Dispatch 2`](../plan.md). Project spec D4 (the architectural decision this dispatch implements): [`projects/ppg-serverless/spec.md § D4`](../../../spec.md).

## Scope

**In:**

- `packages/3-targets/7-drivers/ppg-serverless/src/exports/control.ts` — new file. Re-export `@prisma-next/driver-postgres/control`. The driver-postgres control export is the default-export descriptor `postgresDriverDescriptor` plus the `PostgresControlDriver` class; mirror whichever shape is the publicly-imported one. Read [`packages/3-targets/7-drivers/postgres/src/exports/control.ts`](../../../../../packages/3-targets/7-drivers/postgres/src/exports/control.ts) to confirm before writing the re-export.

- `packages/3-targets/7-drivers/ppg-serverless/package.json` — add `"./control": "./dist/control.mjs"` to the `exports` map. Add `"@prisma-next/driver-postgres": "workspace:0.12.0"` to `dependencies`.

- `packages/3-targets/7-drivers/ppg-serverless/tsdown.config.ts` — add `'src/exports/control.ts'` to the `entry` array.

- `packages/3-extensions/prisma-postgres-serverless/src/exports/config.ts` — replace the call-time-throwing stub with `export * from '@prisma-next/postgres/config'`. If the postgres facade's `config` export has a default export rather than named exports, mirror its shape verbatim (`export { default } from '@prisma-next/postgres/config'` plus any named re-exports). Read [`packages/3-extensions/postgres/src/exports/config.ts`](../../../../../packages/3-extensions/postgres/src/exports/config.ts) before writing.

- `packages/3-extensions/prisma-postgres-serverless/src/exports/contract-builder.ts` — same shape as `config.ts`. Re-export from `@prisma-next/postgres/contract-builder`. Read [`packages/3-extensions/postgres/src/exports/contract-builder.ts`](../../../../../packages/3-extensions/postgres/src/exports/contract-builder.ts) before writing.

- `packages/3-extensions/prisma-postgres-serverless/src/exports/control.ts` — new file. Re-export from `@prisma-next/postgres/control`. Read [`packages/3-extensions/postgres/src/exports/control.ts`](../../../../../packages/3-extensions/postgres/src/exports/control.ts) before writing.

- `packages/3-extensions/prisma-postgres-serverless/package.json` — add `"./control": "./dist/control.mjs"` to the `exports` map (the other two paths already exist). Add `"@prisma-next/postgres": "workspace:0.12.0"` to `dependencies` (it is not currently there; verify before adding).

- `packages/3-extensions/prisma-postgres-serverless/tsdown.config.ts` — add `'src/exports/control.ts'` to the `entry` array (the other two are already there).

**Out:**

- The integration test rewrite. That is D3's scope. The partial test file at `test/integration/test/prisma-postgres-serverless/cloud-integration.test.ts` stays untouched in this dispatch (D3 will rewrite it from scratch using the surfaces this dispatch creates).

- Any of the WIP already on disk that's correct: workspace catalog `@prisma/management-api-sdk` entry; integration-tests `package.json` devDeps additions; `.github/workflows/ci.yml` env-var + require-token step; the doc updates in `projects/ppg-serverless/{spec.md, slices/06-…/spec.md, learnings.md}`. All keepers; do not touch.

- README updates for both packages. That is D4's scope.

- Any change to the facade's `runtime.ts`, the driver's `runtime.ts`, adapters, target packs, framework, or shared infrastructure. The dispatch is pure re-export wiring.

- `architecture.config.json` changes. If `lint:deps` fails because of layering, surface; the resolution decision belongs in a halt-and-discuss path, not silent amendment.

## Completed when

1. `pnpm install` succeeds. Re-running `pnpm install --frozen-lockfile` is idempotent (no further lockfile churn).
2. `pnpm --filter @prisma-next/driver-ppg-serverless build` exits 0. Inspect the output: `dist/control.mjs` materialises; `dist/runtime.mjs` does NOT import `pg` (verify with `grep -c "from 'pg'\\|require(['\"]pg['\"])" dist/runtime.mjs` returning 0).
3. `pnpm --filter @prisma-next/prisma-postgres-serverless build` exits 0. `dist/control.mjs`, `dist/config.mjs`, `dist/contract-builder.mjs` all materialise as real re-exports (not call-time-throwers; sanity-check by reading the emitted file — should be a few lines of `export …` statements, not `throw new Error('not implemented')`).
4. `pnpm --filter @prisma-next/driver-ppg-serverless typecheck` exits 0.
5. `pnpm --filter @prisma-next/prisma-postgres-serverless typecheck` exits 0.
6. `pnpm --filter @prisma-next/driver-ppg-serverless test` exits 0. 77 existing tests pass; no regressions.
7. `pnpm --filter @prisma-next/prisma-postgres-serverless test` exits 0. 20 existing facade tests pass; no regressions.
8. `pnpm lint:deps` exits 0.
9. `pnpm lint:manifests` exits 0.
10. No transient project IDs in source code added this dispatch (canonical regex per `.agents/rules/no-transient-project-ids-in-code.mdc` returns empty on the +diff; manual prose-attribution sweep empty).
11. No bare `as` casts in production code added this dispatch (re-exports are pure forwarding; should be zero).

## Standing instruction

Stay focused on the goal; control scope.

The goal is **one-import parity with `@prisma-next/postgres`** at the public surface. Re-exports are forwarding boilerplate, not new behaviour — if you find yourself authoring a wrapper class or rewrapping types, you've drifted off-goal; surface.

**Trivial-and-related fixes that serve the goal** (e.g. the package.json `exports` keys end up alphabetised; the tsdown `entry` array gets one new line that matches the existing pattern; the `dependencies` block stays alphabetised) — fine, in the same dispatch.

**Drift from the goal halts.** Examples:
- Renaming an existing export to be more consistent — halt.
- Adding a JSDoc paragraph explaining the re-export's purpose at a length that's more than 2-3 lines — halt; if the rationale is non-obvious, surface it for the spec, don't bury it in source.
- Touching anything in `src/runtime/` of either package — halt.

**Source-string rule:** the file headers in the new `control.ts` files are source-shipping content — neutral wording, no transient project IDs.

## Halt conditions

- `@prisma-next/postgres`'s `./config` or `./contract-builder` exports a value-side surface that can't be cleanly forwarded via `export * from` (e.g. a default export that needs to be re-aliased). Surface the shape and the proposed alias; don't guess.

- `@prisma-next/driver-postgres/control` has a type or runtime shape that doesn't match what the existing serverless facade's stubs declare (the stubs' `defineConfig` signature is `(options: PrismaPostgresServerlessConfigOptions) => never`; the real `defineConfig` from postgres has a different signature). Surface the delta; the resolution is likely "drop the stub interface and re-export the real types verbatim", but the type-flow change deserves a confirm before applying.

- Adding the workspace deps changes import-lint layering (`lint:deps`) — surface the violation; the resolution would need an `architecture.config.json` amendment, which is out of dispatch scope.

- Building the facade triggers a circular dependency through `@prisma-next/postgres`'s control / config / contract-builder packages — surface the cycle.

- The driver's `dist/runtime.mjs` is found to import `pg` after the build — this is the NFR2 invariant; if it fails, the dispatch's premise (tree-shaking keeps `/runtime` edge-clean) is wrong. Surface immediately; do not try to mask it with bundler tricks.

## References

- **Slice spec:** [`projects/ppg-serverless/slices/06-integration-tests-and-docs/spec.md`](../spec.md) — the resolved-with-cloud-PPG slice spec.
- **Slice plan:** [`projects/ppg-serverless/slices/06-integration-tests-and-docs/plan.md § Dispatch 2`](../plan.md) — sizing rationale.
- **Project spec D4:** [`projects/ppg-serverless/spec.md § D4`](../../../spec.md) — the architectural decision being implemented.
- **Project spec FR1, FR2:** same file — updated to reference the new exports.
- **Existing driver-postgres control export:** [`packages/3-targets/7-drivers/postgres/src/exports/control.ts`](../../../../../packages/3-targets/7-drivers/postgres/src/exports/control.ts) — what driver-ppg-serverless re-exports.
- **Existing postgres facade control export:** [`packages/3-extensions/postgres/src/exports/control.ts`](../../../../../packages/3-extensions/postgres/src/exports/control.ts) — what prisma-postgres-serverless re-exports.
- **Existing postgres facade config + contract-builder:** [`packages/3-extensions/postgres/src/exports/config.ts`](../../../../../packages/3-extensions/postgres/src/exports/config.ts), [`packages/3-extensions/postgres/src/exports/contract-builder.ts`](../../../../../packages/3-extensions/postgres/src/exports/contract-builder.ts) — what the facade's stubs get replaced by.
- **Existing facade stubs (to be replaced):** [`packages/3-extensions/prisma-postgres-serverless/src/exports/config.ts`](../../../../../packages/3-extensions/prisma-postgres-serverless/src/exports/config.ts), [`packages/3-extensions/prisma-postgres-serverless/src/exports/contract-builder.ts`](../../../../../packages/3-extensions/prisma-postgres-serverless/src/exports/contract-builder.ts).
- **Existing facade tsdown config:** [`packages/3-extensions/prisma-postgres-serverless/tsdown.config.ts`](../../../../../packages/3-extensions/prisma-postgres-serverless/tsdown.config.ts).
- **Project policy: single PR at project close-out.** Do not push or open a PR after this dispatch; commits accumulate on the existing branch. See `code-review.md § Orchestrator notes § Project policy`.
- **Standing rules:** `.agents/rules/no-transient-project-ids-in-code.mdc`, `.agents/rules/no-bare-casts.mdc` — both `alwaysApply: true`; apply to source-shipping content (including new `control.ts` files' headers).

## Edge cases

| Edge case | Disposition |
|---|---|
| **The postgres facade's `./control` exports `createPostgresControlClient` (a named function) plus the `ControlClient` type re-export.** The serverless facade's re-export must mirror that exactly. | Use `export * from '@prisma-next/postgres/control'`; this propagates both value and type exports. If `tsdown` produces a warning about type-only re-exports, surface. |
| **The postgres facade's `./config` exports `defineConfig` plus `PostgresConfigOptions` type.** The existing serverless stub declares a different-named `PrismaPostgresServerlessConfigOptions`. | Drop the stub's interface entirely; the re-export takes its place. The type-name change is a public surface change but in a stubbed surface that always threw anyway; not a regression. |
| **The postgres facade's `./contract-builder` exports `defineContract` plus a long list of type re-exports.** Same shape as above. | Drop the stub's bespoke signature; replace with `export * from '@prisma-next/postgres/contract-builder'`. |
| **`@prisma-next/postgres` brings transitive `pg` into the facade's `dependencies` install graph.** | Expected and intentional per D4. Verify NFR2 spirit by checking that `dist/runtime.mjs` does not import `pg` — that's the edge-cleanliness invariant. The dep-tree presence is fine; bundler tree-shaking is the safeguard. |
| **`lint:deps` complains that `@prisma-next/prisma-postgres-serverless` cannot depend on `@prisma-next/postgres` because both are at the same architectural layer (`3-extensions`).** | Halt; surface. The architecture rules in `architecture.config.json` may or may not permit same-layer deps; if they don't, the resolution is either a layer-rule change (out of dispatch scope) or restructuring (out of dispatch scope). |
| **`pnpm-lock.yaml` churn is larger than expected.** | The new workspace deps will add lockfile entries; that's expected. A diff much larger than ~10 lines is suspicious — surface and inspect before staging. |

## Operational metadata

- **Model tier:** Sonnet. The work is mechanical (re-export wiring + package.json + tsdown config) but spans multiple files; needs the small extra reasoning headroom over the cheapest tier for the edge cases (stub-interface deltas, NFR2 invariant check) without needing Opus.
- **Time-box:** 60 minutes wall-clock. Overrun → halt and surface.
- **Validation gate:** items 1–11 in § Completed when. The implementer runs the gate; the reviewer trusts the implementer's gate run and focuses on design judgment.
- **WIP heartbeat cadence:** standard per `drive-dispatch/agents/implementer.md` — update `wip/heartbeats/implementer.txt` at phase boundaries (post-driver-edits / post-facade-edits / post-build / post-test) and on any halt-condition trigger.

## Carry-over from prior rounds

None — this is round 1 of D2. The HALTED D1 attempt left some WIP on disk that this dispatch must NOT touch (catalog entry, integration-tests devDeps, workflow YAML, the partial test file). See § Scope § Out for the exhaustive list.

## Commit organisation

Suggested **two commits**:

1. Driver layer (`packages/3-targets/7-drivers/ppg-serverless/**`) — additive `./control` re-export.
2. Facade layer (`packages/3-extensions/prisma-postgres-serverless/**`) — three stub replacements + new `./control`.

A single squashed commit is also acceptable. Surface your choice in the wrap-up.

**No `git add -A`.** **No `--amend`.** **No push** (single PR at project close-out).
