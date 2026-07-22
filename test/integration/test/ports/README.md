# Ported test corpus

Behavioral-compatibility corpus for prisma-next, ported faithfully from the two upstream Prisma suites pinned for the [`port-all-tests`](../../../../projects/port-all-tests/spec.md) project:

- `prisma/prisma` @ `a6d01554528e016bea1467a072776b0e2b94dcba`
- `prisma/prisma-engines` @ `e922089b7d7502aff4249d5da3420f6fa55fc6ad`

Every in-scope upstream test lands in exactly one bucket (the accounting invariant):

1. **Ported & passing** — a vitest test here using the same schema, logically the same query through prisma-next's nearest public API, and the same assertions.
2. **Ported & failing** — a faithful port that hits a real prisma-next gap: `test.fails` + an entry in the corpus `failing.md`.
3. **Non-portable** — an individual line in the corpus `non-ported.md` (source location + what it tests + the specific reason it cannot be expressed).

The per-test ledger is the checklist corpus at [`projects/port-all-tests/checklists/`](../../../../projects/port-all-tests/checklists/README.md); the reviewer checks a box only once its disposition is verified.

## Layout

```
ports/
  _harness/        shared test harnesses (withPostgresPort, …)
  _fixtures/       per-suite contract fixtures (contract.ts + config + emitted generated/)
  prisma/          ports of prisma/prisma  (functional/, issues/, migrate/, cli/, legacy/)
    non-ported.md
    failing.md
  engines/         ports of prisma/prisma-engines (queries/, writes/, migrations/, …)
    non-ported.md
    failing.md
```

## Adding a fixture

Author the schema as **PSL** in `_fixtures/<suite>/contract.prisma` (faithful translation of the upstream `schema.prisma`) plus a `prisma-next.config.ts` (`@prisma-next/postgres/config`, `contract: './contract.prisma'`, `outputPath: 'generated'`). Then emit:

```bash
node packages/1-framework/3-tooling/cli/dist/cli.js contract emit \
  --config test/integration/test/ports/_fixtures/<suite>/prisma-next.config.ts
```

Commit the generated `contract.json` + `contract.d.ts`. The test imports the typed `Contract` + the JSON and passes the JSON to `withPostgresPort`. **The harness pushes the contract into the database via prisma-next's own plan→apply path (the same mechanism `db init` uses) — no hand-written DDL.** Seed and query through the ORM (`ctx.db.public.<Model>...`); `ctx.runtime.query(sql)` is a raw escape hatch for inspection. See `_fixtures/distinct/` + `prisma/functional/distinct.test.ts` for the reference pattern.

Notes: prisma-next PSL lowercases table names (model `User` → table `user`) but keeps column names verbatim; scalar lists (`String[]`, `Int[]`) are supported and emit native pg arrays. MongoDB suites port against prisma-next's dedicated mongo ORM (`mongoOrm()`) with a `mongodb-memory-server` harness — not marked non-ported.

## Roll-up

_Totals are finalised at project close-out. Live progress is tracked in the checklist corpus._

| Corpus | Ported & passing | Ported & failing (`test.fails`) | Non-portable |
| --- | --- | --- | --- |
| prisma/prisma | in progress | in progress | in progress |
| prisma-engines | in progress | in progress | in progress |
