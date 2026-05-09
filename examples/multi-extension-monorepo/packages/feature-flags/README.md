# feature-flags (internal contract-space package)

Internal "extension package" for the
[`multi-extension-monorepo`](../../README.md) example. Contributes a
single `feature_flag` table to applications that include this package
in their `extensionPacks`.

## Authoring (maintainers)

This package follows the on-disk-in-package authoring convention
introduced in M3.5 (project: `extension-contract-spaces`,
[ADR 211](../../../../docs/architecture%20docs/adrs/ADR%20211%20-%20Contract%20spaces.md)).
See the [example monorepo's README](../../README.md#authoring-maintainers)
for the full step-by-step workflow — the short version is:

1. Edit [`contract-source.ts`](./contract-source.ts) (TS authoring entry-point).
2. From this directory: `pnpm exec prisma-next contract emit`.
3. If the schema changed: `pnpm exec prisma-next migration plan --name <slug>`,
   then hand-edit the generated `migrations/feature-flags/<dir>/migration.ts`
   so each op carries the package's stable invariantId, and re-emit
   `ops.json` with `node migrations/feature-flags/<dir>/migration.ts`.
4. Update [`refs/head.json`](./refs/head.json) to pin the new head
   `(hash, invariants)`.
5. The descriptor at [`control.ts`](./control.ts) is JSON-import wiring
   over the on-disk artefacts — no manual edits required for routine
   schema changes.
