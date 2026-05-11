# multi-extension-monorepo

Worked example: a Prisma Next application that depends on **two** internal contract-space packages — `audit` and `feature-flags` — plus its own application schema. Exercises the framework's per-space planner / runner / verifier with multiple extensions composed into a single application.

## What this demonstrates

Prisma Next's contract-space mechanism is symmetric across origin: a contract space contributed by an installed extension package, a published extension on npm, and an internal monorepo package all flow through the same descriptor surface. The framework reads each `extensionPacks` entry's descriptor at authoring time, emits pinned per-space artefacts into the user's repo, and applies migrations from each space in cross-space order (extensions first, app last) inside a single transaction.

This example exercises that property end-to-end against PGlite (the embedded Postgres-compatible engine the framework uses for tests). Two trivial "internal extensions" each declare:

- a one-table contract,
- a single baseline migration that creates the table,
- a stable `<package>:create-<table>-v1` invariantId.

The aggregator (`app/`) declares its own `User` table and lists both internal extensions in its `prisma-next.config.ts`. After `migrate` + `apply`:

- pinned artefacts land at `migrations/audit/{contract.json,contract.d.ts,refs/head.json}` and `migrations/feature-flags/...`;
- migration directories at `migrations/audit/<dirName>/` and `migrations/feature-flags/<dirName>/`;
- the marker table has three rows (`app`, `audit`, `feature-flags`), each carrying the expected core hash and applied invariants.

## Layout

```text
examples/multi-extension-monorepo/
├── app/                                 ← aggregate root (the "application")
│   ├── prisma-next.config.ts            ← composes extensionPacks: [audit, featureFlags]
│   └── contract-source.ts               ← application contract (declares `User`)
├── packages/
│   ├── audit/                           ← internal "package" #1
│   │   ├── constants.ts
│   │   ├── contract-source.ts           ← TS authoring entry-point
│   │   ├── prisma-next.config.ts        ← `prisma-next contract emit` driver
│   │   ├── contract.json                ← emitted (do not edit)
│   │   ├── contract.d.ts               ← emitted (do not edit)
│   │   ├── refs/head.json               ← hand-pinned head ref
│   │   ├── migrations/audit/<dir>/      ← emitted migration package
│   │   └── control.ts                   ← `auditExtensionDescriptor` (JSON-import wiring)
│   └── feature-flags/                   ← internal "package" #2 (same shape)
└── test/
    └── multi-space.e2e.integration.test.ts
```

The aggregate root at `app/prisma-next.config.ts` is the config an application author writes — the CLI reads it for `contract emit`, `migration plan`, `db init`, and `db update`. It imports the extension descriptors from `packages/*/control.ts` and lists them in `extensionPacks`, exactly as a real application would import published extensions from npm.

This example is shipped as a single workspace package for ergonomic reasons (the framework's package layering treats `examples/*` as the top-level glob — see `pnpm-workspace.yaml`). The internal `packages/*` subdirectories play the role of separately-published packages in a real monorepo: each has its own descriptor module exporting an `SqlControlExtensionDescriptor` exactly as a published extension would. The framework code path is identical either way — the descriptor module is the only seam.

## Running

```sh
pnpm --filter @prisma-next/example-multi-extension-monorepo test
```

## Authoring (maintainers)

Each internal "package" under `packages/` follows the **on-disk-in-package authoring** convention described in [ADR 212 — Contract spaces](../../docs/architecture%20docs/adrs/ADR%20212%20-%20Contract%20spaces.md). The same pipeline application authors use is applied per-subdirectory:

1. Edit `packages/<pkg>/contract-source.ts` (the TS entry-point that calls `defineContract` from `@prisma-next/sql-contract-ts/contract-builder`).
2. Re-emit the canonical contract artefacts (`contract.json`, `contract.d.ts`) from inside the subdirectory:

   ```sh
   cd packages/<pkg>
   pnpm exec prisma-next contract emit
   ```

   `prisma-next.config.ts` in the subdirectory wires the emit pipeline to the contract source.
3. If the schema (or its set of typed objects) changed, scaffold a new migration directory:

   ```sh
   pnpm exec prisma-next migration plan --name <slug>
   ```

   Then hand-edit the generated `migrations/<pkg>/<dir>/migration.ts`'s `operations` getter so each op carries the package's stable `<pkg>:<change>-vN` invariantId (invariantIds cannot be renamed once published). Re-emit `ops.json` + `migration.json`:

   ```sh
   node migrations/<pkg>/<dir>/migration.ts
   # or, on Node < 24:
   pnpm exec tsx migrations/<pkg>/<dir>/migration.ts
   ```

4. Update `refs/head.json` to point at the new contract `storageHash` plus the union of `providedInvariants` across all migrations.
5. The descriptor at `packages/<pkg>/control.ts` is **JSON-import wiring** over the on-disk artefacts; no manual edits are required for routine schema changes.

The `multi-space.e2e.integration.test.ts` consumes both descriptors through their public `contractSpace` surface — pulling `{contractJson, migrations, headRef}` directly — so the only thing the test depends on at the source level are `constants.ts` (for `<PKG>_SPACE_ID`, table names, etc.) and `control.ts` (the descriptor itself).
