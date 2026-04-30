# Plan — Tighten the migration manifest

- **Spec**: [spec.md](./spec.md)
- **Linear**: TML-2270
- **Sequencing**: a single PR (draft #406), four milestones, commit-as-you-go.

## Strategy

Two cleanups land together because they share a hash-regeneration sweep:

1. **Drop `kind`** from author-facing types, on-disk schema, scaffolders, display, and tests.
2. **Flip `from` to `string | null`** so `Migration.describe()` agrees with `Migration.origin` on nullability; baselines persist `"from": null` instead of the sentinel string `"sha256:empty"` (or `""`).

Both changes alter the input to `computeMigrationHash`, so every existing on-disk `migration.json` needs to be regenerated. Doing them in one sweep is one regen pass over ~98 files instead of two.

The schema-tightening milestone (m2) and the fixture-update milestone (m3) must land consecutively, because the type/schema change is what causes the loader's stored-vs-computed `migrationHash` check to fail on the unregenerated fixtures. The architecture-doc milestone (m1) can land first and is fully independent.

## Tests-first guidance (cross-milestone)

Per the repo rule "always write tests before creating or modifying implementation", each implementation milestone is preceded by a failing-test step (or the milestone explicitly notes the existing test suite already exercises the behaviour to-be-changed and just needs updating).

Three new test cases drive this work directly:

- **T1** — `MigrationMetadataSchema` rejects manifests carrying a `kind` field. *(io.test.ts — replace the existing "errors when kind has invalid value" case with an "errors when kind is present" case, since arktype rejects unknown keys by default.)*
- **T2** — `MigrationMetadataSchema` accepts `"from": null` and rejects `"from": ""`. *(io.test.ts.)*
- **T3** — `Migration.origin` returns `null` when `describe().from === null`, and `{ storageHash }` otherwise. *(migration-base.test.ts — tighten the existing assertion.)*

## Milestones

### m1 — Architecture docs

**Scope.** Bring the two architecture docs that mention `kind` in `strippedManifest` / `strippedMeta` into agreement with the implementation. No code coupling — this milestone can land independently.

**Tasks**:

- **T1.1** — `docs/architecture docs/subsystems/7. Migration System.md`: in the "Storage-only identity" paragraph, drop `kind` from the `strippedManifest` list. Where prose references `from`/`to` storage hashes, note that `from` is `string | null` (with `null` denoting baseline / no prior state).
- **T1.2** — `docs/architecture docs/adrs/ADR 199 - Storage-only migration identity.md`: same fix in the "Decision" paragraph; add a "Revised: <date> — `kind` removed; `from` is now nullable (TML-2270)" note at the top.

**Validation gate**:

- `pnpm lint:deps` (sanity that nothing else broke).
- Markdown link check on the two edited docs (visual inspection — open both, follow internal links).
- `rg '\bkind\b' "docs/architecture docs/subsystems/7. Migration System.md" "docs/architecture docs/adrs/ADR 199 - Storage-only migration identity.md"` returns no `kind` references in the strippedManifest/strippedMeta context.

**Done when**: both docs no longer mention `kind` as a strippedManifest/strippedMeta member; the ADR 199 revision note is present; the prose is consistent with `from: string | null`.

**Commit**: `docs(migration): drop \`kind\` from strippedManifest list, note \`from\` nullability (TML-2270)`.

---

### m2 — Tighten schemas + drop `kind` + flip `from` nullability

**Scope.** Single milestone (typically a single commit) that lands the type/schema change *and* the corresponding test updates atomically. After this milestone, unit tests pass but the **example integration/e2e tests fail** because their on-disk `migration.json` files still carry `kind` and `"from": "sha256:empty"` and the loader rejects them. That's expected and is fixed in m3.

**Tests (write first, expected to fail)**:

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
  - Default `from` stays `'sha256:empty'`-style for non-baseline tests; baseline-flavoured tests use `null`. Most call sites pass an explicit `from`, so the default is mostly cosmetic.
- `packages/1-framework/3-tooling/cli/test/commands/{migration-plan,migration-apply,migration-show,migration-ref,migration-e2e,migration-tamper}.test.ts` —
  - Drop every `kind: 'regular'` literal in test fixture builders and every `expect(...).kind` assertion.
  - Where a baseline migration is constructed with `from: 'sha256:empty'` or `from: EMPTY_CONTRACT_HASH`, change to `from: null`.
  - Where a test asserts on baseline-ness, switch to `expect(manifest.from).toBeNull()`.
- `packages/1-framework/3-tooling/cli/test/migration-cli.test.ts` — same treatment.
- `examples/{mongo-demo,retail-store}/test/manual-migration.test.ts` — drop `expect(manifest.kind).toBe('regular')` from the "migration.json has expected structure" cases.

**Implementation — drop `kind`**:

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

**Implementation — flip `from` nullability**:

- `packages/1-framework/3-tooling/migration/src/migration-base.ts`:
  - Flip `MigrationMeta.from` from `string` to `string | null`.
  - Flip the arktype validator: `from: 'string'` → `from: 'string | null'`.
  - Simplify the `Migration.origin` getter to `from === null ? null : { storageHash: from }`. Remove the "empty `from`" comment.
  - Where `buildAttestedMetadata` reads `meta.from`, just pass it through unchanged into the metadata.
- `packages/1-framework/3-tooling/migration/src/metadata.ts`:
  - Flip `MigrationMetadata.from` from `string` to `string | null`. Update the JSDoc that talks about the on-disk shape.
- `packages/1-framework/3-tooling/migration/src/io.ts`:
  - Flip `MigrationMetadataSchema.from` from `'string'` to `'string | null'`.
- `packages/1-framework/3-tooling/cli/src/commands/migration-new.ts`, `migration-plan.ts`:
  - Where the synthesized baseline has `from: EMPTY_CONTRACT_HASH`, change to `from: null`. Drop the now-unused `EMPTY_CONTRACT_HASH` import (only if no other uses remain in that file).
- `packages/1-framework/3-tooling/cli/src/control-api/operations/migration-apply.ts`:
  - Change `migration.from === EMPTY_CONTRACT_HASH ? null : { storageHash: migration.from }` to `migration.from === null ? null : { storageHash: migration.from }`.
  - Update the inline comment.
  - Audit other `migration.from` reads in this file (`firstMigration.from !== originHash` etc.). Where a string-equality is now comparing `string | null` vs `string`, resolve at the manifest/marker boundary with `(migration.from ?? EMPTY_CONTRACT_HASH) === originHash` so the manifest layer stays pure-`null` and the live-marker layer keeps its sentinel. Per design discussion this is the chosen shape.
  - Drop the `EMPTY_CONTRACT_HASH` import only if no other uses remain in that file.
- `packages/3-mongo-target/1-mongo-target/src/core/render-typescript.ts`:
  - Flip `RenderMigrationMeta.from` to `string | null`. The `JSON.stringify(meta.from)` already does the right thing for `null`.
- `packages/3-mongo-target/1-mongo-target/src/core/planner-produced-migration.ts`:
  - Update any place that propagates `meta.from`. Likely no functional change — types just flow through.

**Validation gate**:

- `pnpm build` (workspace; the type changes ripple).
- `pnpm typecheck` workspace-wide.
- `pnpm test:packages`.
- `pnpm lint:deps`.
- Cross-package greps (must all return zero hits in production code, modulo unrelated `kind` discriminants):
  - `rg '\bkind\b.*regular|\bkind\b.*baseline' packages` returns zero hits.
  - `rg "'sha256:empty'" packages/1-framework/3-tooling/cli/src/commands/migration-new.ts packages/1-framework/3-tooling/cli/src/commands/migration-plan.ts` returns zero hits in those files.
  - `rg "EMPTY_CONTRACT_HASH" packages/1-framework/3-tooling/cli/src/commands/migration-new.ts packages/1-framework/3-tooling/cli/src/commands/migration-plan.ts` returns zero hits in those files (we replaced the only manifest-layer use).

**Done when**: project builds and typechecks; package test suites under the migration tools and CLI pass; cross-package greps clean; example integration tests are *expected* to fail (their fixtures still carry `kind` / sentinel) — that's the bridge into m3.

**Commit**: `refactor(migration): drop \`kind\` and make manifest \`from\` nullable (TML-2270)`.

---

### m3 — Regenerate on-disk migration packages

**Scope.** Bulk-update every `migration.json` under `examples/**` to drop `kind`, rewrite `"from": "sha256:empty"` → `"from": null`, and recompute `migrationHash`. Plus update hand-authored `migration.ts` files whose `describe()` returns `from: 'sha256:empty'` for a baseline.

**Approach**:

- **T3.1** — Write a one-shot script at `wip/regenerate-migration-hashes.ts` that:
  - Walks `examples/**` recursively to find every `migration.json`.
  - For each: read, parse, delete `kind` key, rewrite `from === 'sha256:empty'` (and the legacy `from === ''` defensively) to `null`, recompute `migrationHash` via `computeMigrationHash` from `@prisma-next/migration-tools`, write back with the canonical `JSON.stringify(metadata, null, 2)\n` shape (matching `writeMigrationMetadata`).
  - Logs every changed file with before/after hash for auditability.
- **T3.2** — Run `pnpm tsx wip/regenerate-migration-hashes.ts` once.
- **T3.3** — Update hand-authored `migration.ts` files in `examples/**` whose `describe()` returns `from: 'sha256:empty'` for a baseline so they return `from: null` instead. The regen script does **not** touch `migration.ts` (TypeScript source); a quick visual edit is required. Concrete file list to check: every `examples/**/migrations/*/migration.ts` whose corresponding `migration.json` had `"from": "sha256:empty"`.
- **T3.4** — Verify with `pnpm test:packages` and the example test suites that touch on-disk packages.
- **T3.5** — Delete `wip/regenerate-migration-hashes.ts` (per the WIP-directory rule, nothing under `wip/` is committed; the regeneration is auditable via the commit diff).

**Affected directories** (every `migration.json` under):

- `examples/prisma-next-demo/migrations/**`
- `examples/mongo-demo/migrations/**`
- `examples/retail-store/migrations/**`
- `examples/prisma-next-demo/migration-fixtures/**`

Plus a small set of `migration.ts` files in the same trees that hand-write `from: 'sha256:empty'`.

**Validation gate**:

- `pnpm test:packages`.
- The example test suites that exercise on-disk packages (`examples/{mongo-demo,retail-store}/test/manual-migration.test.ts` and any prisma-next-demo tests that load migration packages directly).
- `rg '"kind"|"from": "sha256:empty"|"from": ""' examples` returns no hits in `migration.json` files.
- `rg "from: 'sha256:empty'"` returns no hits in `examples/**/migration.ts`.
- `pnpm test:integration` for example suites that use real DBs is **out of scope** for the local validation gate — flag in the PR body for CI to cover (per AGENTS.md "heavier suites need infra; confirm credentials are present").

**Done when**: every on-disk `migration.json` has been regenerated; the greps above return clean; `pnpm test:packages` and the relevant example test suites pass; the script has been deleted.

**Commit**: `chore(migration): regenerate on-disk packages after manifest schema tightening (TML-2270)`.

---

### m4 — Final sweep

**Scope.** Quick safety pass to confirm nothing slipped through.

**Tasks**:

- **T4.1** — `pnpm build` from the repo root (Turbo-cached after m2/m3, just confirms).
- **T4.2** — `pnpm typecheck` workspace-wide.
- **T4.3** — `pnpm lint:deps`.
- **T4.4** — `pnpm test:packages`.
- **T4.5** — Sanity sweeps:
  - `rg '\bkind\b.*regular|\bkind\b.*baseline'` over `packages` and `examples`.
  - `rg "'sha256:empty'"` over `packages/**/src` and `examples/**` — confirm `EMPTY_CONTRACT_HASH` (and its raw string literal) only appears in the live-marker layer (`migration-status.ts`, the defensive check in `migration-apply.ts`'s marker read) and in the constants file/exports.

**Validation gate**: all of T4.1–T4.4 pass; sanity sweeps return only legitimate hits.

**Done when**: all checks green; no commit unless something turns up.

**Commit**: none, unless a stray hit surfaces — in which case a focused fix-up commit.

---

## Open questions for review

- **Marker-layer comparison style** in `executeMigrationApply` (m2). The plan picks `(migration.from ?? EMPTY_CONTRACT_HASH) === originHash` at the manifest/marker boundary so the manifest layer stays pure-`null`. Reviewer may prefer threading `string | null` through `originHash` as well; if so, that's a small additional plumbing change in the control-API layer.
- **Tightening `from`'s string format** to require `sha256:` prefix (separate from the nullability change) — deferred to a follow-up per the spec; flag in the PR body if the reviewer wants it pulled in.
- **Fixtures direction** — confirmed "regenerate, don't delete". If the reviewer changes their mind during review, m3 simplifies (delete `examples/prisma-next-demo/migration-fixtures/` instead of regenerating).
