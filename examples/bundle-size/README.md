# bundle-size

Bundle-size fixture for `@prisma-next/postgres` and `@prisma-next/mongo`.

For each target there is a **no-emit** entry that builds the contract at runtime
from a TypeScript-authored DSL and an **emit** entry that consumes the
canonical `contract.json` + `contract.d.ts` produced by
`prisma-next contract emit`. All four entries do the same thing: connect to a
real database, run a single `SELECT id FROM "Note" LIMIT 10` (Postgres) or
`db.notes.find().limit(10)` (Mongo) equivalent, and print the rows.

No extensions, no ORM client surface, no middleware — just the runtime
factory and one query, so the number reflects the floor of each target.

## Layout

```text
src/
├── postgres/
│   ├── contract.ts                  # single Note model with a single id column
│   ├── main.ts                      # no-emit:  postgres({ contract })
│   ├── main-emit.ts                 # emit:     wraps src/postgres/generated/db.ts
│   └── generated/                   # produced by `pnpm emit:pg`
│       ├── contract.json
│       ├── contract.d.ts
│       └── db.ts                    # postgres<Contract>({ contractJson })
└── mongo/
    ├── contract.ts                  # single Note model with a single _id field
    ├── main.ts                      # no-emit:  mongo({ contract })
    ├── main-emit.ts                 # emit:     wraps src/mongo/generated/db.ts
    └── generated/                   # produced by `pnpm emit:mongo`
        ├── contract.json
        ├── contract.d.ts
        └── db.ts                    # mongo<Contract>({ contractJson })

prisma-next.config.postgres.ts       # `--config` for emit:pg
prisma-next.config.mongo.ts          # `--config` for emit:mongo
scripts/bundle.ts                    # builds all 4 entries, reports sizes
test/example.test.ts                 # runs all 4 entries end-to-end
```

## Run

```sh
# Postgres
DATABASE_URL=postgres://… pnpm start:pg          # no-emit
DATABASE_URL=postgres://… pnpm start:pg:emit     # emit

# Mongo
MONGODB_URL=mongodb://… MONGODB_DB=… pnpm start:mongo
MONGODB_URL=mongodb://… MONGODB_DB=… pnpm start:mongo:emit
```

## Emit

```sh
pnpm emit:pg     # writes src/postgres/generated/{contract.json,contract.d.ts}
pnpm emit:mongo  # writes src/mongo/generated/{contract.json,contract.d.ts}
pnpm emit        # both
```

## Bundle

```sh
pnpm bundle
```

For each of the four entries, the script writes both an unminified
(`*.bundle.mjs`) and a minified (`*.bundle.min.mjs`) artefact to `dist/`,
plus a `.gz` (gzip level 9) for each, and prints a table of raw + gzipped
sizes. Only `pg`, `pg-native`, and `mongodb` are marked external; everything
Prisma Next owns is inlined.

## Test (no external DB required)

```sh
pnpm test
```

Postgres tests boot PGlite via `@prisma-next/test-utils.createDevDatabase`.
Mongo tests boot `mongodb-memory-server` (downloads a `mongod` binary on first
run). On unsupported host distros (e.g. NixOS) the Mongo tests will fail
because the binary downloader has no matching artefact — this is an upstream
limitation, not a regression in the example.

## CI reporting

[`.github/workflows/bundle-size.yml`](../../.github/workflows/bundle-size.yml)
runs [`andresz1/size-limit-action`](https://github.com/andresz1/size-limit-action)
on every PR. It executes `pnpm size:build` (workspace `turbo build` + the
esbuild `bundle` script above) for both the head and the base ref, runs
`size-limit --json` against the four `dist/*.bundle.min.mjs` outputs, and
posts a PR comment with the gzipped sizes side by side. The configuration
lives in [`.size-limit.json`](./.size-limit.json) and uses `@size-limit/file`,
so the reported number is the size of the artefact this `bundle` script
already produces — size-limit does not re-bundle.

See [`docs/oss/ci-pipeline.md`](../../docs/oss/ci-pipeline.md#adjacent-workflows)
for why this workflow is intentionally not a required check.
