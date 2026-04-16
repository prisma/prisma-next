# User Journey: Setting Up Prisma Next in a New App

## Context

A developer with prior Prisma Next experience scaffolds a new Next.js app and wants to add Prisma Next. They know the high-level concepts (contract, config, runtime) but don't have the details memorized.

---

## The Journey

### Step 1: Create the schema file

The user creates `prisma/contract.prisma` (or `prisma/schema.prisma`). This is straightforward — the PSL syntax is familiar and small schemas are easy to write from memory.

**No friction here.**

### Step 2: Write the config file

The user needs a `prisma-next.config.ts`. They know it exists and roughly what it does (tells the CLI about the target, adapter, driver, schema source, and output path), but they can't write it from memory.

The config file for a basic Postgres app requires ~10 imports from ~6 different packages. The imports use deep subpath exports (`/control` suffixes) and reference internal architecture concepts — adapter, driver, target, family, contract provider — that the user doesn't think in terms of. There are also boilerplate wiring calls (`assembleAuthoringContributions`, `assemblePslInterpretationContributions`) that the user has no reason to remember.

**The user has to go find an example config file and copy it.** They open the monorepo, find `examples/prisma-next-demo/prisma-next.config.ts`, and adapt it. This works, but it means the user can't get started without access to the source repo.

### Step 3: Figure out what packages to install

The config file imports from several `@prisma-next/*` packages. The user needs to install them, but they don't know the full list. The example app's `package.json` has ~16 runtime dependencies and ~8 dev dependencies from the `@prisma-next` scope. Some of these are needed for the config, some for the runtime, some for the emitted contract types, and some are transitive — but nothing tells the user which are which.

**The user has to cross-reference the config file imports, the db.ts imports, and the example package.json to assemble the right install command.** They're essentially reverse-engineering the dependency graph from example code.

### Step 4: Install the CLI

The user needs to run `prisma-next contract emit`, but they don't remember the package name for the CLI (`@prisma-next/cli`). This is minor friction — they can grep the example `package.json` or guess — but it's one more thing in a chain of lookups.

### Step 5: Emit the contract

The user runs `prisma-next contract emit`. This reads the config, parses the schema, and writes `contract.json` and `contract.d.ts` to the configured output path.

**This step works fine**, assuming the config and schema are correct and the required packages are installed.

### Step 6: Write the runtime setup file (`db.ts`)

The user creates a `db.ts` (or equivalent) to instantiate the Prisma Next runtime. This file imports the `postgres` convenience facade, the emitted contract types, and the contract JSON. Writing this file also requires knowing the right imports, but it's simpler than the config — typically 3–5 imports.

**Similar friction to step 2**: the user copies from an example because they don't remember the exact imports and API.

### Step 7: Discover that everything is untyped

The user starts writing queries and notices that nothing is typed. Autocompletion doesn't work. Table and column types are `any` or unresolved.

**This is the most painful moment in the journey.** The user has done everything right — schema, config, emit, runtime setup — and the system appears to work, but the core value proposition (type safety) is silently absent.

### Step 8: Diagnose the missing types

The user investigates. The `contract.d.ts` file looks fine at first glance — it has type definitions, import statements, everything seems to be there. But the imports reference packages like `@prisma-next/adapter-postgres/codec-types`, `@prisma-next/sql-contract/types`, and `@prisma-next/contract/types`. If these packages aren't installed, the imports silently fail.

The reason there are no errors: `contract.d.ts` is a declaration file, and the project's `tsconfig.json` has `skipLibCheck: true` (the Next.js default). TypeScript doesn't check `.d.ts` files at all. The types just quietly become unresolved, and everything downstream loses type information.

**The user only discovers the root cause by renaming `contract.d.ts` to `contract.ts`**, which forces TypeScript to check the file and surface the unresolved import errors.

### Step 9: Install the missing type packages

The user reads the error messages, identifies the missing packages, and installs them. Types start working.

**This is the resolution**, but the user had to go through a painful debugging cycle to get here — and only because they knew enough to try removing the `.d` from the file extension.

---

## Roadblock Catalog

### R1: The config file is not writable from memory

- **Where**: Step 2
- **Pain**: The user knows they need a config file but cannot write it without copying from an example. The imports are numerous, use unfamiliar subpath patterns, and reference internal architecture concepts.
- **Consequence**: The user is blocked until they find and copy an example config. If they don't have access to the monorepo or examples, they're stuck.

### R2: The required package set is unknown

- **Where**: Steps 3, 4, 6
- **Pain**: The user doesn't know which `@prisma-next/*` packages to install. There are many packages, their names don't clearly indicate whether they're needed for config-time, emit-time, or runtime, and the only reference is the example app's `package.json` (which includes packages that may not be needed for a minimal setup).
- **Consequence**: The user has to manually cross-reference multiple files across the example app to assemble an install command. They're likely to miss packages or install unnecessary ones.

### R3: Silent type failure after emit

- **Where**: Steps 7–8
- **Pain**: The emitted `contract.d.ts` imports types from packages the user may not have installed. Because `.d.ts` files are not checked under `skipLibCheck: true`, the missing imports produce no errors. The entire type system silently degrades — the user's queries compile but have no type safety.
- **Consequence**: The user believes setup is complete and proceeds to build on an untyped foundation. The failure is invisible until the user either (a) notices the lack of autocompletion, (b) gets a runtime error that types would have caught, or (c) knows enough to manually investigate the `.d.ts` file. A less experienced user might never notice.

### R4: No feedback loop during setup

- **Where**: Across the entire journey
- **Pain**: At no point does the system tell the user whether setup is correct or complete. The CLI emits the contract without checking whether the output will be usable. The TypeScript compiler doesn't report problems in `.d.ts` files. The runtime doesn't warn about unresolved types.
- **Consequence**: The user is flying blind. Every step could silently fail, and the user won't know until they hit a downstream symptom. The debugging cycle (step 8) requires significant TypeScript knowledge.
