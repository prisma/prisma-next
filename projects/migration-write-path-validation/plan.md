# Migration write-path validation — Plan

This plan describes how we execute the [spec](./spec.md). All work lands as a single PR (the scope is one CodeRabbit finding split across two files); the phases below are commit-as-you-go slices, not separate PRs.

## Sequencing rationale

Three independent throws, plus one schema-extraction refactor that two of them depend on. Order:

1. **Schema extraction first.** Pure refactor, no behaviour change. Apply-time path keeps passing on the existing `io.test.ts`. Lands as a green-on-green commit so the rest of the work has a clean base.
2. **Operation-entry validation second.** Depends on (1). Adds the new `MIGRATION.INVALID_OPERATION_ENTRY` code, the import in `migration-base.ts`, and the builder-side throw. Tests in `migration-base.test.ts`.
3. **Bookend-mismatch validation third.** Independent of (1) and (2). Adds the new `MIGRATION.STALE_CONTRACT_BOOKENDS` code and a helper in `migration-base.ts` (or a small private function) that runs before `buildAttestedMetadata` synthesises the result. Tests in `migration-base.test.ts`.
4. **Parse-error fast-fail last.** Independent of the others, but lands last because it changes the CLI test surface (one new test, no changes to existing tests). Distinguishes the existing happy path (file missing → `null` is unchanged) from the new throw (file present-but-malformed). Test in `migration-cli.test.ts`.

Each phase is test-first: red → green → commit.

## Milestone identifiers

Phase numbers double as orchestration milestone identifiers. The skill expects `m<N>`-style IDs; this plan uses `m1` … `m5` as aliases for Phase 1 … Phase 5.

| Milestone | Phase                                                              |
|-----------|--------------------------------------------------------------------|
| `m1`      | Phase 1 — Extract `op-schema.ts`                                   |
| `m2`      | Phase 2 — Operation-entry validation in `buildMigrationArtifacts`  |
| `m3`      | Phase 3 — Bookend-mismatch validation in `buildMigrationArtifacts` |
| `m4`      | Phase 4 — Parse-error fast-fail in `MigrationCLI`                  |
| `m5`      | Phase 5 — Wrap-up                                                  |

## Validation gates

Each milestone declares an explicit validation gate — the harness commands that must all pass before the milestone is considered done. Inferred from the project's existing `pnpm` scripts and the surface each milestone touches.

**`m1` (op-schema extraction; touches only `@prisma-next/migration-tools`):**

- `pnpm --filter @prisma-next/migration-tools typecheck`
- `pnpm --filter @prisma-next/migration-tools test`
- `pnpm --filter @prisma-next/migration-tools lint`

**`m2` (operation-entry validation; touches only `@prisma-next/migration-tools`):**

- `pnpm --filter @prisma-next/migration-tools typecheck`
- `pnpm --filter @prisma-next/migration-tools test`
- `pnpm --filter @prisma-next/migration-tools lint`

**`m3` (bookend-mismatch validation; touches only `@prisma-next/migration-tools`):**

- `pnpm --filter @prisma-next/migration-tools typecheck`
- `pnpm --filter @prisma-next/migration-tools test`
- `pnpm --filter @prisma-next/migration-tools lint`

**`m4` (CLI parse-error fast-fail; touches `@prisma-next/cli` and may touch `@prisma-next/migration-tools` exports):**

- `pnpm --filter @prisma-next/cli typecheck`
- `pnpm --filter @prisma-next/cli test`
- `pnpm --filter @prisma-next/cli lint`
- `pnpm --filter @prisma-next/migration-tools typecheck` (in case a subpath export was added)
- `pnpm --filter @prisma-next/migration-tools test`
- `pnpm --filter @prisma-next/migration-tools lint`

**`m5` (wrap-up; verifies the whole branch is clean):**

- `pnpm typecheck:packages`
- `pnpm test:packages`
- `pnpm lint:packages`
- `pnpm lint:deps`
- `pnpm --filter @prisma-next/migration-tools build` (refresh declarations)
- Spot-check: re-emit one example migration locally to confirm the happy path still works end-to-end.

A gate failure is a hard pause: surface to the orchestrator. Pre-existing flakes/failures unrelated to the milestone are escalated rather than silently fixed.

## Phase 1 — Extract `op-schema.ts` (`m1`)

Pure refactor. No behaviour change.

**What changes**
- New file `packages/1-framework/3-tooling/migration/src/op-schema.ts` exporting `MigrationOpSchema` and `MigrationOpsSchema`.
- `packages/1-framework/3-tooling/migration/src/io.ts` imports both from `./op-schema` instead of declaring them inline.

**Tests**
- No new tests. The existing `io.test.ts` covers the apply-time validation of the operations schema; if those pass after the refactor, the schema move is behavior-neutral.

**Acceptance**
- `pnpm --filter @prisma-next/migration-tools test` is green.
- The schema's JSDoc note ("Intentionally shallow…") moves with the schema into `op-schema.ts`.

**Commit**
- `refactor(migration-tools): extract MigrationOpSchema into op-schema.ts`

## Phase 2 — Operation-entry validation in `buildMigrationArtifacts` (`m2`)

Depends on Phase 1.

**Tests first** (in `packages/1-framework/3-tooling/migration/test/migration-base.test.ts`, inside the existing `describe('buildMigrationArtifacts', …)` block):
- `it('throws MIGRATION.INVALID_OPERATION_ENTRY when an entry is missing id')` — assert thrown error has `code: 'MIGRATION.INVALID_OPERATION_ENTRY'` and `details.index === 0`.
- `it('throws MIGRATION.INVALID_OPERATION_ENTRY when an entry is missing label')` — same, asserts on the index of the offending entry.
- `it('throws MIGRATION.INVALID_OPERATION_ENTRY when an entry is missing operationClass')`.
- `it('throws MIGRATION.INVALID_OPERATION_ENTRY when operationClass is outside the allowed union')` (e.g. `'unknown'`).
- `it('reports the offending entry index when later entries in the array are malformed')` — at least one well-formed entry preceding a malformed one, asserts `details.index` is the malformed entry's index.
- Negative regression: the existing `it('throws when operations is not an array')` test stays as-is; we don't change the `Array.isArray` branch.

**Implementation**
- In `migration-base.ts`, add `errorInvalidOperationEntry` to the imports from `./errors`.
- After the `Array.isArray(ops)` check in `buildMigrationArtifacts`, iterate the array with `MigrationOpSchema(entry)` (or use `.array()` / `.allows()` — to be decided by the implementer, with index-tracking either via the array index in the loop or arktype's path metadata). The first failure throws `errorInvalidOperationEntry(index, summary)`.
- The check fires *before* `deriveProvidedInvariants(ops)` (which today is called via `buildAttestedMetadata`); this ordering ensures malformed entries surface as `INVALID_OPERATION_ENTRY` rather than as `INVALID_INVARIANT_ID` for the subset of cases where both could fire.
- Add `errorInvalidOperationEntry(index, reason)` to `errors.ts` next to `errorInvalidManifest`. Follow the existing helper style (constructor with `code`, `summary`, `{ why, fix, details }`).

**Acceptance**
- New tests green; existing tests in `migration-base.test.ts` and `io.test.ts` unchanged and green.

**Commit**
- `feat(migration-tools): validate operation entries in buildMigrationArtifacts`

## Phase 3 — Bookend-mismatch validation in `buildMigrationArtifacts` (`m3`)

Independent of Phases 1–2.

**Tests first** (in `migration-base.test.ts`, inside the existing `describe('buildMigrationArtifacts', …)` block):
- `it('throws MIGRATION.STALE_CONTRACT_BOOKENDS when existing.fromContract.storage.storageHash !== meta.from')` — assert `code === 'MIGRATION.STALE_CONTRACT_BOOKENDS'` and `details.side === 'from'`, `details.metaHash`, `details.contractHash`.
- `it('throws MIGRATION.STALE_CONTRACT_BOOKENDS when existing.toContract.storage.storageHash !== meta.to')` — symmetric.
- `it('skips the from-side bookend check when meta.from is empty and existing.fromContract is null')` — origin-less initial migration; no throw.
- `it('does not throw when existing bookends agree with meta')` — regression check; the existing `'preserves contract bookends'` test already covers the happy path but explicit coverage is cheap.
- `it('throws when existing.toContract.storage.storageHash is missing')` — defensive: a malformed `toContract` (e.g. `{}`) is not equivalent to "no bookend"; treat absence-when-present as mismatch.

**Implementation**
- In `migration-base.ts`, add `errorStaleContractBookends` to the imports from `./errors`.
- Add a small private helper `assertBookendsMatchMeta(meta, existing)` (or inline; implementer's call) that:
  1. If `existing?.fromContract != null`, reads `existing.fromContract.storage?.storageHash` and throws if it's missing or doesn't equal `meta.from`.
  2. If `existing?.toContract != null`, reads `existing.toContract.storage?.storageHash` and throws if it's missing or doesn't equal `meta.to`.
- Call the helper at the top of `buildAttestedMetadata` (after the `meta` and `existing` are in hand, before the synthesis path runs).
- Add `errorStaleContractBookends({ filePath?, side, metaHash, contractHash })` to `errors.ts`. The `filePath` parameter is optional because the builder doesn't know the on-disk path — the CLI does. For now we omit `filePath` from `details` (the diagnostic's `why` is informative without it; the file location is implicit from the error context). If we later want to thread the path through, we add an optional parameter to `buildMigrationArtifacts` as a follow-up.

**Acceptance**
- New tests green; existing tests in `migration-base.test.ts` and `migration-cli.test.ts` (specifically `'preserves contract bookends from a previously-scaffolded migration.json'`) unchanged and green.

**Commit**
- `feat(migration-tools): fail-fast on stale contract bookends in buildMigrationArtifacts`

## Phase 4 — Parse-error fast-fail in `MigrationCLI` (`m4`)

Independent of Phases 1–3.

**Tests first** (in `packages/1-framework/3-tooling/cli/test/migration-cli.test.ts`):
- `it('exits non-zero with MIGRATION.INVALID_JSON when migration.json is unparseable')` — write a non-JSON string to `join(workDir, 'migration.json')` before invoking `MigrationCLI.run`. Assert `process.exitCode === 1`, stderr text contains the structured-error summary (`'Invalid JSON in migration file'`), no `ops.json` is written.
- The existing `'writes ops.json + migration.json under the migration directory on success'` test continues to cover the file-absent → synthesis path.
- The existing `'preserves contract bookends from a previously-scaffolded migration.json'` test continues to cover the file-present-and-valid path.

**Implementation**
- In `packages/1-framework/3-tooling/cli/src/migration-cli.ts`, change `readExistingMetadata` so:
  - File missing (the existing `try { readFileSync } catch { return null }` block) — unchanged, returns `null`.
  - Parse failure (the existing `try { JSON.parse } catch { return null }` block) — instead of swallowing, throw `errorInvalidJson(metadataPath, e.message)` from `@prisma-next/migration-tools/errors`.
- `errorInvalidJson` already exists in `migration/src/errors.ts`. Re-export from a CLI-accessible path (it's already imported by `io.ts`; verify the CLI can reach it — the CLI imports `MigrationMetadata` from `@prisma-next/migration-tools/metadata`, so an import from `@prisma-next/migration-tools/errors` is the natural sibling). If `@prisma-next/migration-tools` doesn't currently export `errors`, add a subpath export; if it does, just import.
- The `MigrationCLI.run` `try/catch` already handles `CliStructuredError` and bare `Error`. `MigrationToolsError` extends `Error`, so the existing fallback (`err instanceof Error ? err.message : String(err)`) prints the summary; we may want to extend the catch to specifically handle `MigrationToolsError.is(err)` so the `: ${err.why}` formatting matches the `CliStructuredError` branch. Implementer decides; the spec only requires that the diagnostic surfaces.

**Acceptance**
- New test green; all existing `migration-cli.test.ts` tests unchanged and green.

**Commit**
- `feat(cli): fail-fast on unparseable migration.json in MigrationCLI`

## Phase 5 — Wrap-up (`m5`)

**Tasks**
- Run `pnpm test:packages` from the repo root. Fix any incidental breakage.
- Run `pnpm lint:deps` from the repo root. Verify no new layering violations (none expected — all changes are within `migration` and `cli`).
- Run `pnpm build` for `@prisma-next/migration-tools` to refresh declarations. The error-helper additions don't change any exported types (helpers stay package-private), but a build verifies nothing leaks.
- Spot-check: re-emit one example migration locally (e.g. `node packages/3-targets/3-targets/postgres/test/.../migration.ts`) to confirm the happy path still works end-to-end.
- Update Linear TML-2271 status to "In Review" when the PR opens.

**Commit**
- No code commit if everything is green. If incidental fixes appear, group by concern (one commit per concern).

## Risk register

- **Schema-import cycle.** `io.ts` and `migration-base.ts` both importing from `op-schema.ts` should not introduce a cycle (op-schema has no internal dependencies). Verify after Phase 1.
- **Errors subpath export.** If `@prisma-next/migration-tools/errors` isn't currently a public subpath, adding it changes the package surface. The simpler alternative is to import the error helper through whatever path is already exposed. Decision deferred to Phase 4 implementer; the spec doesn't constrain the import path.
- **Test parallelism + tmp dirs.** The existing `migration-cli.test.ts` already uses `mkdtempSync` per test; the new test follows the same pattern and should not introduce ordering coupling.
- **Bookend check + existing fixture data.** If any committed `migration.json` in the repo has a stale bookend, the next re-emit (e.g. via a test that exercises `MigrationCLI.run` with a pre-existing file) will throw. We expect zero such cases (the example-emit tests start from clean tmpdirs). If the test suite turns one up, we re-emit it as part of this PR.

## Out of scope (will not do as part of this work)

- Removing `fromContract` / `toContract` from the manifest (TML-2274).
- Reworking the `kind` discriminator (TML-2270).
- Adding deep `Contract` validation to the bookend check (the storage-hash equality is the invariant; deeper validation is owned elsewhere).
- Surfacing all malformed operation entries in a single throw (we surface the first; author re-runs after fixing).
- Replacing the hand-rolled CLI arg parser (TML-2318).
