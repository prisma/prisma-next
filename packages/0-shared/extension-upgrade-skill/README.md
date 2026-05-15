# @prisma-next/extension-upgrade-skill

An agent skill that upgrades a Prisma Next **extension** package from
one minor version to the next. The skill carries the per-step
bump-install-instructions-check-pins-validate-commit flow plus the
cumulative set of per-transition *upgrade instructions* (one directory
per `(from-minor, to-minor)` pair).

This package additionally ships a `prisma-next-check-pins` CLI as a
`bin` for use in extension authors' CI.

## Audience

This skill is for **authors of Prisma Next extensions** — packages that
consume the framework SPI and expose contract / middleware / codec /
migration surfaces to downstream apps.

If you are a user of Prisma Next (your project imports
`@prisma-next/postgres`, `@prisma-next/mongo`, etc. from your
application code), install
[`@prisma-next/upgrade-skill`](https://www.npmjs.com/package/@prisma-next/upgrade-skill)
instead. If your repo contains both an app and an extension, install
both.

## Installation

```bash
npx skills add @prisma-next/extension-upgrade-skill@latest
```

Always install at `@latest`. Bug fixes to older per-transition upgrade
instructions ship as part of the latest skill release; pinning to an
older skill version can apply a known-broken translation.

For the CLI, add the package as a `devDependency` (the
`npx skills add` step above already does this if you accept its
defaults):

```bash
pnpm add -D @prisma-next/extension-upgrade-skill@latest
```

Then wire `pnpm exec prisma-next-check-pins` into your CI.

## Usage

### Upgrade

Once installed, an agent in your extension repo picks up the skill from
a prompt like:

```text
Please upgrade Prisma Next to the latest version.
```

The agent reads `SKILL.md`, detects the current and target versions,
applies one transition at a time, and commits each transition step
separately.

### `prisma-next-check-pins` CLI

The CLI enforces the *exact-pin rule* for Prisma Next extensions: every
`@prisma-next/*` entry across `dependencies`, `peerDependencies`, and
`optionalDependencies` must be a single exact-version string (no `^`,
no `~`, no range, no wildcard, no `workspace:` specifier), and every
entry must resolve to the same version.

```bash
pnpm exec prisma-next-check-pins
```

Exits with status `0` and no output on success; on any failure, prints
a structured error naming every offending entry and exits non-zero.

Wire into your CI alongside your build/test step:

```yaml
- run: pnpm exec prisma-next-check-pins
```

## Versioning

This package is version-locked to the rest of Prisma Next: every Prisma
Next release publishes the same version of this skill. The version is
publication discipline (one release per Prisma Next release), not a
compatibility selector — install at `@latest`.

## What the skill does

See [`SKILL.md`](./SKILL.md) for the full flow. In short:

1. Ensure the skill itself is at `@latest`.
2. Detect from-version (from the lockfile) and to-version (user-supplied
   or npm `latest`).
3. Build the transition chain (one minor at a time).
4. For each step: bump deps to the exact next minor, `pnpm install`,
   run `prisma-next-check-pins`, apply the per-transition upgrade
   instructions, run build + tests, commit.
5. Halt at the first failed step with a structured error.
