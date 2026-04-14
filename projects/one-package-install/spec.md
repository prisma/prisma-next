# Summary

Reduce the Prisma Next setup experience from a multi-step, error-prone process requiring deep architecture knowledge to a single `prisma-next init` command that leaves the user with a fully-typed, working project.

# Description

Today, setting up Prisma Next in a new app requires the user to: manually create a config file with ~10 imports from ~6 packages referencing internal architecture concepts; figure out which of ~24 `@prisma-next/*` packages to install; write a runtime setup file by copying from examples; and debug silent type failures caused by missing transitive type dependencies that `skipLibCheck: true` hides. The full user journey and roadblock catalog are documented in [user-journey.md](user-journey.md).

This project eliminates these roadblocks through three changes:

1. **`prisma-next init` command** — scaffolds files, installs dependencies, and emits the contract in one step.
2. **One-package-per-target facades** — `@prisma-next/postgres` (and `@prisma-next/mongo`) export simplified `/config` and `/runtime` entry points, and their transitive dependencies guarantee that emitted contract types resolve.
3. **Post-emit dependency validation** — the emitter checks that all packages referenced in `contract.d.ts` are installed, and warns if any are missing.

# Target User Experience

This section describes what the user sees end-to-end. Everything below is the source of truth for the design; the requirements section captures edge cases and constraints around it.

## Step 1: Run init

The user has a Next.js app (or any Node project with a `package.json`). They run:

```bash
pnpm dlx @prisma-next/cli init
```

(Or `npx @prisma-next/cli init`, `bunx @prisma-next/cli init`, `yarn dlx @prisma-next/cli init`.)

The CLI prompts:

```
◆  What database are you using?
│  ● PostgreSQL
│  ○ MongoDB
│
◆  Where should the schema file go?
│  prisma/contract.prisma
│
◆  Where should the contract be emitted?
│  src/prisma/contract.json
│
◇  Detecting package manager... pnpm
◇  Installing @prisma-next/postgres and @prisma-next/cli...
◇  Emitting contract...
│
◆  Done! Created:
│
│  prisma/contract.prisma     — your schema
│  prisma-next.config.ts      — Prisma Next config
│  src/prisma/db.ts            — runtime client
│  src/prisma/contract.json    — emitted contract
│  src/prisma/contract.d.ts    — emitted contract types
│
│  Next steps:
│  1. Edit prisma/contract.prisma with your models
│  2. Run: pnpm prisma-next contract emit
│  3. Import db from ./src/prisma/db in your app
```

## Step 2: Generated files

After init, the user has five files on disk. Three are scaffolded, two are emitted.

### `prisma/contract.prisma`

```prisma
model User {
  id        Int      @id @default(autoincrement())
  email     String   @unique
  name      String?
  posts     Post[]
  createdAt DateTime @default(now())
}

model Post {
  id        Int      @id @default(autoincrement())
  title     String
  content   String?
  author    User     @relation(fields: [authorId], references: [id])
  authorId  Int
  createdAt DateTime @default(now())
}
```

### `prisma-next.config.ts`

```typescript
import { defineConfig } from '@prisma-next/postgres/config';

export default defineConfig({
  schema: './prisma/contract.prisma',
  output: 'src/prisma/contract.json',
  db: {
    connection: process.env['DATABASE_URL']!,
  },
});
```

One import. One function call. No adapters, drivers, targets, families, contribution assemblers, or contract providers.

### `src/prisma/db.ts`

```typescript
import postgres from '@prisma-next/postgres/runtime';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

export const db = postgres<Contract>({ contractJson });
```

### `src/prisma/contract.json` and `src/prisma/contract.d.ts`

These are emitted by `prisma-next contract emit` (which init runs automatically). The `.d.ts` file imports types from packages like `@prisma-next/adapter-postgres/codec-types`, `@prisma-next/sql-contract/types`, and `@prisma-next/contract/types`. Because these are all transitive dependencies of `@prisma-next/postgres`, the imports resolve without the user installing anything extra.

## Step 3: Use it

The user opens `db.ts` in their editor. Types work. Autocompletion works. They can write queries immediately:

```typescript
import { db } from './prisma/db';

const users = await db.sql
  .from(db.schema.tables.user)
  .select({
    id: db.schema.tables.user.columns.id,
    email: db.schema.tables.user.columns.email,
  })
  .build();
```

When they edit `prisma/contract.prisma` and re-run `prisma-next contract emit`, the types update and everything stays typed.

## Packages installed

After init, the user's `package.json` has exactly two new entries:

```json
{
  "dependencies": {
    "@prisma-next/postgres": "^x.y.z"
  },
  "devDependencies": {
    "@prisma-next/cli": "^x.y.z"
  }
}
```

Everything else (`@prisma-next/adapter-postgres`, `@prisma-next/sql-contract`, `@prisma-next/contract`, `@prisma-next/target-postgres`, etc.) is pulled in as transitive dependencies of `@prisma-next/postgres`.

# The `/config` Facade API

`@prisma-next/postgres` gains a new `/config` export. Its `defineConfig` function wraps the low-level config API (`defineConfig` from `@prisma-next/cli/config-types`), pre-wiring all Postgres-specific internals.

## Signature

```typescript
import type { PrismaNextConfig } from '@prisma-next/config/config-types';

interface PostgresConfigOptions {
  readonly schema: string;
  readonly output: string;
  readonly db?: {
    readonly connection?: string;
  };
  readonly extensions?: readonly ControlExtensionDescriptor<'sql', 'postgres'>[];
  readonly migrations?: {
    readonly dir?: string;
  };
}

export function defineConfig(options: PostgresConfigOptions): PrismaNextConfig<'sql', 'postgres'>;
```

## What it does internally

The facade constructs the full `PrismaNextConfig` by:

1. Importing `sql` (family), `postgres` (target), `postgresAdapter`, `postgresDriver`, and `prismaContract` from the respective internal packages.
2. Calling `assembleAuthoringContributions` and `assemblePslInterpretationContributions` with `[postgres, postgresAdapter, ...extensions]`.
3. Calling `prismaContract(options.schema, { output: options.output, target: postgres, authoringContributions, scalarTypeDescriptors, controlMutationDefaults, composedExtensionPacks })`.
4. Returning the result of the low-level `defineConfig({ family: sql, target: postgres, adapter: postgresAdapter, driver: postgresDriver, extensionPacks: extensions, contract, db: options.db, migrations: options.migrations })`.

The user never sees any of this. Extensions are the one escape hatch — the user imports an extension descriptor (e.g. `pgvector` from `@prisma-next/extension-pgvector/control`) and passes it in the `extensions` array:

```typescript
import { defineConfig } from '@prisma-next/postgres/config';
import pgvector from '@prisma-next/extension-pgvector/control';

export default defineConfig({
  schema: './prisma/contract.prisma',
  output: 'src/prisma/contract.json',
  extensions: [pgvector],
  db: {
    connection: process.env['DATABASE_URL']!,
  },
});
```

# Post-Emit Dependency Validation

After writing `contract.d.ts`, the emitter extracts every `import type … from '<package>'` line and attempts to resolve each package from the user's project root (using Node module resolution). If any package is not resolvable, the emitter prints a warning:

```
⚠ contract.d.ts imports types from packages that are not installed:
  - @prisma-next/adapter-postgres
  - @prisma-next/sql-contract

  Install them:
    pnpm add @prisma-next/adapter-postgres @prisma-next/sql-contract
```

The emit still succeeds — the warning is informational, not blocking. This acts as a safety net for cases the one-package approach doesn't cover (e.g. extensions that add type imports, or corrupted `node_modules`).

# Requirements

## Functional Requirements

### Init command

- F1: The CLI exposes `prisma-next init`, usable via `pnpm dlx` / `npx` / `bunx` / `yarn dlx` without prior installation.
- F2: Init prompts for target (Postgres or Mongo), schema location (default: `prisma/contract.prisma`), and contract output location (default: `src/prisma/contract.json`).
- F3: Init scaffolds three files as shown in the "Generated files" section above.
- F4: Init detects the user's package manager from lockfiles (`pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `bun.lockb`) or project configuration.
- F5: Init installs the target facade package as a dependency and `@prisma-next/cli` as a dev dependency using the detected package manager.
- F6: Init runs `prisma-next contract emit` after installation to produce `contract.json` and `contract.d.ts`.
- F7: Init does not overwrite existing files without confirmation.
- F8: `--no-install` skips dependency installation and contract emission, and prints the manual commands instead.
- F9: Init prints a summary of created files and next steps on completion.

### Facade packages

- F10: `@prisma-next/postgres` exports `/config` with the `defineConfig` API described above.
- F11: `@prisma-next/postgres`'s `package.json` dependencies include all packages that the emitted `contract.d.ts` references for a Postgres target.
- F12: `@prisma-next/postgres`'s existing `/runtime` export continues to work unchanged.
- F13: `@prisma-next/mongo` is created with the same pattern: `/config` and `/runtime` exports, with transitive dependencies covering all Mongo contract type imports.

### Post-emit validation

- F14: After writing `contract.d.ts`, the emitter checks that every imported package is resolvable from the user's project root.
- F15: Missing packages produce a warning with the package names and install command. The emit still succeeds.

## Non-Functional Requirements

- NF1: The facade `defineConfig` produces a config object that is semantically identical to a manually-wired config. There is no behavioral difference at emit time or runtime.
- NF2: Post-emit validation adds < 500ms to the emit process.

## Non-goals

- An `init` command that supports every configuration option. Init covers the common case; power users edit the generated files.
- Replacing the low-level config API. The facade delegates to it. The low-level API remains available for advanced use cases and extension authors.
- A plugin or template system for init. Hard-coded templates for Postgres and Mongo are sufficient.
- Migrating existing projects. Init targets new projects.
- Interactive schema editing during init. The starter schema is a static template.

# Acceptance Criteria

- [ ] `pnpm dlx @prisma-next/cli init` (selecting Postgres) in a directory with only a `package.json` produces the five files shown in "Generated files" with no errors.
- [ ] The generated `prisma-next.config.ts` has exactly one import line (from `@prisma-next/postgres/config`).
- [ ] The generated `db.ts` has exactly one `@prisma-next` import (from `@prisma-next/postgres/runtime`).
- [ ] After init, `tsc --noEmit` reports no type errors in `db.ts` (with `skipLibCheck: true`).
- [ ] After init, renaming `contract.d.ts` to `contract.ts` and running `tsc --noEmit` reports no errors (proving that type imports actually resolve).
- [ ] A config using the facade `defineConfig` and a config using the low-level API with equivalent manual wiring produce byte-identical `contract.json` and `contract.d.ts` output.
- [ ] Init detects pnpm, npm, yarn, and bun from their respective lockfiles.
- [ ] Init with `--no-install` produces the three scaffolded files but not `contract.json`/`contract.d.ts`, and prints install + emit commands.
- [ ] Init does not overwrite existing files without prompting.
- [ ] Emitting a contract when `@prisma-next/adapter-postgres` is not installed prints a warning naming the missing package and the install command.
- [ ] Emitting a contract when all packages are installed prints no warning.

# References

- [User journey and roadblock catalog](user-journey.md)
- Existing `@prisma-next/postgres` package: `packages/3-extensions/postgres/`
- CLI package: `packages/1-framework/3-tooling/cli/`
- Example configs: `examples/prisma-next-demo/prisma-next.config.ts`, `examples/mongo-demo/prisma-next.config.ts`
- Low-level config types: `packages/1-framework/1-core/config/src/config-types.ts`

# Open Questions

None — all resolved during spec drafting. Decisions:

- **Init runs `contract emit` automatically** — the user gets a fully working, typed setup out of the box.
- **`db.ts` is colocated with the contract output** — e.g. `src/prisma/db.ts` alongside `src/prisma/contract.json`.
- **Facade `defineConfig` delegates to the existing config infrastructure** — thin wrapper, not a replacement.
- **Starter schema contains `User` and `Post` with a relation** — gives the user something concrete to query immediately.
