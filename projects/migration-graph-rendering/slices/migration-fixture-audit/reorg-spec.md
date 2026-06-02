# Addendum spec: reorganize fixtures into `fixtures/<name>/{contract, migrations/}`

## Problem

The regenerated fixtures scattered assets across the demo root:
`migration-fixtures/<name>/app/…`, a separate top-level `<name>-contract/` dir
per fixture, and a top-level `prisma-next.<name>.config.ts` per fixture. The
proliferation of `*-contract/` dirs is the specific complaint.

## Target layout (every fixture, self-contained)

```
examples/prisma-next-demo/fixtures/<name>/
  prisma-next.config.ts     # contract: './contract.prisma'; migrations: { dir: './migrations' }
  contract.prisma           # the single head contract the config references
  migrations/
    app/
      <node dirs…>
      refs/
```

Render/QA each via: `prisma-next migration graph --config ./fixtures/<name>/prisma-next.config.ts`.

Applies to **all 7** fixtures: `showcase`, `diamond`, `wide-fan`,
`converging-branches`, `skip-rollback`, `long-spine`, `multi-branch`.

## Verified facts (config paths are config-relative)
- `resolveMigrationPaths` resolves `migrations.dir` against `resolve(configOption, '..')` (the config file's dir).
- `finalizeConfig` resolves `contract` source/output against the config file's dir.
So a config inside `fixtures/<name>/` using `./contract.prisma` + `./migrations` resolves correctly.

## Moves (use `git mv` to preserve history / show as renames)
For each fixture `<name>`:
1. `migration-fixtures/<name>/app` → `fixtures/<name>/migrations/app` (carries the node dirs + `app/refs/`).
2. The single head `.prisma` (the one the old config referenced) `<name>-contract/<head>.prisma` → `fixtures/<name>/contract.prisma`.
3. Author `fixtures/<name>/prisma-next.config.ts` (port `db.connection` from the old config) with `contract: './contract.prisma'` and `migrations: { dir: './migrations' }`.

## Deletions
- The whole `examples/prisma-next-demo/migration-fixtures/` tree (after moves).
- All `examples/prisma-next-demo/*-contract/` dirs (after moving the one head `.prisma` each).
- All top-level `examples/prisma-next-demo/prisma-next.<name>.config.ts` (the 7 fixture configs).
- **Do NOT touch** the main `examples/prisma-next-demo/prisma-next.config.ts`.

## Showcase consistency
`showcase` currently keeps emitted `showcase.json`/`.d.ts` and per-node
`start-contract.*`. For uniformity, slim it like the others: keep only
`fixtures/showcase/contract.prisma`, drop the emitted contract `.json`/`.d.ts`,
and remove per-node `start-contract.*`. **Verify** showcase still renders its
special shapes (forward cross-link, self-edge, disjoint cycle) and passes check.

## References to update
- The usage comment in the showcase config (`--config ./prisma-next.showcase.config.ts` → `--config ./fixtures/showcase/prisma-next.config.ts`).
- Sweep docs/README for any reference to the old paths (`migration-fixtures/`, `*-contract/`, `prisma-next.<name>.config.ts`) and update.

## Done when
- The 7 fixtures live under `fixtures/<name>/{prisma-next.config.ts, contract.prisma, migrations/app/…}`; no `migration-fixtures/`, no `*-contract/`, no top-level fixture configs remain.
- Each renders (default + `--tree`) and passes `migration check` via its new config, with identical node/edge counts to before.
- Main demo config untouched; history preserved via `git mv`.
