# @prisma-next/upgrade-skill

An agent skill that upgrades a project consuming Prisma Next from one
minor version to the next. The skill carries the per-step
bump-install-instructions-validate-commit flow plus the cumulative set of
per-transition *upgrade instructions* (one directory per
`(from-minor, to-minor)` pair).

## Audience

This skill is for **users** of Prisma Next — projects that depend on the
public package API (`@prisma-next/postgres`, `@prisma-next/mongo`, the
contract files in `prisma/`, etc.).

If you are an extension author, install
[`@prisma-next/extension-upgrade-skill`](https://www.npmjs.com/package/@prisma-next/extension-upgrade-skill)
instead. If your repo contains both an app and an extension, install
both.

## Installation

```bash
npx skills add @prisma-next/upgrade-skill@latest
```

Always install at `@latest`. Bug fixes to older per-transition upgrade
instructions ship as part of the latest skill release; pinning to an
older skill version can apply a known-broken translation.

## Usage

Once installed, an agent in your project picks up the skill from a
prompt like:

```text
Please upgrade Prisma Next to the latest version.
```

The agent reads `SKILL.md`, detects the current and target versions,
applies one transition at a time, and commits each transition step
separately.

## Versioning

This package is version-locked to the rest of Prisma Next: every Prisma
Next release publishes the same version of this skill. The version is
publication discipline (one release per Prisma Next release), not a
compatibility selector — consumers always install at `@latest`.

## What the skill does

See [`SKILL.md`](./SKILL.md) for the full flow. In short:

1. Ensure the skill itself is at `@latest`.
2. Pre-flight: refuse to upgrade past any installed extension's pin.
3. Detect from-version (from the lockfile) and to-version (user-supplied
   or npm `latest`).
4. Build the transition chain (one minor at a time).
5. For each step: bump deps to the exact next minor, `pnpm install`,
   apply the per-transition upgrade instructions, run typecheck + tests,
   commit.
6. Halt at the first failed step with a structured error.
