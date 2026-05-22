# Slice spec: output-path-override

**Project:** [`../../spec.md`](../../spec.md)
**Linear ticket:** [TML-2664](https://linear.app/prisma-company/issue/TML-2664/mongo-feature-request-customize-generated-asset-output-path) — the slice shares the project's Linear surface; no separate slice issue.

This slice is the project's only slice. The project spec + design notes are authoritative for the *what* and *why*; this slice spec focuses on the *what-changes-where*, the edge-case map, and the slice-DoD.

# Scope

## In scope

- Add an optional `output?: string` field to `MongoConfigOptions` in `packages/3-extensions/mongo/src/config/define-config.ts`. When provided, use it; when absent, fall back to the existing `deriveOutputPath(options.contract)`.
- Add the same field to `PostgresConfigOptions` in `packages/3-extensions/postgres/src/config/define-config.ts`. Identical semantics.
- Add a `--output <path>` flag to `prisma-next contract emit` in `packages/1-framework/3-tooling/cli/src/commands/contract-emit.ts`.
- Thread the CLI value through `packages/1-framework/3-tooling/cli/src/control-api/operations/contract-emit.ts` so it overrides `contractConfig.output` at the point where `getEmittedArtifactPaths` is called.
- Soft warnings (using whatever diagnostic mechanism the CLI emit path already uses) when:
  - The supplied path doesn't end in `.json`.
  - The supplied path resolves to a directory (e.g. ends in `/` or names an existing directory).
- Path resolution: relative paths resolve against the directory containing the `prisma-next.config.ts` file when the config-file value is used. When the CLI flag is used and the value is relative, resolve against the cwd (consistent with other CLI path args).
- Unit tests for both wrappers verifying the option is threaded into `ContractConfig.output`.
- CLI tests verifying the flag is accepted, the precedence rule (CLI > config > default) holds, and the default-unchanged invariant holds.
- One end-to-end / integration test (one target is sufficient) that runs `prisma-next contract emit` against a fixture with an `output` override and asserts the artifacts land at the requested path.
- A short documentation update covering the new knob, its default, and the precedence rule. Land it wherever the existing `defineConfig` options are documented; if no such section exists, the slice author picks the closest home (likely the Contract Emitter subsystem doc or the CLI reference).

## Out of scope

- Any change to `@prisma-next/sqlite` (no wrapper exists; tracked at [TML-2677](https://linear.app/prisma-company/issue/TML-2677/add-prisma-nextsqliteconfig-defineconfig-wrapper-at-parity-with-mongo)).
- Any change to `ContractConfig.output`'s underlying semantics or to `getEmittedArtifactPaths`.
- Adding a `--output` flag to commands other than `contract emit` (e.g. `migrate` doesn't get one).
- Updating existing demo / example `prisma-next.config.ts` files to *use* the new option. Keeping the existing examples on the default path is the right baseline; users discover the option via docs, not via examples.
- Modifying the `contract-space-package-layout` rule beyond an optional one-line "convention, not mandate" clarification at close-out.

# Approach

The two `defineConfig` wrappers each gain one option in their options interface and one line of fallback logic:

```ts
export interface MongoConfigOptions {
  readonly contract: string;
  readonly output?: string;  // ← new
  readonly db?: { readonly connection?: string };
}

export function defineConfig(options: MongoConfigOptions): PrismaNextConfig<'mongo', 'mongo'> {
  const output = options.output ?? deriveOutputPath(options.contract);  // ← was: `const output = deriveOutputPath(options.contract);`
  // rest unchanged
}
```

The Postgres wrapper gets the same change against `PostgresConfigOptions`. Both wrappers already carry an identical inline `deriveOutputPath` helper; the slice author decides whether to lift it (extract into a shared module that both wrappers import) or leave it inline. Working position from `design-notes.md § Open questions`: extract only if the move is a clean 1-file lift; otherwise leave inline and let TML-2677 do the extraction.

The CLI flag adds an `--output` option that the command parses and forwards into the control-API operation. Inside `contract-emit.ts` (control-API), the operation prefers the CLI override when present, falling back to `contractConfig.output`, falling back to the normalizer's default:

```ts
// pseudo-code; slice author writes the actual change against current shape
const resolvedOutput = cliOutputOverride ?? contractConfig.output;
const paths = getEmittedArtifactPaths(resolvedOutput);
```

Soft warnings fire at the same entry point. Validation policy: warn-then-continue, never throw.

Tests follow the AGENTS.md "tests before implementation" golden rule: each dispatch starts by adding the failing tests for that dispatch's behavior, then implementing.

# Example-Mapping edge cases

Pre-named edge cases with dispositions per `drive-specify-slice § Step 6`. Severity discipline per `drive-build-workflow § Findings discipline`.

| # | Edge case | Disposition |
|---|---|---|
| 1 | `output` unset; `--output` absent. | **Handle** — invariant I-output-1 (default behaviour byte-identical). Covered by a regression test that snapshots emit output for the existing Mongo + Postgres fixtures. |
| 2 | `output` set in config; `--output` absent. | **Handle** — output lands at the config path. Covered by wrapper unit tests + the end-to-end test. |
| 3 | `output` unset in config; `--output` passed on CLI. | **Handle** — output lands at the CLI path. Covered by CLI test. |
| 4 | `output` set in config; `--output` also passed. | **Handle** — CLI wins (invariant I-output-4). Covered by CLI test. |
| 5 | `output` path is relative, config value. | **Handle** — resolves against the directory containing `prisma-next.config.ts`. Covered by wrapper unit test + integration test. |
| 6 | `output` path is relative, CLI value. | **Handle** — resolves against cwd (CLI convention). Covered by CLI test. |
| 7 | `output` path is absolute. | **Handle** — used as-is. Covered by CLI test. |
| 8 | `output` path has a non-`.json` extension (e.g. `./generated/contract.txt`). | **Handle** — soft warning emitted; proceed with the requested path. The `.d.ts` companion still derives by suffix substitution; the warning surfaces in test output. |
| 9 | `output` path looks like a directory (trailing `/` or matches an existing directory). | **Handle** — soft warning emitted; proceed (writes will fail at the file-creation step, which is the expected error mode). |
| 10 | `output` path's parent directory does not exist. | **Handle** — `mkdir -p` of the parent runs as today (FR7); no change in behavior. |
| 11 | `output` path traverses outside the project root (e.g. `../../../../tmp/contract.json`). | **Explicitly out** — no hard validation; soft warnings handle the obvious-looking cases (extension, directory shape) only. Path-traversal blocking is a separate security concern, not part of this slice. |
| 12 | `output` path points inside `node_modules`. | **Explicitly out** — same rationale as #11. |
| 13 | Output path collides with the contract source file (`contract` and `output` both point at `./src/contract.prisma`). | **Handle** — emit would overwrite the source; existing `mkdir`/`writeFile` behavior would do the overwrite; a soft warning fires. The slice does **not** add overwrite-protection logic. |
| 14 | `output` set on a contract that has no `.json` extension. | **Handle** — the value is used verbatim; no extension manipulation. Soft warning per #8 if the extension is wrong. |
| 15 | Wrapper called with `output` but the contract is a TS-authored contract (`.ts` extension). | **Handle** — both wrappers already special-case `.ts` and route to `typescriptContractFromPath(options.contract, output)`. The `output` option threads in the same way. Covered by wrapper unit test. |

# Slice DoD

- [ ] **SDoD1.** All pre-named edge cases (#1-10, #13-15) handled with corresponding tests; #11-12 explicitly documented as out-of-scope (no test required).
- [ ] **SDoD2.** Unit tests for both wrappers green: `pnpm test:packages -- @prisma-next/mongo` and `pnpm test:packages -- @prisma-next/postgres` (or workspace equivalent).
- [ ] **SDoD3.** CLI tests green covering the flag, the precedence rule, and the default-unchanged invariant.
- [ ] **SDoD4.** End-to-end / integration test green confirming an `output` override produces artifacts at the requested path.
- [ ] **SDoD5.** `pnpm fixtures:check` clean — no fixture drift introduced.
- [ ] **SDoD6.** `pnpm lint:deps` clean.
- [ ] **SDoD7.** `pnpm typecheck` clean across the workspace.
- [ ] **SDoD8.** `pnpm build` clean.
- [ ] **SDoD9.** `pnpm test:packages`, `pnpm test:integration`, `pnpm test:e2e` all green.
- [ ] **SDoD10.** No `any`, no `@ts-expect-error` outside negative type tests, no biome suppressions added.
- [ ] **SDoD11.** All path manipulation uses `pathe`, not `node:path` (per `.cursor/rules/use-pathe-for-paths.mdc`).
- [ ] **SDoD12.** Documentation update landed in the chosen surface.
- [ ] **SDoD13.** Reviewer subagent reports `SATISFIED` per `drive-build-workflow`.
- [ ] **SDoD14.** Manual-QA: emit a fixture contract twice, once with the default path and once with `--output ./tmp-out/contract.json`, and confirm both produce byte-identical JSON content at the respective paths. Land the run as a `wip/manual-qa-output-path-override.md` note (gitignored).

# References

- Project spec: [`../../spec.md`](../../spec.md)
- Project design notes: [`../../design-notes.md`](../../design-notes.md)
- Project plan: [`../../plan.md`](../../plan.md)
- Linear ticket: [TML-2664](https://linear.app/prisma-company/issue/TML-2664/mongo-feature-request-customize-generated-asset-output-path)
- SQLite follow-up: [TML-2677](https://linear.app/prisma-company/issue/TML-2677/add-prisma-nextsqliteconfig-defineconfig-wrapper-at-parity-with-mongo)
- Reference implementations (Mongo + Postgres current state):
  - `packages/3-extensions/mongo/src/config/define-config.ts`
  - `packages/3-extensions/postgres/src/config/define-config.ts`
