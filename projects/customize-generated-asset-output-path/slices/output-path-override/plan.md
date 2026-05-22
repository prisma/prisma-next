# Slice plan: output-path-override

**Slice spec:** [`./spec.md`](./spec.md)
**Project spec:** [`../../spec.md`](../../spec.md)
**Project design notes:** [`../../design-notes.md`](../../design-notes.md)

Three sequential dispatches. Each follows the tests-before-implementation rule from AGENTS.md.

## Dispatch plan

### Dispatch 1: Mongo + Postgres wrappers accept `output` override

**Intent.** Add `output?: string` to `MongoConfigOptions` and `PostgresConfigOptions`; thread it into `ContractConfig.output` with `deriveOutputPath` as the fallback when the option is absent. Default behaviour byte-identical. No CLI changes in this dispatch. No SQLite changes.

**Files in play.**

- `packages/3-extensions/mongo/src/config/define-config.ts` — add field to `MongoConfigOptions`; change `const output = deriveOutputPath(...)` to `const output = options.output ?? deriveOutputPath(...)`.
- `packages/3-extensions/postgres/src/config/define-config.ts` — same change against `PostgresConfigOptions`.
- New: `packages/3-extensions/mongo/test/define-config.test.ts` (or extend an existing test file if one exists) — tests for: default behavior unchanged (edge case #1); explicit `output` honored (edge case #2); relative `output` resolved per spec (edge case #5); TS-authored contract receives the override (edge case #15).
- New: `packages/3-extensions/postgres/test/define-config.test.ts` (same test set as Mongo).
- **Slice-author decision:** if both wrappers' inline `deriveOutputPath` helpers can be lifted to a shared module in a single clean commit, do it. Otherwise leave inline. Per `design-notes.md § Open questions` working position.

**"Done when":**

- [ ] Tests added before implementation changes (golden rule).
- [ ] `pnpm test:packages -- @prisma-next/mongo` passes.
- [ ] `pnpm test:packages -- @prisma-next/postgres` passes.
- [ ] `pnpm typecheck` clean (workspace-wide; the wrapper option types change is a public surface).
- [ ] `pnpm lint:deps` clean.
- [ ] No `any`, no `@ts-expect-error`, no biome suppressions.
- [ ] If `deriveOutputPath` was lifted: confirm the new shared location is reachable from both wrappers and the import paths are clean (no layering violations).
- [ ] Intent-validation: diff is confined to the four named files (plus optionally the lifted helper); no scope creep into the CLI, the framework core, or SQLite.

**Edge cases covered (from slice spec):** #1, #2, #5, #15.

**Failure modes to avoid.**

- Don't change `getEmittedArtifactPaths` behaviour. The `.d.ts` derivation is unchanged.
- Don't migrate any existing `prisma-next.config.ts` to use the new option in this PR (Non-goal in the slice spec).
- Don't add validation logic in the wrapper — validation/warnings belong at the CLI emit entry point (dispatch 2).

**Out of scope (this dispatch).**

- The CLI `--output` flag and the precedence rule — that's dispatch 2.
- The integration / e2e test — that's dispatch 3.
- Documentation updates — that's dispatch 3.

**Size.** M (2 source files + 2 new test files; ~80-150 LoC including tests; one agent session). Cap respected.

---

### Dispatch 2: CLI `--output` flag + control-API precedence + soft warnings

**Intent.** Add `--output <path>` to the `prisma-next contract emit` command. Thread it into the control-API operation so it overrides `contractConfig.output` at the entry point. Emit soft warnings for non-`.json` extensions and directory-shaped paths. CLI > config > default precedence holds.

**Files in play.**

- `packages/1-framework/3-tooling/cli/src/commands/contract-emit.ts` — add `--output` flag definition; forward into the control-API call. Slice author confirms the exact arg-parsing infra in use (likely an existing flag-definition pattern).
- `packages/1-framework/3-tooling/cli/src/control-api/operations/contract-emit.ts` — accept an optional CLI override; resolve precedence at the point where `getEmittedArtifactPaths(contractConfig.output)` is called today; emit soft warnings via the same diagnostic mechanism the operation already uses.
- New: a CLI-level test file for `contract-emit` covering the flag (or extend the existing one if any) — tests for edge cases #3, #4, #6, #7, #8, #9, #13.
- **Slice-author may discover:** an args type, a control-API descriptor, or a help-text surface that also needs updating. Per `plan.md § Risks`, expect 2-4 CLI files rather than exactly 2.

**"Done when":**

- [ ] Tests added before implementation changes.
- [ ] `pnpm test:packages -- @prisma-next/cli` passes (or whichever scope covers the CLI command + operation).
- [ ] `pnpm test:packages` passes globally.
- [ ] `pnpm typecheck` clean.
- [ ] `pnpm lint:deps` clean.
- [ ] No `any`, no `@ts-expect-error`, no biome suppressions.
- [ ] All path manipulation in new code uses `pathe`, not `node:path`.
- [ ] Soft-warning surface is the same one the CLI emit path already uses (no new diagnostic infrastructure).
- [ ] Intent-validation: diff is confined to the CLI surface; no changes to `ContractConfig`, `getEmittedArtifactPaths`, `normalizeContractConfig`, or the extension wrappers.

**Edge cases covered (from slice spec):** #3, #4, #6, #7, #8, #9, #13.

**Failure modes to avoid.**

- Don't introduce hard validation. Soft warnings only (#11, #12 are explicitly out — no traversal blocking).
- Don't widen the override scope. `--output` only takes effect for the `contract emit` command, not for other CLI commands.
- Don't change the resolution base for the *config-file* value. The CLI flag resolves against cwd (CLI convention); the config-file value already resolves against the config-file directory via existing plumbing.

**Out of scope (this dispatch).**

- The wrapper changes — dispatch 1.
- The integration / e2e test — dispatch 3.
- Documentation — dispatch 3.

**Size.** M (2-4 CLI files + 1 test file; ~120-200 LoC including tests; one agent session). Cap respected.

---

### Dispatch 3: End-to-end integration test + documentation

**Intent.** Land one end-to-end test that exercises the full path (config override → CLI emit → artifacts at the requested location, both `.json` and `.d.ts`). Land the documentation update describing the new option, its default, and the precedence rule.

**Files in play.**

- New: a test file under `test/integration/test/` (or wherever the existing emit integration tests live; slice author confirms the convention) that runs `prisma-next contract emit` against a Mongo or Postgres fixture with `output` set, and asserts the artifacts land at the override path with byte-identical content to the default-path run.
- Documentation update in whichever surface is the canonical home for `defineConfig` options docs (slice author picks — likely a subsystem doc, the CLI reference, or both). One section covering: the option, its type, its default, its resolution rules, and the CLI flag precedence.

**"Done when":**

- [ ] Test added before docs.
- [ ] `pnpm test:integration` passes including the new test.
- [ ] `pnpm fixtures:check` clean — no fixture drift introduced.
- [ ] `pnpm build` clean.
- [ ] Docs render cleanly (any link-checking script in the repo passes).
- [ ] Manual-QA scripted: README-style steps to reproduce the test's behavior locally; one run report logged to `wip/manual-qa-output-path-override.md` (gitignored per `wip/` convention).
- [ ] Intent-validation: diff is confined to the new integration test + the chosen docs surface.

**Edge cases covered (from slice spec):** end-to-end validation of #2 + #4 (byte-identical artifacts at the requested path; CLI > config precedence).

**Failure modes to avoid.**

- Don't migrate existing demos/examples to use the new option in this dispatch (Non-goal).
- Don't extend the docs into deep design rationale; the design lives in `projects/customize-generated-asset-output-path/design-notes.md`. The docs are the user reference.

**Out of scope (this dispatch).**

- The wrapper changes — dispatch 1.
- The CLI flag — dispatch 2.

**Size.** S (1-2 new files; ~50-80 LoC including the test; one agent session). Cap respected.

---

## Validation gates (slice-level rollup)

The slice merges only when, on the final round, all of these pass:

- `pnpm build`
- `pnpm typecheck`
- `pnpm lint:deps`
- `pnpm test:packages`
- `pnpm test:integration`
- `pnpm test:e2e`
- `pnpm fixtures:check`
- Manual-QA note in `wip/manual-qa-output-path-override.md`
- Reviewer subagent `SATISFIED` verdict in `projects/customize-generated-asset-output-path/reviews/code-review.md`.

## Open items

_Surfaced during slice execution; resolved before the slice closes._

- Whether to extract `deriveOutputPath` into `@prisma-next/config` (dispatch 1 working position: yes if clean 1-file lift, else no).
- The exact docs surface for the new option (dispatch 3 working position: slice author picks the closest existing home — CLI reference, subsystem doc, or both).
