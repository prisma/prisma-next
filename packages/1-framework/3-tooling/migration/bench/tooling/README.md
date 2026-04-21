# PSL sanitiser + emit-and-measure tooling

Companion to the benchmark suite. Runs real Prisma-ORM schemas through
the prisma-next emit pipeline and reports the resulting `contract.json`
/ `contract.d.ts` sizes so we can study how disk cost scales with schema
size.

## Scripts

- **`preprocess.mjs`** — strips/rewrites Prisma-ORM-only constructs that
  the prisma-next PSL interpreter rejects: `generator`/`datasource`/`view`
  blocks, `@db.*`, `@updatedAt`, `@@ignore` / `@ignore`, `Unsupported(…)`,
  `@@unique` / `@@index`, `map: "…"` constraint-naming args, `onDelete`
  clauses, and composite `@@id` (normalised to a field-level `@id`). Models
  that end up with no `@id` get a synthetic `_pnId Int @id @default(autoincrement())`
  injected at the top.

- **`measure.mjs`** — for each `*.prisma` in this directory:
  1. Sanitises the PSL via `preprocess.mjs`.
  2. Copies into `examples/prisma-next-demo/prisma/schema.prisma`.
  3. Runs `pnpm --filter prisma-next-demo emit`. If the emitter still
     reports errors, extracts `schema.prisma:LINE` references from the
     error output, blanks those lines, and retries. Loops until the
     emit succeeds or we stop making progress.
  4. Records raw + gzipped `contract.json` size, `contract.d.ts` size,
     and model/table counts.

  Restores the demo's original schema + emitted contract files at the
  end. Prints a markdown table and writes `measurements.json` to this
  directory.

## Usage

```bash
# Drop any .prisma files into this directory (they're gitignored).
cp /path/to/somewhere/schema.prisma packages/1-framework/3-tooling/migration/bench/tooling/

# Run.
node packages/1-framework/3-tooling/migration/bench/tooling/measure.mjs
```

## Caveats

Some Prisma-ORM patterns can't be auto-sanitised (e.g. ambiguous
back-relations that need explicit `@relation(name: "…")`). If the retry
loop stops making progress, the orchestrator reports the schema as
failed and moves on. Occasionally a schema hits an emitter bug
downstream of PSL parsing — those cases need manual investigation.

For production-grade schema analysis this tooling is good enough to
generate ballpark numbers; do not rely on it for anything else.
