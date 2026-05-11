# Spec — Contract-space on-disk shape

- **Origin:** Pre-launch shape-locking discussion (recorded in this branch's chat transcript). Two correlated on-disk-contract issues surfaced together; folded into one slice because they touch the same files. A third related concern — repo-wide normalisation of "artefact" → "artifact" (this project drifted from the repo's prevailing convention) — is tracked separately on M5 as part of close-out hygiene; see plan §M5.
- **Linear ticket:** TML-2397 (the project this amends). Optionally split into a sub-issue if planning prefers; the implementation footprint is small enough to land as a single PR-tier task on M2.5.
- **Branch to amend:** `tml-2397-contract-space-aggregate` (M2.5). Lands as a single commit on top of the current M2.5 head.
- **Stack to re-rebase:** M3 / M4 / M5 (`tml-2397-cipherstash-contract-space`, `tml-2397-pgvector-contract-space`, `tml-2397-remove-database-dependencies-and-closeout`) all rebase onto the amended M2.5 head. The cascade is well-rehearsed at this point and expected to be near-clean (these branches already author under `<spaceId>/` for their own extensions; the only collisions are in-tree fixtures and tests that happen to walk root-level migrations).

## Why now

External consumers of the framework are essentially zero today; that ends at next week's public launch. Structural changes to the on-disk contract are nearly free in the current window (only in-tree fixtures and examples need updating) and become a coordination tax once external projects exist (codemods, deprecation cycles, support burden). Two on-disk shape questions with clear "right answers" are open; we lock them now or pay later.

The two changes:

1. **Subspace the app.** Today the app's migrations live at the root of `migrations/`; extensions live under `migrations/<spaceId>/`. The asymmetry is a leftover from before the contract-space concept existed. Make the layout uniform: the app gets a subdirectory named after its space ID (default `app`).
2. **Drop the "pinned" qualifier.** `emitPinnedSpaceArtefacts`, `PinnedSpaceArtefactInputs`, `PinnedSpaceHeadRef`, and the file name `emit-pinned-space-artefacts.ts` carry a `Pinned` qualifier that has no antonym — every contract-space artefact on disk is by definition a snapshot pinned at emit time. The qualifier is dead weight. Drop it.

These are correlated: `emitPinnedSpaceArtefacts` currently *rejects* the app space (`errorPinnedArtefactsAppSpace`), reflecting today's asymmetry. Once the layout is uniform, that rejection is gone, the function accepts every space the same way, and the natural name is `emitContractSpaceArtefacts`. One commit, both changes.

> The "artefact" spelling stays in this slice's renames (e.g. `emit-contract-space-artefacts.ts`). The repo-wide normalisation to "artifact" is the close-out hygiene task on M5, which produces a single focused diff that's easy to review in isolation. The cost — one extra `git mv` per file already being renamed here — is negligible.

## At a glance

### On-disk layout (after this slice)

```
migrations/
  <appSpaceId>/                       # default 'app'; renames at TML-2457
    contract.json                     # canonical app contract snapshot
    contract.d.ts                     # rendered .d.ts text
    refs/
      <refName>.json                  # ref name is descriptor-controlled;
                                      # extensions use 'head' by convention
    <ts>_<slug>/                      # migration package
      migration.json                  # manifest envelope (ADR 197)
      ops.json                        # operation list
      contract.json                   # post-state contract snapshot
  <extensionSpaceId>/                 # e.g. 'cipherstash', 'pgvector'
    contract.json
    contract.d.ts
    refs/
      <refName>.json
    <ts>_<slug>/
      migration.json
      ops.json
      contract.json
```

### Discriminator typology (no manifest at the root)

A directory is identified by its contents, not by its name or position:

| In a directory under `migrations/<spaceId>/`               | …if it contains          | …it is              |
|------------------------------------------------------------|--------------------------|---------------------|
| `migrations/<spaceId>/`                                    | `contract.json`          | a contract space    |
| `migrations/<spaceId>/<dir>/`                              | `migration.json`         | a migration package |
| `migrations/<spaceId>/refs/`                               | `<refName>.json` files   | a refs dir          |

The loader's space-discovery walk becomes uniform: `readdir(migrations/)` → for each subdirectory, validate "is this a contract space" by checking for `contract.json`. No app-vs-extension branch.

## Required reading (in order)

1. **`packages/1-framework/3-tooling/migration/src/space-layout.ts`** — the helper carrying the asymmetry; this slice flattens its branch into a one-liner.
2. **`packages/1-framework/3-tooling/migration/src/emit-pinned-space-artefacts.ts`** — the helper this slice renames (`emit-contract-space-artefacts.ts`) and whose app-space rejection (`errorPinnedArtefactsAppSpace`) this slice deletes.
3. **`packages/1-framework/3-tooling/migration/src/exports/spaces.ts`** — the public re-export surface; updated identifier names propagate from here.
4. **`packages/1-framework/3-tooling/cli/src/control-api/operations/db-init.ts`** — the writer that creates the first app migration; updated to write under `migrations/<appSpaceId>/`.
5. **`projects/extension-contract-spaces/specs/contract-space-aggregate-spec.md`** — the M2.5 aggregate spec; this slice's layout symmetry is the on-disk realisation of the aggregate's runtime symmetry. No textual amendment needed (the aggregate spec is layout-agnostic).

## Required changes

### 1. `spaceMigrationDirectory` becomes uniform

```ts
// packages/1-framework/3-tooling/migration/src/space-layout.ts
export function spaceMigrationDirectory(
  projectMigrationsDir: string,
  spaceId: string,
): string {
  assertValidSpaceId(spaceId);
  return join(projectMigrationsDir, spaceId);
}
```

The `if (spaceId === APP_SPACE_ID) return projectMigrationsDir` branch is deleted. `APP_SPACE_ID` is still validated by `assertValidSpaceId` (it matches `[a-z][a-z0-9_-]{0,63}` — the literal `'app'` is valid).

### 2. Drop the app-space rejection in artefact emission

```ts
// emit-contract-space-artefacts.ts (renamed file)
export async function emitContractSpaceArtefacts(
  projectMigrationsDir: string,
  spaceId: string,
  inputs: ContractSpaceArtefactInputs,
): Promise<void> {
  assertValidSpaceId(spaceId);
  const dir = join(projectMigrationsDir, spaceId);
  await mkdir(join(dir, 'refs'), { recursive: true });
  // …unchanged contents below…
}
```

- `errorPinnedArtefactsAppSpace` is deleted (no callers will need it; if anything still references it, that's a layering bug to surface).
- The function accepts every space uniformly.

### 3. `db init` writes the first app migration under `migrations/<appSpaceId>/`

The writer in `db-init.ts` (and any peer in `db-update.ts`) that currently constructs a path like `<migrationsDir>/<package.dirName>/migration.json` for the app must route through `spaceMigrationDirectory(<migrationsDir>, <appSpaceId>)` first. After step 1, this is automatic if all writers already use the helper; spot-check that no caller hardcodes the root-level path.

### 4. Drop the "pinned" qualifier — file/identifier sweep

| Before                              | After                                   |
|-------------------------------------|-----------------------------------------|
| `emit-pinned-space-artefacts.ts`    | `emit-contract-space-artefacts.ts`      |
| `read-pinned-space-contract.ts`     | `read-contract-space-contract.ts` (or fold into a single `read-contract-space-state.ts` if it's natural) |
| `read-pinned-contract-hash.ts`      | `read-contract-space-head-hash.ts`      |
| `read-pinned-head-ref.ts`           | `read-contract-space-head-ref.ts`       |
| `emit-pinned-space-artefacts.test.ts` | `emit-contract-space-artefacts.test.ts` |
| `read-pinned-contract-hash.test.ts` | `read-contract-space-head-hash.test.ts` |
| `read-pinned-head-ref.test.ts`      | `read-contract-space-head-ref.test.ts`  |
| `emitPinnedSpaceArtefacts`          | `emitContractSpaceArtefacts`            |
| `PinnedSpaceArtefactInputs`         | `ContractSpaceArtefactInputs`           |
| `PinnedSpaceHeadRef`                | drop the redeclared mirror; import `ContractSpaceHeadRef` directly from `@prisma-next/framework-components/control` (the canonical type) — confirmed allowed by current layering. |
| `errorPinnedArtefactsAppSpace`      | deleted (see §2)                        |
| JSDoc / comment strings using "pinned" | rephrased without the qualifier      |

Acceptance bar: `rg -i pinned packages/` returns matches only in (a) intentional historical references (e.g. ADR text describing a past state — none expected), or (b) zero matches outside ADR docs.

> "Artefact" → "artifact" spelling normalisation is **not** done in this slice. File names produced here keep the "artefact" spelling (e.g. `emit-contract-space-artefacts.ts`); identifiers stay `emitContractSpaceArtefacts` / `ContractSpaceArtefactInputs`. The repo-wide normalisation lands as a focused, separate close-out task on M5 (one `git mv` per file plus mechanical text replacement, isolated diff easy to review). See plan §M5 for the task definition.

### 5. In-tree fixtures and examples relocate

Every fixture / example that currently writes app migrations to `migrations/<package>/` updates to `migrations/<appSpaceId>/<package>/`. Touched packages (non-exhaustive):

- `test/integration/test/contract-space-fixture/` (the relocated synthetic fixture)
- `test/integration/test/**` test files that hardcode `migrations/<package>` paths
- `examples/*` projects with on-disk migrations
- The cipherstash and pgvector packages' on-disk-in-package authoring (already use `<spaceId>/`; verify still correct)
- CLI snapshot tests that capture migration directory layouts

This is the bulk of the diff. Mostly mechanical path updates; readable in review as `s|migrations/<oldPath>|migrations/app/<oldPath>|` or equivalent for non-default app space IDs (none today).

## Acceptance criteria

- **AC1.** `spaceMigrationDirectory(root, APP_SPACE_ID)` returns `<root>/<APP_SPACE_ID>` (no special case). Validated by a unit test in `migration-tools`.
- **AC2.** `db init` on a fresh project creates `migrations/<APP_SPACE_ID>/<package>/migration.json` (not `migrations/<package>/migration.json`). Validated by an integration test that walks the on-disk layout after `db init`.
- **AC3.** The aggregate loader's space-discovery walk is uniform: `for entry of readdir(migrationsRoot): if entry/contract.json exists → it's a contract space`. No `entry === APP_SPACE_ID`-style branch in the loader. Validated by inspection + integration test that loads an aggregate with both app and one extension and asserts both surface symmetrically.
- **AC4.** `rg -i 'pinned' packages/` returns zero matches in `*.ts` files (excluding intentional ADR-doc historical references, expected to be zero today).
- **AC5.** All renamed identifiers compile and are exported under their new names. `rg 'emitPinnedSpaceArtefacts|PinnedSpaceArtefactInputs|PinnedSpaceHeadRef' packages/` returns zero matches.
- **AC6.** `emitContractSpaceArtefacts(root, APP_SPACE_ID, inputs)` succeeds (no `errorPinnedArtefactsAppSpace` thrown) and produces the expected files under `<root>/<APP_SPACE_ID>/`. Validated by an existing or new test in `migration-tools`.
- **AC7.** Validation gates pass: `pnpm typecheck`, `pnpm lint:deps`, `pnpm test:packages`, `pnpm test:integration`.
- **AC8.** A `git grep` for the discriminator pattern (`spaceId === APP_SPACE_ID && returns root`) returns zero matches in `packages/`. The asymmetry is fully extinct in code paths.

## Test plan

- **Unit (migration-tools)**
  - `spaceMigrationDirectory` returns `<root>/app` for `APP_SPACE_ID`.
  - `assertValidSpaceId('app')` does not throw.
  - `emitContractSpaceArtefacts` accepts `APP_SPACE_ID` (test added) and writes to `<root>/app/`.
- **Integration (in-tree fixtures + integration-tests)**
  - The relocated synthetic fixture (`contract-space-fixture`) emits to `migrations/<spaceId>/` for both app and extensions; aggregate loader reads them symmetrically.
  - `db init` end-to-end: starting from an empty project, the resulting tree contains `migrations/app/<package>/` (and not `migrations/<package>/` directly).
- **Snapshot tests**
  - CLI snapshot tests that capture migration directory layouts are updated. Diff is mechanical.
- **Sweep verification**
  - The AC4 / AC5 / AC8 ripgrep checks are runnable as a one-shot `bash` script in CI or by hand at PR review time.

## Out of scope / explicitly not doing

- **Configurable `appSpaceId` (TML-2457).** Out of scope. The default stays `'app'`. This slice is forward-compatible: when TML-2457 lands, the directory simply renames to whatever the user chose. No migration of on-disk shape is needed at that point — only a directory rename + a config-file change.
- **A manifest file at `migrations/` listing the spaces.** Not needed; directory enumeration self-describes via the discriminator typology.
- **Codemod / legacy-layout fallback in the loader.** External consumers are zero. In-tree fixtures and examples are updated atomically in this slice. Hard cutover.
- **Renaming "head" as the convention ref name.** Ref names are descriptor-controlled values; the framework does not prescribe `head`. Extensions converge on `head` by convention but can choose differently.
- **Touching `migration.json` / `ops.json` / `contract.json` file names.** Settled (`migration.json` is a presence-discriminator for migration directories per the typology table; the others are stable).
- **"Artefact" → "artifact" spelling normalisation.** Tracked separately on M5 as a close-out hygiene task (see plan §M5). Files renamed in this slice keep the "artefact" spelling for now; they get a second `git mv` in the M5 sweep. The cost (one extra rename per file) is negligible and the conceptual separation makes both PRs easier to review in isolation.

## Implementation footprint

Files modified (estimated, based on `rg` sweeps at draft time):

- `packages/1-framework/3-tooling/migration/src/space-layout.ts` — flatten branch.
- `packages/1-framework/3-tooling/migration/src/emit-pinned-space-artefacts.ts` → `emit-contract-space-artefacts.ts` — rename file, drop app-space rejection, rename identifiers.
- `packages/1-framework/3-tooling/migration/src/read-pinned-space-contract.ts` → renamed.
- `packages/1-framework/3-tooling/migration/src/read-pinned-contract-hash.ts` → renamed.
- `packages/1-framework/3-tooling/migration/src/errors.ts` — drop `errorPinnedArtefactsAppSpace`.
- `packages/1-framework/3-tooling/migration/src/exports/spaces.ts` — propagate renames.
- `packages/1-framework/3-tooling/cli/src/control-api/operations/db-init.ts` — verify path-construction routes through `spaceMigrationDirectory` for the app space.
- `packages/1-framework/3-tooling/cli/src/control-api/operations/db-update.ts` — same check.
- The aggregate loader (`packages/1-framework/3-tooling/migration/src/load-contract-space-aggregate.ts` or wherever it lives post-M2.5) — uniform space-discovery walk; drop any app-vs-extension special case.
- In-tree fixtures, examples, and integration tests that hardcode `migrations/<package>/` paths for the app — update to `migrations/<appSpaceId>/<package>/`.
- ADR 211 (if it exists post-rebase) — append a "M2.5 follow-on: uniform on-disk layout" note. If ADR 211 is still under M5 close-out, defer the doc-edit until that branch is reached during the cascade re-rebase.

## Risk

- **Re-rebase cost.** M3/M4/M5 must rebase onto the amended M2.5 head. The chain is well-rehearsed; expected to be near-clean. Any surprises would surface in the same kind of shell-subagent fix-up commit pattern the prior cascades used.
- **Snapshot churn.** Any test snapshotting on-disk paths will diff. Mechanical update; not a correctness concern.
- **Hidden hardcoded path.** If a fixture or test bypasses `spaceMigrationDirectory` and constructs a path manually (`migrationsRoot + '/' + dirName`), it'll write to the old location and silently mismatch the loader. Mitigation: AC8 (a `rg` search for hardcoded `migrations/` patterns at PR review). One-shot grep, easy to audit.

## Sequencing

Single commit on `tml-2397-contract-space-aggregate` (M2.5):

```
fix(migration): unify on-disk layout — app subspaces under <appSpaceId>/; drop "pinned" qualifier

Closes the last leg of the contract-space symmetry: the on-disk layout
now matches the runtime aggregate (app and extensions both live at
migrations/<spaceId>/). The "pinned" qualifier on the artefact-emitter
helpers was an antonym-less label and is dropped in the same diff.

Pre-launch shape-locking; no codemod needed (zero external consumers).
In-tree fixtures and examples relocate atomically.

The repo-wide "artefact" → "artifact" spelling normalisation is the
M5 close-out task tracked separately.

Refs: TML-2397
```

Then cascade re-rebase: M3 → M4 → M5 onto the amended M2.5 head. Per the prior cascade's pattern: backup tags, `git rebase --onto NEW-M2.5 OLD-M2.5 BRANCH`, expect mostly-clean replays.

## Open questions

None blocking. Two minor questions an implementer can decide in-flight:

1. Whether `read-pinned-space-contract.ts` and `read-pinned-contract-hash.ts` are kept as separate files (renamed) or folded into a single `read-contract-space-state.ts`. Mild preference for folding if the call patterns are similar; not worth blocking the PR over.
2. Whether to keep `PinnedSpaceHeadRef` as a redeclared local mirror or remove it in favour of importing `ContractSpaceHeadRef` directly. Mild preference for removal; verify the layering allows it (`migration-tools` depends on `framework-components/control` for `APP_SPACE_ID` already, so the answer is almost certainly yes).
