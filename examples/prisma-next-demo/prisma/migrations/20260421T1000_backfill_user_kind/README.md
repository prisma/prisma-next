# backfill_user_kind — class-flow `dataTransform` reference

This is a reference migration demonstrating the Postgres **class-flow**
authoring surface for `dataTransform` against the demo's `User` model.
It shows the intended shape of a hand-authored `migration.ts`:

- `dataTransform(contract, name, { check?, run })` from
  `@prisma-next/target-postgres/migration`
- A module-scope `const db = sql({ context: createExecutionContext({ contract, ... }) })`
  that the closures close over
- A default import of `contract.json` via import attributes

The `contract.json` / `contract.d.ts` siblings and the attested
`migration.json` + `ops.json` are produced by the CLI —
regenerate them against the demo project with:

```sh
pnpm --filter prisma-next-demo prisma-next contract emit
pnpm --filter prisma-next-demo prisma-next migration plan --name backfill_user_kind
pnpm --filter prisma-next-demo prisma-next migration emit --dir examples/prisma-next-demo/prisma/migrations/20260421T1000_backfill_user_kind
```

This directory is intentionally check-in light: the source of truth for
the authoring surface is `migration.ts`; the attested artifacts live
alongside it after running the CLI locally.
