# Plan — Tighten the migration manifest

- **Spec**: [spec.md](./spec.md)
- **Linear**: [TML-2270](https://linear.app/prisma-company/issue/TML-2270/remove-kind-regular-or-baseline-from-migration-manifest-origin)
- **Sequencing**: a single PR, but staged commits (commit-as-you-go) so review can be done step-by-step.

## Strategy

Two cleanups land together because they share a hash-regeneration sweep:

1. **Drop `kind`** from author-facing types, on-disk schema, scaffolders, display, and tests.
2. **Flip `from` to `string | null`** so `Migration.describe()` agrees with `Migration.origin` on nullability; baselines persist `"from": null` instead of the sentinel string `"sha256:empty"` (or `""`).

Both changes alter the input to `computeMigrationHash`, so every existing on-disk `migration.json` needs to be regenerated. Doing them in one sweep is one regen pass over ~98 files instead of two.

The schema-tightening commits and the fixture-update commit must land consecutively, because the type/schema change is what causes the loader's stored-vs-computed `migrationHash` check to fail on the unregenerated fixtures. Architecture-doc commits can land independently.

## Tests first

Per the repo rule "always write tests before creating or modifying implementation", each implementation step is preceded by a failing-test step (or the implementation step explicitly notes that the existing test suite already exercises the behaviour to-be-changed and just needs updating).

Three new test cases drive this work directly:

- **T1** — `MigrationMetadataSchema` rejects manifests carrying a `kind` field. *(io.test.ts: replace the existing "errors when kind has invalid value" case with an "errors when kind is present" case, since arktype rejects unknown keys by default.)*
- **T2** — `MigrationMetadataSchema` accepts `"from": null` and rejects `"from": ""`. *(io.test.ts.)*
- **T3** — `Migration.origin` returns `null` when `describe().from === null`, and `{ storageHash }` otherwise. *(migration-base.test.ts: tighten existing assertion.)*

Existing tests that assert `manifest.kind === 'regular'` or that synthesise `from: EMPTY_CONTRACT_HASH` / `from: 'sha256:empty'` for baseline cases will start failing once the field is removed/nullable. They're updated in the same commit that flips the type.

## Tasks

### Task 1 — Architecture docs

Update the two architecture docs that mention `kind` in `strippedManifest` / `strippedMeta` and clarify `from`'s nullability.

- `docs/architecture docs/subsystems/7. Migration System.md` — the "Storage-only identity" paragraph: drop `kind` from the `strippedManifest` list; in any prose that references `from`/`to` storage hashes, note that `from` is `string | null` (with `null` denoting baseline / no prior state).
- `docs/architecture docs/adrs/ADR 199 - Storage-only migration identity.md` — same fix in the "Decision" paragraph; add a short "Revised: <date> — `kind` removed; `from` is now nullable (TML-2270)" note at the top.

**Done when**: both docs no longer mention `kind` as a strippedManifest member; the ADR 199 revision note is present; the prose is consistent with `from: string | null`.

**Commit**: `docs(migration): drop \`kind\` from strippedManifest list, note \`from\` nullability (TML-2270)`

This commit can land first because it has no code coupling.

### Task 2 — Tighten schemas + drop `kind` + flip `from` nullability

Single commit that lands the type/schema change *and* the corresponding test updates atomically. After this commit, unit tests pass but the **example integration/e2e tests fail** because their on-disk `migration.json` files still carry `kind` and `"from": "sha256:empty"` and the loader rejects them. Fixed in Task 3.

**Test changes (write first, expected to fail)**:

- `packages/1-framework/3-tooling/migration/test/io.test.ts` —
  - Replace the "errors when kind has invalid value" case with a "rejects manifest carrying kind" case (covers T1).
  - Add "accepts `from: null`" and "rejects `from: ''`" cases (covers T2).
- `packages/1-framework/3-tooling/migration/test/migration-base.test.ts` —
  - Drop `expect(metadata.kind).toBe('regular')`.
  - Tighten the `Migration.origin` assertion to cover both branches: `from: null` ⇒ `origin === null`, `from: 'sha256:abc'` ⇒ `origin === { storageHash: 'sha256:abc' }` (covers T3).
- `packages/1-framework/3-tooling/migration/test/hash.test.ts` —
  - Drop `kind: 'regular' as const` from the in-memory metadata literal.
  - Update any test that hashes a manifest with `from: 'sha256:empty'` so it uses `from: null` for the baseline case.
- `packages/1-framework/3-tooling/migration/test/fixtures.ts` —
  - Drop `kind: 'regular'` from `createTestMetadata`'s base metadata.
  - Decide on a sensible default for `from` in test fixtures: keep `'sha256:empty'`-style strings for non-baseline tests, switch baseline-flavoured tests to `null`. Most existing call sites pass an explicit `from`, so the default is mostly cosmetic.
- `packages/1-framework/3-tooling/cli/test/commands/{migration-plan,migration-apply,migration-show,migration-ref,migration-e2e,migration-tamper}.test.ts` —
  - Drop every `kind: 'regular'` literal in test fixture builders and every `expect(...).kind` assertion.
  - Where a baseline migration is constructed with `from: 'sha256:empty'` or `from: EMPTY_CONTRACT_HASH`, change to `from: null`.
  - Where a test asserts on baseline-ness, switch to `expect(manifest.from).toBeNull()`.
- `packages/1-framework/3-tooling/cli/test/migration-cli.test.ts` — same treatment.
- `examples/{mongo-demo,retail-store}/test/manual-migration.test.ts` — drop `expect(manifest.kind).toBe('regular')` from the "migration.json has expected structure" cases.

**Implementation changes — drop `kind`**:

- `packages/1-framework/3-tooling/migration/src/migration-base.ts`:
  - Remove `kind?: 'regular' | 'baseline'` from `MigrationMeta` and from `MigrationMetaSchema`.
  - Remove `kind: meta.kind ?? 'regular'` from `buildAttestedMetadata`.
  - Update the JSDoc that mentions "the `describe()`-derived fields (`from`, `to`, `kind`)".
- `packages/1-framework/3-tooling/migration/src/metadata.ts`:
  - Remove `readonly kind: 'regular' | 'baseline'` from `MigrationMetadata`.
- `packages/1-framework/3-tooling/migration/src/io.ts`:
  - Remove `kind: "'regular' | 'baseline'"` from `MigrationMetadataSchema`.
- `packages/1-framework/3-tooling/cli/src/commands/migration-new.ts`, `migration-plan.ts`:
  - Remove `kind: 'regular'` from the synthesized `baseMetadata`.
- `packages/1-framework/3-tooling/cli/src/commands/migration-show.ts`:
  - Remove `kind` from `MigrationShowResult` and from the result-construction at the bottom of `executeMigrationShowCommand`.
- `packages/1-framework/3-tooling/cli/src/utils/formatters/migrations.ts`:
  - Remove the `kind` line from the human-readable `migration show` formatter (and the field from the consumed shape).
- `packages/3-mongo-target/1-mongo-target/src/core/render-typescript.ts`:
  - Remove `kind?: string` from `RenderMigrationMeta`; remove the `if (meta.kind) { lines.push(...) }` branch in `buildDescribeMethod`.
- `packages/3-mongo-target/1-mongo-target/src/core/planner-produced-migration.ts`:
  - Remove the `...ifDefined('kind', this.meta.kind)` spread in `renderTypeScript`.

**Implementation changes — flip `from` nullability**:

- `packages/1-framework/3-tooling/migration/src/migration-base.ts`:
  - Flip `MigrationMeta.from` from `string` to `string | null`.
  - Flip the arktype validator: `from: 'string'` → `from: 'string | null'`.
  - Simplify the `Migration.origin` getter to `from === null ? null : { storageHash: from }`. Remove the "empty `from`" comment.
  - Where `buildAttestedMetadata` reads `meta.from`, just pass it through unchanged into the metadata (the type is already `string | null` end-to-end).
- `packages/1-framework/3-tooling/migration/src/metadata.ts`:
  - Flip `MigrationMetadata.from` from `string` to `string | null`. Update the JSDoc that talks about the on-disk shape.
- `packages/1-framework/3-tooling/migration/src/io.ts`:
  - Flip `MigrationMetadataSchema.from` from `'string'` to `'string | null'`.
- `packages/1-framework/3-tooling/cli/src/commands/migration-new.ts`, `migration-plan.ts`:
  - Where the synthesized baseline has `from: EMPTY_CONTRACT_HASH`, change to `from: null`. Drop the now-unused `EMPTY_CONTRACT_HASH` import (only if no other uses remain in that file).
- `packages/1-framework/3-tooling/cli/src/control-api/operations/migration-apply.ts`:
  - Change `migration.from === EMPTY_CONTRACT_HASH ? null : { storageHash: migration.from }` to `migration.from === null ? null : { storageHash: migration.from }`. Drop the `EMPTY_CONTRACT_HASH` import (only if no other uses remain in that file).
  - Update the inline comment ("EMPTY_CONTRACT_HASH means 'no prior state' …") to reflect the new encoding.
  - Audit other `migration.from` reads in this file (`firstMigration.from !== originHash` etc.). Where a string-equality is now comparing `string | null` vs `string`, update accordingly. Likely candidate: thread the live-marker `originHash` through as `string | null` too, OR keep `originHash: string` (because the live-marker layer still uses `EMPTY_CONTRACT_HASH`) and explicitly compare `(migration.from ?? EMPTY_CONTRACT_HASH) === originHash` at the boundary. **Decision: prefer the latter** — keep the manifest layer pure (`null`) and resolve the sentinel only where the manifest meets the live-marker layer. This keeps Task 2's ripple small.
- `packages/3-mongo-target/1-mongo-target/src/core/render-typescript.ts`:
  - In `buildDescribeMethod`, the `from` literal currently goes through `JSON.stringify(meta.from)`. Confirm that `JSON.stringify(null) === 'null'` is what we want in the rendered TypeScript (it is). No real change needed here, but flip the `RenderMigrationMeta.from` type to `string | null`.
- `packages/3-mongo-target/1-mongo-target/src/core/planner-produced-migration.ts`:
  - Update any place that propagates `meta.from`. Likely no functional change — types just flow through.

**Done when**: project builds and typechecks (`pnpm build`, `pnpm typecheck`); package test suites under the migration tools and CLI pass; `rg '\bkind\b' packages/1-framework/3-tooling/migration packages/1-framework/3-tooling/cli/src/commands/migration-*.ts packages/3-mongo-target/1-mongo-target/src/core` returns no migration-`kind` hits (only legitimate component-manifest `kind: 'adapter'` etc.); `rg 'EMPTY_CONTRACT_HASH' packages/1-framework/3-tooling/cli/src/commands/migration-new.ts packages/1-framework/3-tooling/cli/src/commands/migration-plan.ts packages/1-framework/3-tooling/cli/src/control-api/operations/migration-apply.ts` returns at most an unrelated reference (the live-marker sentinel) — no manifest-layer reference.

**Commit**: `refactor(migration): drop \`kind\` and make manifest \`from\` nullable (TML-2270)`

### Task 3 — Regenerate on-disk migration packages

Bulk-update every `migration.json` under `examples/**` to drop `kind`, rewrite `"from": "sha256:empty"` → `"from": null`, and recompute `migrationHash`.

**Approach**:

1. Write a one-shot script at `wip/regenerate-migration-hashes.ts` that:
   - Walks `examples/**` recursively to find every `migration.json`.
   - For each: read the file, parse the JSON, delete the `kind` key, rewrite `from === 'sha256:empty'` (and the legacy `from === ''` defensively) to `null`, recompute `migrationHash` via `computeMigrationHash` from `@prisma-next/migration-tools`, write the file back with the canonical `JSON.stringify(metadata, null, 2)\n` shape (matching `writeMigrationMetadata`).
   - Logs every changed file and the per-file before/after hash for auditability.
2. Run `pnpm tsx wip/regenerate-migration-hashes.ts` once.
3. Verify with `pnpm test:packages` and the example test suites that touch on-disk packages.
4. Update hand-authored `migration.ts` files in `examples/**` whose `describe()` returns `from: 'sha256:empty'` for a baseline so they return `from: null` instead. The regen script does **not** touch `migration.ts` (TypeScript source) — those need a quick visual edit. Concrete file list to check: every `examples/**/migrations/*/migration.ts` whose corresponding `migration.json` had `"from": "sha256:empty"`.
5. Delete `wip/regenerate-migration-hashes.ts` (per the WIP-directory rule, nothing under `wip/` is committed; the regeneration is auditable via the commit diff itself).

**Affected files** (every `migration.json` under):

- `examples/prisma-next-demo/migrations/**`
- `examples/mongo-demo/migrations/**`
- `examples/retail-store/migrations/**`
- `examples/prisma-next-demo/migration-fixtures/**`

Plus a small set of `migration.ts` files in the same trees that hand-write `from: 'sha256:empty'`.

**Done when**: every on-disk `migration.json` has been regenerated; `rg '"kind"|"from": "sha256:empty"|"from": ""' examples` returns no hits in `migration.json` files; `rg "from: 'sha256:empty'"` returns no hits in `examples/**/migration.ts`; `pnpm test:packages` and the relevant example test suites pass; the script has been deleted.

**Commit**: `chore(migration): regenerate on-disk packages after manifest schema tightening (TML-2270)`

### Task 4 — Final sweep

Quick safety pass:

- `pnpm build` from the repo root (Turbo-cached after Task 2/3, just confirms).
- `pnpm typecheck` from each affected package.
- `pnpm lint:deps`.
- `pnpm test:packages`.
- `pnpm test:integration` for the example suites that use real DBs (Postgres / MongoDB) — only if the environment supports it; if not, document in the PR body that integration tests need to be run in CI.
- `rg '\bkind\b.*regular|\bkind\b.*baseline'` — sanity sweep that no `kind: 'regular' | 'baseline'` reference survived anywhere.
- `rg "'sha256:empty'"` over `packages/**/src` and `examples/**` — confirm `EMPTY_CONTRACT_HASH` (and its raw string literal) only appears in the live-marker layer (`migration-status.ts`, the defensive check in `migration-apply.ts`'s marker read) and in the constants file/exports.

No commit unless something turns up.

## Deliverables

- A single PR titled `refactor(migration): tighten manifest schema — drop \`kind\`, make \`from\` nullable (TML-2270)` containing the four commits above.
- PR description includes a summary, a "what changed for users" section noting that `migration.json` files generated before this PR will fail to parse with `MIGRATION.INVALID_MANIFEST` and the fix is to re-run `prisma-next migration plan`, and a brief callout that `from`/`to` and `origin`/`destination` remain two vocabularies for the same concept (vocabulary unification is a deliberate non-goal of this PR — call it out so reviewers don't re-litigate it).

## Open questions for review

- **Marker-layer comparison style** in `executeMigrationApply` (Task 2). The plan picks `(migration.from ?? EMPTY_CONTRACT_HASH) === originHash` at the manifest/marker boundary so the manifest layer stays pure-`null`. Reviewer may prefer threading `string | null` through `originHash` as well; if so, that's a small additional plumbing change in the control-API layer.
- **Tightening `from`'s string format** to require `sha256:` prefix (separate from the nullability change) — deferred to a follow-up per the spec; flag it in the PR body if the reviewer wants it pulled in.
- **Fixtures direction** — confirmed "regenerate, don't delete". If the reviewer changes their mind during review, Task 3 simplifies (delete `examples/prisma-next-demo/migration-fixtures/` instead of regenerating).
