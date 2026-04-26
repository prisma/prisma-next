# Verify migration package integrity at load time

> Linear: [TML-2264 — Migration runner should verify migration matches its hash](https://linear.app/prisma-company/issue/TML-2264/migration-runner-should-verify-migration-matches-its-hash) (WS4 / M11 — MongoDB & cross-family architecture)

## Summary

Hoist the apply-time `migrationHash` integrity check out of the CLI's `migration apply` command and into the on-disk loader (`readMigrationPackage` in `@prisma-next/migration-tools/io`). Every code path that materializes a `MigrationPackage` from disk — CLI commands, the control client, and the in-process `Migration.run()` orchestrator — then gets package-integrity verification for free, in one place, with one error shape, applied uniformly across every target family. The currently-explicit verification loop in `migration apply` becomes redundant and is deleted.

The same PR also cleans up the vocabulary and file layout in `@prisma-next/migration-tools` (the package we're touching): rename `migrationId` → `migrationHash` to be explicit that the value is a hash, not an opaque id; rename `MigrationBundle` → `MigrationPackage` to match the existing `read/writeMigrationPackage` I/O verbs; rename `MigrationManifest` → `MigrationMetadata` so "manifest" stays exclusively the on-disk-file term; and split the dumping-ground `types.ts` into one file per concept. See [Naming and structure refactor](#naming-and-structure-refactor) for the full set of changes and rationale.

## Context

> The vocabulary in this section uses the **target** names (`migrationHash`, `MigrationPackage`, `MigrationMetadata`). Where the current names differ, they appear in parentheses on first mention. See [Naming and structure refactor](#naming-and-structure-refactor) for the rename table.

### What the integrity check is

`migrationHash` (currently `migrationId`) is a content-addressed SHA-256 over the migration's stripped metadata (envelope minus contracts/hints/signature) and `ops.json` ([ADR 199](../../docs/architecture%20docs/adrs/ADR%20199%20-%20Storage-only%20migration%20identity.md)). The function `computeMigrationHash(metadata, ops)` (currently `computeMigrationId(manifest, ops)`) produces it; the function `verifyMigrationHash(pkg)` (currently `verifyMigrationBundle(bundle)`) re-hashes an in-memory `MigrationPackage` and compares it against the stored `migrationHash` (`packages/1-framework/3-tooling/migration/src/attestation.ts:28-75`).

The integrity check is **purely structural**, not semantic: `computeMigrationHash` canonicalizes whatever JSON is in the metadata and ops via `sortKeys` (recursive) + `JSON.stringify` — see `canonicalize-json.ts` — and hashes the result. Target-specific operation payloads (`step.sql`, Mongo's pipeline AST, …) are hashed verbatim. No per-target normalization is required, because we are verifying that the on-disk bytes still produce their recorded hash, **not** that two semantically-equivalent operations would hash the same. The latter is an emit-drift concern (ADR 192 step 2; out of scope for this spec).

The symmetry holds because `JSON.parse(JSON.stringify(x))` round-trips JSON-safe values losslessly and `sortKeys` is idempotent and deterministic — write-time canonicalization and read-time canonicalization produce the same canonical bytes regardless of source-side key ordering or whitespace.

This is the **on-disk consistency** half of the two-step verification that ADR 192 prescribes ("[ADR 192 §Verification on apply](../../docs/architecture%20docs/adrs/ADR%20192%20-%20ops.json%20is%20the%20migration%20contract.md)"). The other half — emit-drift detection (re-emit `migration.ts` in-memory and compare its hash to `ops.json`) — is **out of scope** for this spec; see [Out of scope](#out-of-scope).

This rationale is recorded permanently as JSDoc on `computeMigrationHash` (see [Documentation home](#documentation-home)); the spec itself is transient.

### What's wrong today

Verification exists, but it lives in exactly one consumer instead of in the loader:

- `packages/1-framework/3-tooling/cli/src/commands/migration-apply.ts:213-233` runs an explicit `for (const bundle of migrations.bundles) { verifyMigrationBundle(bundle); … }` loop after loading. This was added in commit `4ac692609` (2026-04-23), after this ticket was filed.
- Every other CLI command that loads packages — `migration plan`, `migration status`, `migration show`, `migration new` — does **not** verify. `db update` and `db init` don't load `MigrationPackage`s and aren't affected.
- The future in-process apply path being added in [TML-2301](https://linear.app/prisma-company/issue/TML-2301) (the `Migration.run()` orchestrator's apply branch, plus the control client) will need the same check, and is at risk of forgetting it for the same reason: there is no enforcement at the load boundary.

This is a defense-in-depth gap. Hash mismatch indicates corruption (FS partial-write, manual edit, cherry-pick of a half-applied directory) and must hard-fail consistently regardless of which command happens to consume the package.

### Where the loader lives

All on-disk reads of a migration package today go through one of two functions in `@prisma-next/migration-tools/io`:

- `readMigrationPackage(dir): Promise<MigrationPackage>` — reads `migration.json` + `ops.json`, structurally validates them with arktype, returns a `MigrationPackage` (`packages/1-framework/3-tooling/migration/src/io.ts:112-159`).
- `readMigrationsDir(root): Promise<readonly MigrationPackage[]>` — enumerates every migration directory under `root` and calls `readMigrationPackage` for each (`packages/1-framework/3-tooling/migration/src/io.ts:178-209`).

CLI helpers (`loadMigrationBundles` / `loadAllBundles` in `packages/1-framework/3-tooling/cli/src/utils/command-helpers.ts:154-175`) wrap `readMigrationsDir` and additionally reconstruct the migration graph; the directly-on-disk consumers (`migration-show.ts`, `migration-new.ts`) call the I/O functions straight from `@prisma-next/migration-tools/io`. Note: the CLI helper names still say "Bundles" today; they get renamed too — see [Naming and structure refactor](#naming-and-structure-refactor).

Adding integrity verification to `readMigrationPackage` therefore covers every existing on-disk loading path — and any future one — by construction.

## Decisions

1. **The `MigrationPackage` loader is the verification boundary.** `readMigrationPackage(dir)` performs the integrity check intrinsically: read → structurally validate → recompute `migrationHash` → throw on mismatch. `readMigrationsDir(root)` inherits this by transitivity. Returning a `MigrationPackage` from these functions is therefore a structural promise that the package is internally consistent; downstream consumers do not re-check.

2. **`verifyMigrationHash(pkg)` (renamed from `verifyMigrationBundle`) remains the framework-level primitive.** It stays exported from `@prisma-next/migration-tools/hash` (the renamed `attestation.ts` — see [File layout](#file-layout)) and is the building block `readMigrationPackage` uses. We do not invent a new helper. Callers who already hold an in-memory package (e.g. one constructed by the planner before it has been written to disk) can still use it directly.

3. **Hash mismatch is a hard error everywhere.** A new structured `MigrationToolsError` (code `MIGRATION.HASH_MISMATCH`) carries `dir`, `storedHash`, `computedHash`, with a `why` explaining tampering/partial-write and a `fix` pointing at re-emit / version-control restore. CLI exit handling renders it through the existing diagnostic path. This replaces the current ad-hoc `errorRuntime("Migration package is corrupt: …")` thrown from inside `migration-apply.ts`.

4. **The runner SPI does not verify.** `MigrationRunner.execute({ plan, … })` (`packages/1-framework/1-core/framework-components/src/control-migration-types.ts:334-361`) takes a `MigrationPlan` — a stripped-down structure with no `migrationHash` and no metadata. It cannot verify integrity from its inputs and will not be retrofitted to do so. JSDoc on the SPI documents the invariant: callers must obtain the underlying package through `readMigrationPackage` (or hand-construct it and verify with `verifyMigrationHash`) before invoking `execute`. Same JSDoc note on the framework-level `executeMigrationApply` operation.

5. **Drop the CLI's per-command verification loop.** Once the loader returns verified packages, the explicit loop in `migration-apply.ts:213-233` is redundant and is deleted along with the now-unused `verifyMigrationBundle` import in that file.

6. **`verifyMigration(dir)` is removed.** It is currently a thin convenience around `readMigrationPackage` + `verifyMigrationBundle` that returns a `VerifyResult` instead of throwing. No production code calls it; once `readMigrationPackage` throws on mismatch, the result-object form has no remaining purpose. Removing it keeps "load = verified" the only API shape.

7. **Naming is cleaned up where we touch.** The PR renames `migrationId` → `migrationHash`, `MigrationBundle` → `MigrationPackage`, `MigrationManifest` → `MigrationMetadata`, splits `types.ts` into per-concept files, and updates the README + JSDoc. Full rationale and scope in [Naming and structure refactor](#naming-and-structure-refactor).

## Naming and structure refactor

### Goals

- **Be explicit about what the value is.** "Hash" is what we compute; "ID" is a misnomer that suggests an opaque identifier. Rename so types and functions name their actual content.
- **Separate in-memory vocabulary from on-disk vocabulary.** "Manifest" is the on-disk JSON file (`migration.json`). The in-memory record is the *metadata*. Don't conflate the two.
- **Stop using `types.ts` as a dumping ground.** One file per concept; each filename names the concept it owns.
- **Align with verbs that already exist.** The I/O functions are `readMigrationPackage` / `writeMigrationPackage`; the README already calls the loaded record `MigrationPackage`. The type rename brings code in line with what's already being said about it.

### Vocabulary

| Current | Target | Where | Notes |
|---|---|---|---|
| `MigrationBundle` (interface) | `MigrationPackage` | `migration-tools/src/package.ts` | Aligns with `read/writeMigrationPackage`. README already uses this name. |
| `bundle.manifest` (field) | `pkg.metadata` | `MigrationPackage` field | "Manifest" stays exclusively the on-disk-file term. |
| `MigrationManifest` (interface) | `MigrationMetadata` | `migration-tools/src/metadata.ts` | The full in-memory record (parsed from `migration.json`). |
| `migrationId` (TS field) | `migrationHash` | `MigrationMetadata`, `MigrationChainEntry` | Be explicit: it's a hash. |
| `migrationId` (JSON field in `migration.json`) | `migrationHash` | All on-disk `migration.json` files | Wire-format change; see [Wire-format migration](#wire-format-migration). |
| `computeMigrationId` | `computeMigrationHash` | `migration-tools/src/hash.ts` | Verb-explicit. |
| `verifyMigrationBundle` | `verifyMigrationHash` | `migration-tools/src/hash.ts` | What we verify is a hash, not a "bundle". |
| `verifyMigration(dir)` | (deleted) | — | Already in plan; redundant once load = verified. |
| `VerifyResult.storedMigrationId` | `storedHash` | `migration-tools/src/hash.ts` | Drop the redundant `Migration` prefix on a result-object field. |
| `VerifyResult.computedMigrationId` | `computedHash` | `migration-tools/src/hash.ts` | Same. |
| `errorDuplicateMigrationId` | `errorDuplicateMigrationHash` | `errors.ts` | Carry the rename through error factories. |
| Error code `MIGRATION.DUPLICATE_MIGRATION_ID` | `MIGRATION.DUPLICATE_MIGRATION_HASH` | `errors.ts` | Wire-format-ish (error code is observable in CLI output and structured logs); accept the change since the prototype hasn't shipped. |
| New error: `errorBundleCorrupt` (proposed earlier) | `errorMigrationHashMismatch` | `migration-tools/src/errors.ts` | Code: `MIGRATION.HASH_MISMATCH`. |
| `loadMigrationBundles` (CLI helper) | `loadMigrationPackages` | `cli/src/utils/command-helpers.ts` | Match the new package vocabulary. |
| `loadAllBundles` (CLI helper alias) | `loadAllMigrationPackages` | same | Same. |

The sibling `MigrationMeta` interface in `migration-base.ts` (the small structure returned by `Migration.describe()`) is **kept as-is** to avoid expanding scope into TML-2301's territory; we accept the temporary near-collision with `MigrationMetadata` and let TML-2301's split decide whether to rename it (likely to `MigrationDescription` to match `describe()`). Open question 3 below.

### File layout

`packages/1-framework/3-tooling/migration/src/types.ts` is split into one file per concept:

```
packages/1-framework/3-tooling/migration/src/
├── canonicalize-json.ts   # unchanged
├── dag.ts                 # unchanged (imports updated)
├── errors.ts              # + errorMigrationHashMismatch; existing factories renamed where needed
├── hash.ts                # ⤳ renamed from attestation.ts
│                          #   exports: computeMigrationHash, verifyMigrationHash
│                          # JSDoc on computeMigrationHash carries the structural-canonicalization rationale
├── io.ts                  # readMigrationPackage now performs hash verification
├── metadata.ts            # ⤳ extracted from types.ts
│                          #   exports: MigrationMetadata, MigrationHints
├── migration-base.ts      # imports updated (MigrationMetadata, etc.)
├── package.ts             # ⤳ extracted from types.ts
│                          #   exports: MigrationPackage
├── graph.ts               # ⤳ extracted from types.ts
│                          #   exports: MigrationGraph, MigrationChainEntry
└── exports/               # subpath re-exports updated to match new files
```

`types.ts` is **deleted** (not left as an empty re-export). The `./types` subpath in `package.json` either points to a barrel file or is split into per-concept subpaths (`./metadata`, `./package`, `./graph`); see Open question 1.

### Wire-format migration

The on-disk JSON field `migrationId` in `migration.json` is renamed to `migrationHash`. Existing `migration.json` files (113 in the repo, mostly in `examples/**/migration-fixtures/`) need their key renamed.

Critically, **no hash recomputation is required**: `computeMigrationHash` strips the `migrationHash` field from its input before hashing (the same way `computeMigrationId` strips `migrationId` today; see `attestation.ts:33`). The hash value is over the *rest* of the metadata plus ops, independent of what the field is called. Renaming the JSON key is therefore a literal rename — old hash values stay valid.

A small `pnpm` script under `scripts/` (or a one-off command run by the maker) walks every `migration.json` under the repo and rewrites the field. The script lives only as long as it takes to run once; it is not committed as a long-term tool. Verification: after the codemod, `pnpm test` passes including the migration-graph fixture-based tests.

### Documentation home

The structural-canonicalization rationale (currently in [What the integrity check is](#what-the-integrity-check-is)) lives permanently as a JSDoc block on `computeMigrationHash` in `hash.ts`. That JSDoc reads (target wording):

```typescript
/**
 * Content-addressed migration hash over (metadata envelope sans
 * contracts/hints/signature, ops). See ADR 199 — Storage-only migration
 * identity for the rationale: contracts are anchored separately by the
 * storage-hash bookends inside the envelope; planner hints are advisory
 * and must not affect identity.
 *
 * The integrity check is purely structural, not semantic. The function
 * canonicalizes its inputs via `sortKeys` (recursive) + `JSON.stringify`
 * and hashes the result. Target-specific operation payloads (`step.sql`,
 * Mongo's pipeline AST, …) are hashed verbatim — no per-target
 * normalization is required, because what's being verified is "do the
 * on-disk bytes still produce their recorded hash", not "do two
 * semantically-equivalent migrations hash the same". The latter is an
 * emit-drift concern (ADR 192 step 2).
 *
 * The symmetry across write and read holds because `JSON.parse(
 * JSON.stringify(x))` round-trips JSON-safe values losslessly and
 * `sortKeys` is idempotent and deterministic — write-time and read-time
 * canonicalization produce the same canonical bytes regardless of
 * source-side key ordering or whitespace.
 *
 * The `migrationHash` field on the metadata is stripped before hashing
 * so the function can be used both at write time (when no hash exists
 * yet) and at verify time (rehashing an already-attested record).
 */
```

`verifyMigrationHash` carries a one-line JSDoc pointing at the above. The `Migration System` subsystem doc (`docs/architecture docs/subsystems/7. Migration System.md`) is **not** modified — it would only repeat the JSDoc. ADR 199 is **not** modified — its scope is "what's stripped from the hash input"; the structural-vs-semantic point belongs with the function.

### Out-of-scope opportunities (noted, not addressed)

The following are dumping-ground / vocabulary issues we noticed while auditing but explicitly **do not** touch in this PR:

- **`framework-components/src/control-migration-types.ts`.** A 11-interface dumping ground (`MigrationOperationClass`, `SerializedQueryPlan`, `DataTransformOperation`, `MigrationOperationPolicy`, `MigrationPlanOperation`, `OpFactoryCall`, `MigrationPlan`, `MigrationPlanWithAuthoringSurface`, `MigrationPlannerConflict`, `MigrationPlannerSuccessResult`, `MigrationRunner`, `TargetMigrationsCapability`). Worth splitting per concept — but this PR only adds JSDoc to one of those interfaces, and a structural change to `framework-components` belongs in its own PR scoped to that package's responsibilities.
- **`migration-tools/src/errors.ts`.** 24 error factories in one file. Cohesive (all `MigrationToolsError`, all `MIGRATION.*` codes), so not a dumping ground in the same sense as `types.ts`. We add one new factory and rename two; we don't split the file. If the file grows further, splitting by concern (`errors-io.ts`, `errors-graph.ts`, `errors-refs.ts`, `errors-integrity.ts`) is a clean follow-up.
- **`MigrationMeta` (in `migration-base.ts`).** Confusingly close to `MigrationMetadata` after this PR's rename. TML-2301 is splitting `migration-base.ts` (extracting the abstract class to a shared-plane home and the orchestrator to migration-plane); the right time to rename `MigrationMeta` → `MigrationDescription` is during that split, not before. We accept the transient confusion.
- **README "Attestation framing" section drift.** The README says `computeMigrationId` hashes a "4-part tuple" but the code (post-ADR 199) hashes a 2-part tuple (stripped metadata + ops). Pre-existing drift; we update the section as part of the README refresh anyway, since we're already touching the file for the rename.

## Changes

> The change list is split into **integrity work** (Changes 1-6) and **rename + restructure work** (Changes 7-10). They land in the same PR because the rename touches every file the integrity work modifies; landing them separately would require two redundant edits to the same lines.

### 1. Make `readMigrationPackage` verifying

In `packages/1-framework/3-tooling/migration/src/io.ts`:

- Append a final step to `readMigrationPackage` after structural validation: `const result = verifyMigrationHash(pkg); if (!result.ok) throw errorMigrationHashMismatch(dir, result.storedHash!, result.computedHash!);`.
- Existing arktype validation and `ENOENT` / invalid-JSON handling stay as-is.

### 2. Add `errorMigrationHashMismatch` to `migration-tools/errors.ts`

```typescript
export function errorMigrationHashMismatch(
  dir: string,
  storedHash: string,
  computedHash: string,
): MigrationToolsError {
  return new MigrationToolsError(
    'MIGRATION.HASH_MISMATCH',
    'Migration package is corrupt',
    {
      why: `Stored migrationHash "${storedHash}" does not match the recomputed hash "${computedHash}" for "${dir}". The migration.json or ops.json has been edited or partially written since emit.`,
      fix: `Re-emit the package by running \`node "${dir}/migration.ts"\`, or restore the directory from version control.`,
      details: { dir, storedHash, computedHash },
    },
  );
}
```

### 3. Remove `verifyMigration(dir)`

Delete `verifyMigration` from `hash.ts` (renamed from `attestation.ts`) and its re-export in `src/exports/`. Update the unit tests that call `verifyMigration` to call `readMigrationPackage` directly and assert on the thrown `MigrationToolsError`.

`verifyMigrationHash` (renamed from `verifyMigrationBundle`) stays — see Decision 2.

### 4. Drop the CLI verification loop

In `packages/1-framework/3-tooling/cli/src/commands/migration-apply.ts`:

- Delete lines 213-233 (the `for (const bundle of migrations.bundles)` loop).
- Delete the now-unused `verifyMigrationBundle` import on line 1.
- The structured error from `loadAllMigrationPackages` (renamed from `loadAllBundles`) propagates to the CLI's existing top-level error renderer; the user-visible diagnostic is preserved (and unified — every command surfaces the same shape).

### 5. JSDoc on the runner SPI and framework operation

- `MigrationRunner.execute` in `packages/1-framework/1-core/framework-components/src/control-migration-types.ts`: add a paragraph noting that `plan` is treated as trusted input (already-verified package origin) and that callers obtain packages through `readMigrationPackage` to satisfy this invariant.
- `executeMigrationApply` in `packages/1-framework/3-tooling/cli/src/control-api/operations/migration-apply.ts`: same note on the operation function's docstring, applied to its `pendingMigrations` parameter.

### 6. TML-2301 coordination

The `Migration.run()` orchestrator's apply branch (added in TML-2301) loads on-disk migration packages to build the apply plan. It must use `readMigrationPackage` / `readMigrationsDir`, not raw `fs.readFile` + `JSON.parse`. This is a coordination requirement on TML-2301, not a code change in this spec — but the spec for TML-2301 is updated to reference this contract, and the implementation PR for TML-2301 lands after (or alongside) this one so the verifying loader exists when the orchestrator is wired.

The control client path (the `db update` apply flow that does not load on-disk packages, and any future `migration apply` invocation through the control client surface) is unchanged because it does not load `MigrationPackage`s today; if it ever does, it goes through the same primitive.

### 7. Type renames + file split

In `packages/1-framework/3-tooling/migration/src/`:

- Create `metadata.ts` with `MigrationMetadata` (renamed from `MigrationManifest`) and `MigrationHints`. Update the JSDoc that talks about "manifest envelope" to "metadata envelope".
- Create `package.ts` with `MigrationPackage` (renamed from `MigrationBundle`). Field renames: `manifest` → `metadata`. `dirName` and `dirPath` stay.
- Create `graph.ts` with `MigrationGraph` and `MigrationChainEntry`. The `migrationId` field on `MigrationChainEntry` becomes `migrationHash`.
- Delete `types.ts`.
- Update `attestation.ts` → `hash.ts`. Inside: `computeMigrationId` → `computeMigrationHash`; `verifyMigrationBundle` → `verifyMigrationHash`; `VerifyResult.storedMigrationId/computedMigrationId` → `storedHash/computedHash`. Move the structural-canonicalization JSDoc onto `computeMigrationHash` (see [Documentation home](#documentation-home)).
- Update `io.ts`: the arktype `MigrationManifestSchema` → `MigrationMetadataSchema`; the `migrationId: 'string'` field → `migrationHash: 'string'`; local variable `manifest` → `metadata`; local variable `manifestPath` → `metadataPath` in the in-memory paths (where the value is talking about the parsed object, not the file). Where the variable refers to the on-disk file path string, keep the file-vocabulary name (e.g. the actual `migration.json` filename constant `MANIFEST_FILE` stays, since it names the file, not the in-memory record).
- Update `errors.ts`: rename `errorDuplicateMigrationId` → `errorDuplicateMigrationHash` and its code `MIGRATION.DUPLICATE_MIGRATION_ID` → `MIGRATION.DUPLICATE_MIGRATION_HASH`. Add the new `errorMigrationHashMismatch` (Change 2). Update prose in unrelated factories that mention "migrationId" to say "migrationHash" instead.
- Update `migration-base.ts`: imports from `./types` → from `./metadata`, `./package`, etc. The `manifest` local variable in `buildAttestedManifest` keeps its name (the function genuinely is constructing the file-shaped manifest at write time); the `migrationId` local at line 170 becomes `migrationHash`. The function's own JSDoc updated.
- Update `dag.ts`: imports updated; `pkg.manifest.migrationId` → `pkg.metadata.migrationHash`; `entry.migrationId` → `entry.migrationHash`; comments and ordering documentation updated.
- Update `src/exports/`:
  - `exports/attestation.ts` → `exports/hash.ts` (or rename file in place + update `package.json` `exports`).
  - `exports/io.ts` unchanged structurally; type imports updated.
  - `exports/types.ts` either deleted (and replaced with `exports/metadata.ts` + `exports/package.ts` + `exports/graph.ts` subpaths) or kept as a barrel — see Open question 1.
- Update `package.json` `exports` field: rename `./attestation` → `./hash`. Add or replace `./types` per Open question 1.

### 8. CLI helper renames

In `packages/1-framework/3-tooling/cli/src/utils/command-helpers.ts`:

- `loadMigrationBundles` → `loadMigrationPackages`.
- `loadAllBundles` → `loadAllMigrationPackages`.
- `MigrationBundleSet` → `MigrationPackageSet` (or whatever the wrapping type is called; one search-and-replace).
- All call sites in `migration-apply.ts`, `migration-plan.ts`, `migration-status.ts`, etc. updated.

### 9. Wire-format codemod for `migration.json` files

A one-off TypeScript script (`scripts/rename-migration-id-field.ts` or run inline via `pnpm exec`) walks every `migration.json` under the repo and renames the top-level field `migrationId` → `migrationHash`:

```typescript
import { glob } from 'glob';
import { readFile, writeFile } from 'node:fs/promises';

for (const path of await glob('**/migration.json', { ignore: 'node_modules/**' })) {
  const json = JSON.parse(await readFile(path, 'utf-8'));
  if ('migrationId' in json) {
    const { migrationId, ...rest } = json;
    await writeFile(path, JSON.stringify({ migrationHash: migrationId, ...rest }, null, 2) + '\n');
  }
}
```

The script runs once during the PR (committed output); it is not retained as a long-term tool. The 113 fixture files under `examples/**/migration-fixtures/` and the example app migrations under `examples/**/migrations/` all get updated. Hash values are unchanged because `computeMigrationHash` strips the field before hashing.

### 10. README + JSDoc refresh

In `packages/1-framework/3-tooling/migration/README.md`:

- Update terminology throughout (`MigrationBundle` → `MigrationPackage`, `migrationId` → `migrationHash`, etc.).
- Replace the "Attestation framing" section with a corrected description matching the post-ADR-199 hash shape (2-part tuple, stripped metadata + ops).
- Update the architecture mermaid diagram to reflect the new file names (`hash.ts`, `metadata.ts`, etc.).
- Update the "Export Subpaths" table.

## Acceptance criteria

### Behavioral

- [ ] `readMigrationPackage` throws `MigrationToolsError { code: 'MIGRATION.HASH_MISMATCH' }` when `metadata.migrationHash` does not match the recomputed hash. The error carries `dir`, `storedHash`, `computedHash` in `details`.
- [ ] `readMigrationsDir` propagates the same error when any of its child packages fails the integrity check.
- [ ] Tampering with `ops.json` (e.g. appending an extra op, removing one, reordering) causes every CLI command that loads the package to fail loudly: `migration apply`, `migration plan`, `migration status`, `migration show`, `migration new`. Same outcome for `migration.json` field tampering (e.g. mutating `labels` while keeping the recorded `migrationHash`).
- [ ] The CLI surfaces the same human-readable diagnostic regardless of which command triggered the load (the `errorMigrationHashMismatch` `why` + `fix` text is the user-visible output).
- [ ] `migration apply` with an intact package is unchanged — same exit code, same logs, same applied state. The deleted explicit loop is functionally equivalent to verification-at-load.

### Structural

- [ ] `verifyMigration(dir)` is deleted; no production source under `packages/` or `test/` references it.
- [ ] `verifyMigrationHash(pkg)` exists at `migration-tools/src/hash.ts` and exposes `{ ok, reason, storedHash, computedHash }`.
- [ ] `migration-apply.ts` no longer imports `verifyMigrationBundle` (or `verifyMigrationHash`) and no longer contains a per-package verification loop.
- [ ] `MigrationRunner.execute` and `executeMigrationApply` carry JSDoc stating that callers are responsible for upstream verification (via `readMigrationPackage`).
- [ ] `types.ts` is deleted; `metadata.ts`, `package.ts`, `graph.ts` exist with the per-concept types listed in [File layout](#file-layout).
- [ ] `attestation.ts` is renamed to `hash.ts`; `package.json` `exports` updated.
- [ ] All TypeScript identifiers `migrationId` → `migrationHash`, `MigrationBundle` → `MigrationPackage`, `MigrationManifest` → `MigrationMetadata`, `bundle.manifest` → `pkg.metadata`, `loadMigrationBundles` → `loadMigrationPackages`, `loadAllBundles` → `loadAllMigrationPackages` across `packages/`. (Exception: `MigrationMeta` in `migration-base.ts` is kept as-is — see [Vocabulary](#vocabulary) note and Open question 3.)
- [ ] All on-disk `migration.json` files (113 in repo) carry `migrationHash` instead of `migrationId`.
- [ ] `computeMigrationHash` carries the structural-canonicalization JSDoc verbatim (see [Documentation home](#documentation-home)).
- [ ] No new public surface beyond `errorMigrationHashMismatch`. The renames are not new surface — they replace existing surface.

### Tests

- [ ] Unit tests in `packages/1-framework/3-tooling/migration/test/`:
  - `readMigrationPackage` happy path is unchanged (existing test, names updated).
  - `readMigrationPackage` throws `MIGRATION.HASH_MISMATCH` when `ops.json` is tampered post-write.
  - Same when a `migration.json` field other than `migrationHash` is tampered.
  - The error's `details` carries `dir`, `storedHash`, `computedHash`.
- [ ] CLI integration tests in `packages/1-framework/3-tooling/cli/test/commands/`:
  - One per command that loads packages (`migration apply`, `migration plan`, `migration status`, `migration show`): set up a valid package directory, mutate either `ops.json` or `migration.json` post-write, run the command, assert it exits non-zero with the `MIGRATION.HASH_MISMATCH` diagnostic.
  - Existing happy-path integration tests for these commands continue to pass after the wire-format codemod runs.
- [ ] Fixture-driven tests under `examples/**/migration-fixtures/` continue to pass after the codemod (the migration graph reconstructs correctly from the renamed JSON field).

## Non-functional requirements

- **No new runtime cost on the apply hot path.** The hash recomputation is O(canonical-JSON serialization) per package and was already happening once per command. Moving it from one consumer (CLI `migration apply`) into the loader does not change the total work — it just runs in one place.
- **No new public surface to maintain.** The visible API delta is one new error code (`MIGRATION.HASH_MISMATCH`), one removed function (`verifyMigration`), one new error factory, and an invariant note in two pieces of JSDoc. Renames replace existing surface; they do not add to it.
- **Plane-clean.** All changes live in `@prisma-next/migration-tools` (migration plane) and `@prisma-next/cli` (migration plane). No new cross-plane edges, no target-specific code.

## Out of scope

- **Emit-drift detection** (ADR 192 step 2): re-emitting `migration.ts` in-memory at apply time and comparing the resulting hash to `ops.json`. This catches a different failure mode (the user edited `migration.ts` after emit and forgot to re-run it) and requires loading + executing the user's TypeScript module at apply time, which is a much larger change. File a separate Linear issue under WS4 / M11; link it from this spec.
- **Schema verification** (does the live database match the contract before/after apply). Different concern, covered elsewhere (e.g. `verifySqlSchema`).
- **Signature / cryptographic provenance** of `migration.json`. The schema already accommodates a `signature` field but no signing flow exists; out of scope here.
- **Changes to the runner SPI or `MigrationPlan` shape.** The runner stays consuming a stripped `MigrationPlan` with no `migrationHash`. Verification happens upstream of plan construction.
- **`db update` / `db init`.** These do not load on-disk migration packages, so they are not affected.
- **Splitting `framework-components/src/control-migration-types.ts`.** Noted as an opportunity in [Out-of-scope opportunities](#out-of-scope-opportunities-noted-not-addressed); a separate PR scoped to that package.
- **Splitting `errors.ts` further.** Same; noted as an opportunity, not done here.
- **Renaming `MigrationMeta` (in `migration-base.ts`).** Coordinated with TML-2301's `migration-base.ts` split.

## Open questions

1. **`./types` export subpath.** Once `types.ts` is split into `metadata.ts` / `package.ts` / `graph.ts`, do we (a) replace the single `./types` subpath in `package.json` with three subpaths (`./metadata`, `./package`, `./graph`), or (b) keep `./types` as a barrel that re-exports from all three? **Default:** (a). It enforces narrower imports at consumers (a rule the repo already favors — see `.cursor/rules/no-barrel-files.mdc`) and surfaces accidental cross-concept coupling. Cost: ~10 import-statement updates across consumers.
2. **`errorMigrationHashMismatch` export visibility.** Export from `@prisma-next/migration-tools/errors` (mirrors the other `errorXxx` factories) or keep private to the loader? **Default:** export it — easier for `Migration.run()` (TML-2301) to surface the same error shape if it ever wants to trigger one before the loader has run, and consistent with the rest of the file.
3. **Rename `MigrationMeta` → `MigrationDescription` in `migration-base.ts`?** Currently confusingly close to `MigrationMetadata` after this PR. **Default:** no — coordinate with TML-2301's `migration-base.ts` split. If TML-2301 lands first, this PR can pick up the rename trivially; if this PR lands first, TML-2301 picks it up.
4. **Wire-format codemod commit organization.** Single commit for the field rename across all 113 files, or split into `examples/<app>/`-scoped commits? **Default:** single commit — they're a mechanical batch and reviewing them individually adds no signal.

## References

- [TML-2264 (this ticket)](https://linear.app/prisma-company/issue/TML-2264/migration-runner-should-verify-migration-matches-its-hash)
- [TML-2301 — Migration control-adapter DI + `Migration` base split](https://linear.app/prisma-company/issue/TML-2301) (sibling; coordinate)
- [ADR 192 — `ops.json` is the migration contract](../../docs/architecture%20docs/adrs/ADR%20192%20-%20ops.json%20is%20the%20migration%20contract.md) (apply-time verification, two-step model)
- [ADR 199 — Storage-only migration identity](../../docs/architecture%20docs/adrs/ADR%20199%20-%20Storage-only%20migration%20identity.md) (`migrationHash` definition; written using the old `migrationId` term — not retroactively edited)
- [Migration System subsystem doc](../../docs/architecture%20docs/subsystems/7.%20Migration%20System.md)
- Implementation (current names): `packages/1-framework/3-tooling/migration/src/{attestation.ts,io.ts,errors.ts,types.ts}`
- Existing CLI loop being removed: `packages/1-framework/3-tooling/cli/src/commands/migration-apply.ts:213-233`
- Loader helpers: `packages/1-framework/3-tooling/cli/src/utils/command-helpers.ts:154-175`
- Execution plan: [`plan.md`](./plan.md)
