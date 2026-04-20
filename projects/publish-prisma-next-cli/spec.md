# Summary

Publish the `@prisma-next/cli` package under the unscoped NPM name `prisma-next` by introducing a thin **bin-only** shim package (`packages/1-framework/3-tooling/prisma-next/`) whose build copies the CLI's `dist/` into its own, giving us a curated public package name and README. The shim exposes only the `prisma-next` binary — no library exports — so nothing can ever `import` from it.

# Description

Today the CLI is named `@prisma-next/cli` internally and is imported under that name from ~21 packages and several example apps. We want the **public-facing** NPM package to be called `prisma-next` for brand and ergonomics (`npm i -D prisma-next`, `npx prisma-next …`), but we do **not** want the churn of renaming internal imports or the dilution of the `@prisma-next/*` scope convention for internal packages.

The chosen approach is a thin **bin-only shim package** at `packages/1-framework/3-tooling/prisma-next/` whose sole responsibility is to:

1. Ship the `prisma-next` binary, backed by a verbatim copy of `@prisma-next/cli/dist/` so that at runtime there is **zero module/process indirection** between `npx prisma-next` and the real CLI entry point.
2. Own a curated, user-facing README and package description (independent of the internal CLI README, which remains as architecture/internal documentation).
3. Expose **no** library exports: no `main`, no `types`, no `exports` map. The shim is a CLI distribution vehicle, not an import target. Consumers who need the programmatic API, low-level `defineConfig`, or other CLI subpaths (`config-types`, `control-api`, `commands/*`, `config-loader`) import them from `@prisma-next/cli` directly and accept that package's stability contract.

This shape matches how CLI-first packages are conventionally distributed on npm (`eslint`, `prettier`, the `typescript` binary, `prisma` itself): the user-facing package provides the command, and companion scoped packages provide library APIs.

This design was chosen over two alternatives:

- **Rename the CLI package in place** (`@prisma-next/cli` → `prisma-next`): rejected because it requires updating ~30+ internal references and broadens the import allowlist enforcement to an unscoped name.
- **A bin-only re-export shim** (shim's `bin` spawns/imports `@prisma-next/cli`'s installed dist): rejected because it adds runtime indirection and ships two separate installed packages where the end user only ever invokes one.

The work also establishes a forward path: if we later want to inline the CLI's internal `@prisma-next/*` dependencies into the shim so they don't need to be published ("Flavor 2" in the design discussion), the public surface of `prisma-next` stays identical, so the upgrade is non-breaking within our current `0.x` line.

# Requirements

## Functional Requirements

### Shim package shape

- **F1**: Create a new package at `packages/1-framework/3-tooling/prisma-next/` with `name: "prisma-next"`. The package sits in the framework tooling layer alongside `@prisma-next/cli` since architecturally it is the same layer (a top-of-dependency-tree tool), and the unprefixed package name is a deliberate user-facing choice rather than an architectural signal.
- **F2**: The shim package has no hand-written source in its final shipped output; all behavior is inherited from `@prisma-next/cli`.
- **F3**: The shim declares `@prisma-next/cli` as a `devDependency` (`workspace:*`) so pnpm schedules the CLI build before the shim build, but does **not** declare `@prisma-next/cli` as a runtime dependency (the code is copied in at build time, not resolved at runtime).
- **F4**: The shim's `package.json` `version` is kept in lockstep with `@prisma-next/cli`'s version. Since the repository is in the `0.x` range, version bumps are managed manually alongside the CLI's version until release tooling lands.

### Build — populated `dist/`

- **F5**: Running `pnpm -F prisma-next build` produces a `packages/prisma-next/dist/` directory containing the full output of `packages/1-framework/3-tooling/cli/dist/`, including `cli.mjs`, `cli.js` (the compatibility shim with `#!/usr/bin/env node`), all subpath entrypoint `.mjs` + `.d.mts` files, and any auxiliary assets copied by the CLI's `tsdown` config.
- **F6**: The copy preserves file mode bits; the shim's `dist/cli.js` and `dist/cli.mjs` remain executable (`0o755`). The build script re-applies `chmod 0o755` as a belt-and-braces step regardless of underlying filesystem behavior.
- **F7**: The build is idempotent: re-running it produces byte-identical output, and a pre-existing stale `dist/` is removed before the copy.
- **F8**: `pnpm -F prisma-next clean` removes the shim's `dist/`.
- **F9**: The build script is implemented as a Node ESM script (`scripts/build.mjs` or equivalent), using `node:fs/promises` and `pathe`. It does not shell out to `cp`.

### Public surface — bin only

- **F10**: The shim's `package.json` declares **no** `exports` map, **no** `main`, and **no** `types`. Any `import '…' from 'prisma-next'` (or any subpath) must fail with a Node module-resolution error. This is a hard invariant: the shim is a CLI distribution vehicle, never an import target.
- **F11**: The shim's `package.json` `bin` field is `{ "prisma-next": "./dist/cli.js" }` — structurally identical to the CLI's, pointing at the shim's own copied compat shim.
- **F12**: The shim's `package.json` `dependencies` mirror `@prisma-next/cli`'s `dependencies` exactly (all third-party packages and all `@prisma-next/*` runtime deps), so that Node resolves external imports in the copied `dist/` from the shim's own `node_modules` when the CLI binary runs.
- **F13**: The shim's `package.json` does **not** include the CLI's `devDependencies`; only runtime deps and the devDep on `@prisma-next/cli` itself are needed.
- **F14**: The shim's `files` field publishes only `["dist"]`. It does not publish `src`, `scripts`, or test fixtures.
- **F15**: The shim's `package.json` includes `"type": "module"`, `"sideEffects": false`, and a `repository` field consistent with the rest of the workspace.

### Drift lint

- **F16**: A lint script at `packages/1-framework/3-tooling/prisma-next/scripts/lint-sync.mjs` compares the shim's `package.json` against the CLI's `package.json` and fails with a clear error when any of the following drift:
  - `dependencies` map (keys and values must be identical)
  - `bin` map (keys and values must be identical)
  - `version` (must be identical)
  The lint also fails if the shim's `package.json` declares `exports`, `main`, or `types` at all — these fields violate F10 and must not be present.
- **F17**: The lint script is wired into the shim's `package.json` `scripts` (`"lint": "node scripts/lint-sync.mjs"`) and runs as part of the workspace-wide lint flow (`pnpm -r lint` or the project's existing lint orchestrator).
- **F18**: When drift is detected, the lint script prints the specific fields that diverge and an actionable fix message (e.g. "update `packages/1-framework/3-tooling/prisma-next/package.json` to match these fields in `@prisma-next/cli`: …").

### Internal-package labeling (forward compatibility)

- **F19**: The README of each `@prisma-next/*` package whose code is a pure implementation detail of the CLI (not imported by user-authored configs) gains a short "Internal package" notice stating that the package is published solely to support `prisma-next`'s runtime, that its API is unstable, and that users should not depend on it directly. The target set is:
  - `@prisma-next/config`
  - `@prisma-next/contract`
  - `@prisma-next/emitter`
  - `@prisma-next/migration-tools`
  - `@prisma-next/utils`
  - `@prisma-next/errors`
  - `@prisma-next/framework-components`
  - `@prisma-next/psl-printer`
- **F20**: The CLI's own package (`@prisma-next/cli`) gains a notice that reframes its role under the bin-only shim model: **for the CLI command, install `prisma-next`**; this package's subpath APIs (`@prisma-next/cli/config-types`, `@prisma-next/cli/control-api`, `@prisma-next/cli/commands/*`, `@prisma-next/cli/config-loader`) are the documented import target for authors of build integrations, extension packs, and advanced config wiring, but they are less stable than the facade packages (`@prisma-next/postgres/config`, `@prisma-next/mongo/config`). The CLI package continues to be published because both internal workspace consumers and external advanced users rely on it.

### Publish configuration

- **F21**: The shim's `package.json` declares `"publishConfig": { "access": "public" }` to ensure the first publish is public (not a no-op against a private registry) and to make intent explicit.
- **F22**: All `@prisma-next/*` packages that the shim transitively requires at runtime (the runtime deps mirrored from the CLI) remain publishable. No package needed at the end user's runtime becomes `"private": true` in this work.

### `init` command alignment

- **F23**: The `init` command in `@prisma-next/cli` (`packages/1-framework/3-tooling/cli/src/commands/init/init.ts`) is updated so that all places that install or reference `@prisma-next/cli` as a devDependency in the user's project instead install and reference `prisma-next`. Specifically:
  - The manual-steps note printed when `--no-install` is used names `prisma-next` in the devDep install command instead of `@prisma-next/cli`.
  - The automated install path invokes `<pm> add -D prisma-next` (via `formatAddDevArgs`) instead of `<pm> add -D @prisma-next/cli`.
  - The spinner labels and success/failure messages say "prisma-next" instead of "@prisma-next/cli".
- **F24**: Existing tests that assert the exact install arguments (`packages/1-framework/3-tooling/cli/test/commands/init/init.test.ts`, `detect-package-manager.test.ts`) are updated to expect `prisma-next` in place of `@prisma-next/cli`.
- **F25**: The `formatRunCommand(pm, 'prisma-next', …)` invocations in the init command (which invoke the `prisma-next` bin after install) already reference the `prisma-next` bin name and remain unchanged.

### `one-package-install` project updates

- **F26**: `projects/one-package-install/spec.md` is updated so that:
  - All user-facing install/run commands reference `prisma-next` instead of `@prisma-next/cli` (e.g., `pnpm dlx prisma-next init`, `npx prisma-next init`, etc.).
  - Generated-file examples (the `package.json` snippet on line 162 and the install spinner lines) reflect `prisma-next` as the installed devDep.
  - Functional requirements and acceptance criteria that name `@prisma-next/cli` as the installed devDep now name `prisma-next`.
  - Shell snippets in Implementation Guidance that show `pnpm add -D @prisma-next/cli` are updated to `pnpm add -D prisma-next`.
  - References to the low-level programmatic API (e.g., `defineConfig` from `@prisma-next/cli/config-types`) **stay** as `@prisma-next/cli/config-types`: `prisma-next` has no library exports (F10), so advanced users who need the low-level `defineConfig` import it from `@prisma-next/cli` directly. This is a deliberate asymmetry — the CLI command is distributed under the ergonomic `prisma-next` name; programmatic APIs keep the `@prisma-next/cli` address that signals their stability contract.
- **F27**: `projects/one-package-install/plan.md` is updated so task descriptions and command examples reference `prisma-next` instead of `@prisma-next/cli`.
- **F28**: `projects/one-package-install/user-journey.md` is updated so the roadblock narrative reflects the public package name `prisma-next` rather than `@prisma-next/cli`.

## Non-Functional Requirements

- **NF1**: Startup overhead of `npx prisma-next …` as installed from the shim is within 5% of startup overhead of running `./dist/cli.js` directly from a fresh `@prisma-next/cli` build. The dist-copy approach targets zero overhead in principle; 5% is measurement noise tolerance.
- **NF2**: The shim's build, excluding the CLI build it depends on, completes in under 2 seconds on a warm machine.
- **NF3**: The sync-lint script completes in under 500ms.
- **NF4**: The shim contributes no new direct third-party dependencies beyond what `@prisma-next/cli` already pulls in.
- **NF5**: `pnpm publish --dry-run` run against the shim package succeeds with no warnings other than those already present for workspace packages.

## Non-goals

- Renaming `@prisma-next/cli` internally, either in its `package.json#name` field or in the ~21 packages/examples that import it.
- Giving `prisma-next` any library exports. The shim is intentionally bin-only. Any subpath or root import from `prisma-next` must fail. Programmatic APIs keep the `@prisma-next/cli` import address.
- Trimming the shim's copied `dist/` to remove non-bin entry points. The copy is verbatim for simplicity. Tarball bloat from unreachable subpath files is acceptable in the short term and is trackable as a later optimization.
- Switching to the "Flavor 2" model where internal `@prisma-next/*` dependencies are bundled into the shim's `dist/` and no longer need to be published. This is an explicit follow-up deferred until the internal/public boundary stabilizes.
- Deprecating `@prisma-next/cli` on NPM. The CLI package continues to be published because internal workspace consumers — and external advanced users importing programmatic APIs — depend on it.
- Automated changelog or release tooling (changesets, semantic-release). Version bumps remain manual and lockstep; automation is out of scope and tracked separately.
- Publishing any package to NPM as part of this ticket. The ticket covers the build, lint, and packaging machinery only; the first actual `pnpm publish` is a separate action gated on coordination.
- Rewriting the CLI's existing README. The shim gets a new, curated README. The CLI's README stays as-is (internal/architecture documentation), with a short reframing notice for the bin-only model.
- Changing the CLI's `bin` name. The `bin` remains `prisma-next` as today; this ticket only aligns the NPM package name with the bin name.

# Acceptance Criteria

- [ ] A new package exists at `packages/1-framework/3-tooling/prisma-next/` with `name: "prisma-next"` and is recognized by the pnpm workspace (`pnpm -F prisma-next exec pwd` resolves to the package directory).
- [ ] Running `pnpm -F prisma-next build` in a clean checkout produces `packages/1-framework/3-tooling/prisma-next/dist/` containing `cli.js`, `cli.mjs`, and every subpath entrypoint file that `@prisma-next/cli/dist/` contains, byte-for-byte identical.
- [ ] `packages/1-framework/3-tooling/prisma-next/dist/cli.js` and `packages/1-framework/3-tooling/prisma-next/dist/cli.mjs` are executable (`stat -f %Lp` on macOS or `stat -c %a` on Linux reports `755`) after the build.
- [ ] Running `node packages/1-framework/3-tooling/prisma-next/dist/cli.js --version` from the workspace root prints the CLI version and exits 0.
- [ ] Running `node packages/1-framework/3-tooling/prisma-next/dist/cli.js --help` from the workspace root prints the standard Prisma Next CLI help output.
- [ ] The shim's `package.json` does **not** declare `exports`, `main`, or `types`. Attempting `import 'prisma-next'` or `import 'prisma-next/anything'` from a Node script with the shim installed raises `ERR_PACKAGE_PATH_NOT_EXPORTED` (or the equivalent resolution failure).
- [ ] The shim's `package.json` `dependencies` map has exactly the same keys and version ranges as `@prisma-next/cli`'s `dependencies` map.
- [ ] The shim's `package.json` `bin` map equals `{ "prisma-next": "./dist/cli.js" }`.
- [ ] The shim's `package.json` `files` array equals `["dist"]`.
- [ ] The shim's `package.json` `version` equals `@prisma-next/cli`'s `package.json` `version`.
- [ ] Running the sync-lint script with the shim and CLI `package.json`s in sync exits 0.
- [ ] Artificially introducing drift in any one of `dependencies`, `bin`, or `version`, or adding an `exports` / `main` / `types` field to the shim's `package.json`, causes the sync-lint script to exit non-zero with a message that names the offending field.
- [ ] `pnpm -r lint` runs the shim's sync-lint as part of workspace-wide linting.
- [ ] The shim has its own `README.md` at `packages/1-framework/3-tooling/prisma-next/README.md` intended for NPM users (short, user-focused: install, quickstart, command index, link to internal docs).
- [ ] Each internal-package README in the F19 target set contains a short notice that identifies the package as an internal implementation detail of `prisma-next`.
- [ ] `@prisma-next/cli`'s README contains a notice that directs users to install `prisma-next` for the CLI and explains that `@prisma-next/cli` is the programmatic-API import target for advanced users.
- [ ] `pnpm -F prisma-next publish --dry-run` succeeds and the published tarball's file list includes only files under `dist/`, `README.md`, `package.json`, and (where applicable) `LICENSE`.
- [ ] `pnpm -F prisma-next clean` removes `packages/1-framework/3-tooling/prisma-next/dist/`.
- [ ] Re-running `pnpm -F prisma-next build` after a clean produces byte-identical `dist/` contents across two runs.
- [ ] The `init` command in `@prisma-next/cli` installs `prisma-next` as a devDependency (not `@prisma-next/cli`) in both the automated install path and the `--no-install` manual-steps output.
- [ ] The `init` command's spinner labels and success/failure messages reference `prisma-next` instead of `@prisma-next/cli`.
- [ ] `init.test.ts` and `detect-package-manager.test.ts` pass with the updated expectations asserting `prisma-next` in install args.
- [ ] `rg '@prisma-next/cli' projects/one-package-install/` returns only references to the internal package relationship that are still accurate (e.g., historical context); no user-facing command or install instruction in that project still says `@prisma-next/cli`.
- [ ] `rg '@prisma-next/cli' packages/1-framework/3-tooling/cli/src/commands/init/ packages/1-framework/3-tooling/cli/test/commands/init/` returns no matches.

# Other Considerations

## Security

No new security surface. The shim does not parse input, execute user code, or make network calls; it is pure packaging machinery. The sync-lint script reads only two `package.json` files in the workspace.

The `load-ts-contract.ts` import allowlist remains scoped to `@prisma-next/*`, which continues to be correct because user-authored `prisma-next.config.ts` files still import from scoped package names. The shim does not affect user code.

## Cost

Negligible. No runtime infrastructure changes. NPM publish artifacts add ~one package at whatever size the copied CLI `dist/` is today (small).

## Observability

Not applicable — the shim is inert at runtime beyond delegating to the copied CLI binary. Any observability concerns belong to the CLI itself and are unchanged.

## Data Protection

Not applicable — no data is processed.

## Analytics

Not applicable.

# Implementation Guidance

## Suggested file layout

```
packages/1-framework/3-tooling/prisma-next/
  package.json           # name, bin, dependencies mirrored from CLI; NO exports/main/types
  README.md              # user-facing NPM README (curated)
  scripts/
    build.mjs            # clears dist, copies CLI dist, re-applies chmod 755
    lint-sync.mjs        # diffs shim's package.json vs CLI's; exits non-zero on drift
```

The shim sits alongside `@prisma-next/cli` in the framework tooling layer. The unprefixed npm name (`prisma-next`) is independent of its filesystem location.

The shim has no `src/`, no `tsdown.config.ts`, no `tsconfig.json` (nothing to compile), and no `test/` of its own. Tests of CLI behavior continue to live in the CLI package.

## `scripts/build.mjs` sketch

```js
import { chmod, cp, rm } from 'node:fs/promises';
import { resolve } from 'pathe';

const cliDist = resolve(import.meta.dirname, '../../cli/dist');
const shimDist = resolve(import.meta.dirname, '../dist');

await rm(shimDist, { recursive: true, force: true });
await cp(cliDist, shimDist, { recursive: true });
await chmod(resolve(shimDist, 'cli.js'), 0o755);
await chmod(resolve(shimDist, 'cli.mjs'), 0o755);
```

Implementation may differ in details (e.g. logging, error handling, version stamping verification), but the essential shape is "clear, copy, chmod."

## `scripts/lint-sync.mjs` sketch

- Read both `package.json` files.
- Compare `dependencies`, `bin`, `version` as plain JSON objects (deep equality).
- Separately assert that the shim's `package.json` has no `exports`, `main`, or `types` field (bin-only invariant from F10).
- On drift or invariant violation, print a structured diff and exit non-zero.
- On success, exit 0 silently (or with a minimal confirmation line).

Implementation should use `node:fs/promises` and should not depend on external diff libraries; a hand-rolled deep-equal is sufficient.

## Build ordering

pnpm's dependency-aware task scheduling already ensures `@prisma-next/cli`'s `build` runs before `prisma-next`'s `build` because `prisma-next` declares `@prisma-next/cli` as a `devDependency` with `workspace:*`. No manual turbo/pipeline wiring is needed beyond ensuring the shim's `build` script does not itself invoke the CLI's build.

## Internal-package notice template

A short, consistent stanza to add near the top of each target README (F19):

```markdown
> **Internal package.** This package is an implementation detail of [`prisma-next`](https://www.npmjs.com/package/prisma-next)
> and is published only to support its runtime. Its API is unstable and may change
> without notice. Do not depend on this package directly; install `prisma-next` instead.
```

`@prisma-next/cli`'s README gets a different notice reflecting its dual role under the bin-only shim model (F20) — it is both the CLI's implementation and the documented programmatic-API import target for advanced users. Suggested wording:

```markdown
> **For the CLI, install [`prisma-next`](https://www.npmjs.com/package/prisma-next).**
> This package (`@prisma-next/cli`) ships the CLI's implementation and exposes its programmatic
> APIs (`@prisma-next/cli/config-types`, `@prisma-next/cli/control-api`, `@prisma-next/cli/commands/*`,
> `@prisma-next/cli/config-loader`) for authors of build integrations, extension packs, and
> advanced config wiring. These subpaths are less stable than the facade packages
> (`@prisma-next/postgres/config`, `@prisma-next/mongo/config`); prefer those for
> application-level config. This README is architecture documentation for contributors.
```

## `init` command alignment

The `init` command today prints and executes commands that install `@prisma-next/cli` as a devDependency in the user's project. Since the end-user-facing package is now `prisma-next`, all of those instruction strings and install invocations switch to `prisma-next`. The change is mechanical:

- `formatAddDevArgs(pm, ['@prisma-next/cli'])` → `formatAddDevArgs(pm, ['prisma-next'])`
- Log/spinner strings that include the literal `@prisma-next/cli` → `prisma-next`
- Test expectations that assert the exact install args update accordingly.

The `bin` name invoked after install is already `prisma-next` (via `formatRunCommand(pm, 'prisma-next', …)`), so no change is needed there.

## `one-package-install` project updates

This spec also updates `projects/one-package-install/`'s documentation (`spec.md`, `plan.md`, `user-journey.md`) to reference `prisma-next` instead of `@prisma-next/cli` everywhere the change is user-facing. The updates are textual only; no behavior change to the `init` flow is introduced beyond what F23–F25 already specify.

## Publish ordering (operational note)

When the shim eventually ships to NPM (separate action, outside this ticket's scope):

1. The first publish must release `prisma-next@X.Y.Z` **before or simultaneously with** the `@prisma-next/cli@X.Y.Z` that contains the updated `init` command. Otherwise, running `pnpm dlx @prisma-next/cli init` from a version whose init installs `prisma-next` would fail at the `npm install prisma-next` step.
2. Until that first coordinated publish happens, the updated `init` command lives only in the workspace. No end user encounters the mismatch because they would be running `dlx` against a published version that predates this change.
3. Once `prisma-next@X.Y.Z` is on NPM, the canonical entry point moves to `pnpm dlx prisma-next init`; `@prisma-next/cli` can still be published in lockstep but is no longer the documented install target.

Publish ordering is an operational checklist for the release, not an engineering concern in this spec's scope.

# References

- Linear ticket: [TML-2265 — Publish `@prisma-next/cli` as `prisma-next`](https://linear.app/prisma-company/issue/TML-2265/publish-prisma-nextcli-as-prisma-next)
- CLI package: `packages/1-framework/3-tooling/cli/`
  - Current `package.json`: [`packages/1-framework/3-tooling/cli/package.json`](../../packages/1-framework/3-tooling/cli/package.json)
  - Existing `tsdown.config.ts`: [`packages/1-framework/3-tooling/cli/tsdown.config.ts`](../../packages/1-framework/3-tooling/cli/tsdown.config.ts)
  - Existing bin compat shim: [`packages/1-framework/3-tooling/cli/scripts/write-cli-js-compat.mjs`](../../packages/1-framework/3-tooling/cli/scripts/write-cli-js-compat.mjs)
- Related project: [`projects/one-package-install/spec.md`](../one-package-install/spec.md), [`plan.md`](../one-package-install/plan.md), and [`user-journey.md`](../one-package-install/user-journey.md) — all updated in this ticket (F26–F28) to reference `prisma-next` instead of `@prisma-next/cli`.
- CLI `init` command source: [`packages/1-framework/3-tooling/cli/src/commands/init/init.ts`](../../packages/1-framework/3-tooling/cli/src/commands/init/init.ts) — updated in this ticket (F23).
- CLI `init` command tests: [`packages/1-framework/3-tooling/cli/test/commands/init/init.test.ts`](../../packages/1-framework/3-tooling/cli/test/commands/init/init.test.ts) and [`detect-package-manager.test.ts`](../../packages/1-framework/3-tooling/cli/test/commands/init/detect-package-manager.test.ts) — updated in this ticket (F24).
- Directory layout conventions: `.cursor/rules/directory-layout.mdc`

# Open Questions

None outstanding. Decisions locked in during shaping:

- Directory placement: `packages/1-framework/3-tooling/prisma-next/`.
- Shim README scope: medium (install + quickstart + command index + link).
- Sync-lint script: co-located at `packages/1-framework/3-tooling/prisma-next/scripts/lint-sync.mjs`, wired into the shim's `lint` script.
- CI gating: sync-lint blocks CI alongside other lints.
- Internal-package README stanza: ship the draft wording in "Implementation Guidance" as-is; refine on review.
- `one-package-install` alignment: the textual updates in `projects/one-package-install/{spec,plan,user-journey}.md` and the corresponding `init` command source + test updates are included in this ticket (F23–F28), not deferred.
- **Shim is bin-only**: no `exports`, no `main`, no `types`. The `prisma-next` package is a CLI distribution vehicle and nothing else. Programmatic APIs keep the `@prisma-next/cli` import address. Locked in to prevent a second public import surface that would have to be stability-managed in parallel with `@prisma-next/cli`, and to keep future "Flavor 2" inlining of internal deps transparent to consumers.
