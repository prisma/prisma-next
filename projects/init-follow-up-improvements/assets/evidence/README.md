# Evidence — `prisma-next init` user-journey research

These files are the captured live-run evidence for the friction points cited in [`../user-journey.md`](../user-journey.md). They were originally generated under `wip/init-experiments/` (gitignored, not committed); this directory is the in-repo, committed snapshot.

Test environment: macOS, Node 24.13.0, pnpm 10.27.0, npm 11.6.2. Published packages: `prisma-next@0.4.1`, `@prisma-next/postgres@0.4.1`, `@prisma-next/mongo@0.4.1` (latest dist-tag at the time).

## Index

| ID | File | What it shows |
|---|---|---|
| E1 | [`02-pg-psl/install-npm-output.txt`](./02-pg-psl/install-npm-output.txt) | Postgres + PSL — `npm install` and `prisma-next contract emit` complete cleanly with **no missing-deps warning**. |
| E2 | [`02-pg-psl/query.ts`](./02-pg-psl/query.ts) + tsc result inside [`02-pg-psl/install-npm-output.txt`](./02-pg-psl/install-npm-output.txt) | A `db.orm.User.where(...).first()` query typechecks (`TSC_EXIT=0`) once `--types node` is supplied. |
| E3 | [`02-pg-psl/install-npm-output.txt`](./02-pg-psl/install-npm-output.txt) | Same file — shows `TSC_EXIT=2` when `--types node` is **not** supplied (closes F1: scaffold doesn't typecheck out of the box). |
| E4 | [`02-pg-psl/install-output.txt`](./02-pg-psl/install-output.txt) | Initial `pnpm` attempt failing with `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND` / `ERR_PNPM_SPEC_NOT_SUPPORTED_BY_ANY_RESOLVER` before the npm fallback ran (closes F6). |
| E5 | [`03-04-05-mongo-psl/install-npm-output.txt`](./03-04-05-mongo-psl/install-npm-output.txt) | Mongo + PSL — npm install + emit succeed against `@prisma-next/mongo@0.4.1`, no missing-deps warning. |
| E6 | [`03-04-05-mongo-psl/query.ts`](./03-04-05-mongo-psl/query.ts) | `tsc` rejects the documented agent-skill pattern: `Property 'orm' does not exist on type 'MongoClient<Contract>'` (closes F9). |
| E7 | [`03-04-05-mongo-psl/query.ts`](./03-04-05-mongo-psl/query.ts) | Same file — modified to use `client = await db.connect(...)` (the human quick-reference pattern); `tsc` then fails with `Property 'where' does not exist on type 'never'` (closes F10). |
| E8 | [`03-04-05-pg-ts/prisma-next.md`](./03-04-05-pg-ts/prisma-next.md) | TS-authoring scaffold whose `prisma-next.md` shows a PSL `model User { ... }` block instead of a TS `defineContract` example (closes F15). |
| E9 | [`06-noninteractive/init-output.txt`](./06-noninteractive/init-output.txt) | `prisma-next init --yes` rejected with `error: unknown option '--yes'` (closes F19). |
| E10 | [`06-noninteractive/init-output.txt`](./06-noninteractive/init-output.txt) | Same file — running with `</dev/null` exits 0 after rendering the first prompt, with no files created (closes F21, R10). |
| E11 | [`01-blank-dir/init-output.txt`](./01-blank-dir/init-output.txt) | Bare-directory `prisma-next init`: actionable error but no bootstrap (closes F24). |
| E12 | [`08-existing-tsconfig/scaffold-output.txt`](./08-existing-tsconfig/scaffold-output.txt) | `mergeTsConfig` crashes on JSONC with `SyntaxError: Expected property name or '}'` (closes F26). |
| E13 | [`07-reinit/directory-listing.txt`](./07-reinit/directory-listing.txt) | Re-init after target switch leaves the emitted-contract slot empty: there's no `prisma/contract.json` even though the previous target's emit could have left one behind (closes F31). |
| E14 | [`04b-mongo-pnpm/install-pnpm-output.txt`](./04b-mongo-pnpm/install-pnpm-output.txt) | Inside a pnpm workspace, `pnpm dlx prisma-next@latest init` resolves `@prisma-next/mongo@latest` to `0.3.0` rather than the published `0.4.1` (closes F36). |

## Reproducing

[`scaffold.ts`](./scaffold.ts) is the small TypeScript script used to drive the deterministic scaffolds. It imports the CLI's template functions directly and writes their output to a target directory — bypassing `clack` so the scaffold step is reproducible without TTY simulation. Reproduction layout:

```bash
mkdir -p wip/init-experiments && cp projects/init-follow-up-improvements/assets/evidence/scaffold.ts wip/init-experiments/

# Postgres + PSL scenario (regenerates E1, E2, E3, E4):
cd wip/init-experiments && pnpm exec tsx scaffold.ts ./02-pg-psl postgres psl
cd 02-pg-psl && npm install && npx prisma-next contract emit && npx tsc --noEmit --types node

# Mongo + PSL scenario (regenerates E5, E6, E7):
cd wip/init-experiments && pnpm exec tsx scaffold.ts ./03-04-05-mongo-psl mongodb psl
cd 03-04-05-mongo-psl && npm install && npx prisma-next contract emit && npx tsc --noEmit --types node

# No-TTY scenario (regenerates E9, E10):
mkdir -p wip/init-experiments/06-noninteractive && cd wip/init-experiments/06-noninteractive && \
  pnpm init -y && pnpm dlx prisma-next@latest init </dev/null

# JSONC tsconfig scenario (regenerates E12):
cd wip/init-experiments && pnpm exec tsx scaffold.ts ./08-existing-tsconfig postgres psl
```

`wip/` remains gitignored. The committed copies under [`assets/evidence/`](./) are the canonical reference for friction points cited in [`../user-journey.md`](../user-journey.md).
