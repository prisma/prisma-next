# multi-extension-monorepo

Worked example: a Prisma Next application that depends on **two** internal
contract-space packages — `audit` and `feature-flags` — plus its own
application schema. Exercises the framework's per-space planner / runner /
verifier with multiple extensions composed into a single application.

## What this demonstrates

Prisma Next's contract-space mechanism is symmetric across origin: a
contract space contributed by an installed extension package, a published
extension on npm, and an internal monorepo package all flow through the
same descriptor surface. The framework reads each `extensionPacks` entry's
descriptor at authoring time, emits pinned per-space artefacts into the
user's repo, and applies migrations from each space in cross-space order
(extensions first, app last) inside a single transaction.

This example exercises that property end-to-end against PGlite (the
embedded Postgres-compatible engine the framework uses for tests). Two
trivial "internal extensions" each declare:

- a one-table contract,
- a single baseline migration that creates the table,
- a stable `<package>:create-<table>-v1` invariantId.

The aggregator (the example application itself) declares its own `User`
table and lists both internal extensions in its
`prisma-next.config.ts`-equivalent. After `migrate` + `apply`:

- pinned artefacts land at `migrations/audit/{contract.json,contract.d.ts,refs/head.json}`
  and `migrations/feature-flags/...`;
- migration directories at `migrations/audit/<dirName>/` and
  `migrations/feature-flags/<dirName>/`;
- the marker table has three rows (`app`, `audit`, `feature-flags`),
  each carrying the expected core hash and applied invariants.

## Layout

This example is shipped as a single workspace package for ergonomic
reasons (the framework's package layering treats `examples/*` as the
top-level glob — see `pnpm-workspace.yaml`). The internal `packages/*`
subdirectories play the role of separately-published packages in a real
monorepo: each has its own descriptor module exporting an
`SqlControlExtensionDescriptor` exactly as a published extension would.
The application code under `app/` consumes them via relative imports
where it would consume them via `workspace:*` dependencies in a real
monorepo. The framework code path is identical either way — the
descriptor module is the only seam.

```text
examples/multi-extension-monorepo/
├── packages/
│   ├── audit/                         ← internal "package" #1
│   │   ├── constants.ts
│   │   ├── contract.ts
│   │   ├── migrations.ts
│   │   └── control.ts                 ← `auditExtensionDescriptor`
│   └── feature-flags/                 ← internal "package" #2
│       ├── constants.ts
│       ├── contract.ts
│       ├── migrations.ts
│       └── control.ts                 ← `featureFlagsExtensionDescriptor`
├── app/
│   └── contract.ts                    ← application contract (declares `User`)
└── test/
    └── multi-space.e2e.integration.test.ts
```

## Running

```sh
pnpm --filter @prisma-next/example-multi-extension-monorepo test
```
