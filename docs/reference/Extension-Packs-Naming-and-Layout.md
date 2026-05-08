# Extension Packs — Naming and Layout Conventions

Purpose: define a consistent convention for naming, placing, and describing extension packs across domains.

## NPM Package Name
- Use `@prisma-next/extension-<name>` for all extension packs
  - Examples: `@prisma-next/extension-pgvector`, `@prisma-next/extension-postgis`, `@prisma-next/extension-views`
- Include domain only when necessary to avoid ambiguity (rare): `@prisma-next/extension-sql-views`

## Filesystem Location

Extension packs live under `packages/3-extensions/` with domain-specific subfolders when needed:

```
packages/
  3-extensions/              # Domain 3: Extensions
    pgvector/                # pgvector extension pack
    sql/                     # SQL-specific extensions (if needed)
      <name>/
    framework/               # Framework-wide packs (if any)
      <name>/
```

**Examples:**
- `packages/3-extensions/pgvector/` → `@prisma-next/extension-pgvector`
- `packages/3-extensions/sql/views/` → `@prisma-next/extension-sql-views` (future)

## Required package.json Metadata
Add the following fields to support discovery and guardrails:
```json
{
  "name": "@prisma-next/extension-<name>",
  "prismaNext": {
    "family": "sql",            // or "framework", "document"
    "dialects": ["postgres"],    // if domain-specific
    "type": "extension-pack"     // reserved values: extension-pack
  }
}
```

## Minimal Source Layout

Extension packs use multi-plane entrypoints to separate control (migration) and runtime code:

```
packages/3-extensions/<name>/
  package.json
  README.md
  tsdown.config.ts
  src/
    core/                # Shared plane code
      types.ts           # Type definitions
      codecs.ts          # Codec definitions (if applicable)
    types/               # Additional type definitions (shared plane)
    exports/             # Entry points
      control.ts         # Migration plane (control plane descriptors)
      runtime.ts         # Runtime plane (runtime factories)
      codec-types.ts     # Re-export codec types (shared plane)
      operation-types.ts # Re-export operation types (shared plane)
```

## Package Exports

Extension packs expose multiple entrypoints via `package.json` exports:

```json
{
  "exports": {
    "./control": {
      "types": "./dist/exports/control.d.ts",
      "import": "./dist/exports/control.js"
    },
    "./runtime": {
      "types": "./dist/exports/runtime.d.ts",
      "import": "./dist/exports/runtime.js"
    },
    "./codec-types": {
      "types": "./dist/exports/codec-types.d.ts",
      "import": "./dist/exports/codec-types.js"
    },
    "./operation-types": {
      "types": "./dist/exports/operation-types.d.ts",
      "import": "./dist/exports/operation-types.js"
    }
  }
}
```

## Architecture Config

Extension packs require multiple entries in `architecture.config.json` to map each plane:

```json
{
  "glob": "packages/3-extensions/<name>/src/core/**",
  "domain": "extensions",
  "layer": "adapters",
  "plane": "shared"
},
{
  "glob": "packages/3-extensions/<name>/src/types/**",
  "domain": "extensions",
  "layer": "adapters",
  "plane": "shared"
},
{
  "glob": "packages/3-extensions/<name>/src/exports/control.ts",
  "domain": "extensions",
  "layer": "adapters",
  "plane": "migration"
},
{
  "glob": "packages/3-extensions/<name>/src/exports/runtime.ts",
  "domain": "extensions",
  "layer": "adapters",
  "plane": "runtime"
},
{
  "glob": "packages/3-extensions/<name>/src/exports/codec-types.ts",
  "domain": "extensions",
  "layer": "adapters",
  "plane": "shared"
},
{
  "glob": "packages/3-extensions/<name>/src/exports/operation-types.ts",
  "domain": "extensions",
  "layer": "adapters",
  "plane": "shared"
}
```

## Integration Points
- **Authoring/Targets**: packs contribute ops/types manifests via control plane entrypoint
- **Lanes/Runtime**: packs expose codecs and are auto-registered via runtime entrypoint
- **Tooling (Migration Plane)**: optional planner/preflight hooks via control plane

## Guardrails
- Packs import only via documented SPI of framework/sql packages
- No pack may import from `test/**` or `examples/**`
- Domain boundaries remain enforced via `architecture.config.json`
- Control plane code cannot import from runtime plane (enforced by dependency cruiser)

## Tree-shakability between control and runtime planes

The control / runtime / (optional) middleware split exists so that consumers can import only the planes they need without dragging in the others. A migration tool that reads contract-space artefacts from `./control` should not pay for the runtime envelope, codec runtime, or any per-query SDK glue. A query-time consumer pulling `./runtime` should not pay for migration-op SQL, contract-space artefacts, or the codec lifecycle hook. The split must hold at the **bundled output** level, not just at the source level — a transitive import inside `src/exports/control.ts` that reaches a runtime-only file (e.g., the codec encode/decode body, the SDK interface, the bulk-encrypt middleware) will pull that file's bytes into the control bundle even if dependency-cruiser permits the source import.

### Source-level discipline

The naming-and-layout convention above already separates sources by plane. The discipline that backs tree-shakability at the source level:

- `src/exports/control.ts` imports only from control-plane sources (`src/core/{contract, migrations, descriptor-meta, lifecycle-hook, …}.ts`) and shared constants. It does NOT import from `src/exports/runtime.ts`, `src/exports/middleware.ts`, or any runtime-only `src/core/` file.
- `src/exports/runtime.ts` imports only from runtime-plane sources (`src/core/{envelope, codec-runtime, sdk, decrypt-all, …}.ts`) and shared constants. It does NOT import contract-space artefacts (`contract.ts`, `migrations.ts`) or lifecycle hooks.
- Optional `src/exports/middleware.ts` imports only the runtime-plane sources its middleware needs — it should not pull contract-space artefacts.
- Shared constants live in a single `src/core/constants.ts` (or equivalent) carrying pure literals (codec ids, native types, invariant ids). This file is structurally permitted in both planes' transitive sets — bundlers chunk it as `constants-*.mjs` and both bundles re-import the same chunk.

### Enforcement: bundling-isolation guard tests

Source-level discipline is necessary but not sufficient — a dynamic import, a re-export of a runtime-only symbol, or an over-broad barrel file can leak bytes across the plane boundary. Extension packs that ship multi-plane entrypoints SHOULD include a permanent test that verifies the bundled `.mjs` outputs are plane-disjoint at byte level. Two assertion strategies, both useful:

1. **Forbidden-substring check on entry bodies.** For each entry's bundled `.mjs`, assert that a curated set of plane-foreign symbols / strings does not appear in the file body. The `control.mjs` bundle should not contain the runtime envelope class name, the codec encode/decode bodies, the SDK interface symbol, or the middleware factory; the `runtime.mjs` bundle should not contain the contract-space artefact names, the lifecycle-hook symbol, or any migration-op SQL string. The test reads the dist `.mjs` files (depend on the package's own `build` so dist is fresh) and asserts forbidden-substring absence.
2. **Chunk-graph disjointness check.** Reading each entry's `.mjs` and recursively following `import`/`from` references (parsed structurally, not via the JS module loader), collect the set of chunk files transitively reached. Assert that the control entry's set and the runtime entry's set are disjoint, modulo the shared `constants-*.mjs` chunk (or whichever shared-constants chunk(s) the bundler emits — these carry pure literals and are structurally permitted in both bundles).

The chunk-graph check is the **stronger** of the two — it catches transitive leaks the entry-body check would miss (e.g., an entry that imports a chunk only to re-export a forbidden symbol). Most extension packs ship both checks.

The cipherstash extension's `packages/3-extensions/cipherstash/test/bundling-isolation.test.ts` is the canonical worked example of both strategies. It asserts:

- `control.mjs` does not contain runtime envelope class names, the SDK interface symbol, the codec runtime factory, or the bulk-encrypt middleware factory.
- `runtime.mjs` and `middleware.mjs` do not contain contract-space artefact names, the lifecycle-hook symbol, or migration-op SQL terms (e.g., `add_search_config`, `remove_search_config`).
- The transitively-reached chunk-file sets for control vs runtime, and control vs middleware, are disjoint modulo the shared `constants-*.mjs` chunk.

### Wiring the test into Turbo

The bundling-isolation test reads the package's own `dist/` outputs and so must run after `build`. Wire via the package's `turbo.json` `dependsOn`:

```jsonc
{
  "tasks": {
    "<package-name>#test": {
      "dependsOn": ["build"],
      "inputs": ["src/**", "test/**", "dist/**"]
    }
  }
}
```

The `dependsOn: ["build"]` (own-package build, not `^build`) is what's needed: the test reads `dist/**` of the same package, not transitive dependencies'.

### Architectural rationale

The tree-shakability invariant is an enforcement mechanism, not just a convention. It backs an extension's bundle-size budget — if the runtime bundle accidentally pulls in the migration SQL bundle, query-time consumers pay 100s of KB of migration text they will never execute. It also prevents subtle plane leakage, e.g., a future change that has the runtime envelope decode call a control-plane lifecycle hook would represent a real architectural regression that the bundling-isolation test catches at PR time rather than in production.

The pattern composes with the trait-and-namespaced-operator pattern of [ADR 211](../architecture%20docs/adrs/ADR%20211%20-%20Extension%20operator%20surface%20namespaced%20replacement%20operators.md): both are type-/byte-level enforcement mechanisms for invariants the source code expresses but the build pipeline must preserve.

## Rationale
This convention keeps imports clear and consistent, keeps the repo navigable, and scales across domains. The `extension-` prefix is preferred over shorter alternatives (like `ext-`) for clarity and discoverability. The numbered directory prefix (`3-extensions/`) indicates that extensions are in domain 3, which can import from domains 1 (framework) and 2 (sql/document). Metadata enables automated loading and validation.

## Related Documentation
- [Package Naming Conventions](./Package%20Naming%20Conventions.md)
- [ADR 112 - Target Extension Packs](../architecture%20docs/adrs/ADR%20112%20-%20Target%20Extension%20Packs.md)
- [ADR 211 - Extension operator surface: namespaced replacement operators](../architecture%20docs/adrs/ADR%20211%20-%20Extension%20operator%20surface%20namespaced%20replacement%20operators.md) — required reading for extensions whose codec output cannot back the wire semantics of a built-in trait-gated operator.
- `.cursor/rules/multi-plane-packages.mdc` - Multi-plane package patterns