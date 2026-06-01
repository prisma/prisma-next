# Learnings — tml-2683

> Orchestrator-maintained working ledger of patterns surfaced during this run. Cross-cutting
> lessons migrate to durable docs at close-out; project-local lessons drop with the folder.

- **Integration package imports built `dist`, not `src`.** A code fix in `@prisma-next/sql-orm-client/src`
  is invisible to `test/integration/**` until the package is rebuilt. `pnpm test:integration`'s
  `pretest` runs `pnpm -w build` (safe), but a bare `vitest` filter run exercises stale behavior.
  Surfaced in D4 — the variant join was silently absent until `pnpm --filter @prisma-next/sql-orm-client build`.
- **"Runs on both targets" is suite-specific, not repo-wide.** `test/integration/test/sql-orm-client/`
  is Postgres/PGlite-only; SQLite ORM coverage lives in a separate e2e package whose contract-builder
  lacks polymorphism support. The spec/plan assumed both — grounded only at the D4 integration dispatch.
  Lesson for spec-time: verify the *specific* suite's target matrix, don't infer from CLAUDE.md's
  general "PGlite + mongodb-memory-server" framing.
- **A SQL join being emitted does not make its columns referenceable in the predicate builder.** D1
  joined the MTI variant table into the child SELECT, but the `where` accessor (`model-accessor.ts`)
  still resolved fields against the base table only — so MTI variant-field `where` threw. The
  predicate-accessor layer is independent of the join-emission layer; a "falls out of the joins"
  assumption (true for STI base-table columns) silently failed for MTI. Routed to D5.
