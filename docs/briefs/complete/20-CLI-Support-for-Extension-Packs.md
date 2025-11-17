# Project Brief — CLI Support for Extension Packs

Goal: Let apps declare their adapter and extension packs once in a config file and have the CLI consume that config for emit (today) and DB‑connected commands (future) without ad‑hoc flags or discovery. The user config imports IR descriptors from package “/cli” entrypoints; the CLI reads the assembled data from the config — it does not import packs directly and does not read JSON from disk.

## Context

- Today the CLI already has the plumbing to load pack manifests and assemble imports/registries:
  - `packages/framework/tooling/cli/src/pack-loading.ts`
  - `packages/framework/tooling/cli/src/pack-assembly.ts`
  - `packages/framework/tooling/cli/src/commands/emit.ts`
- Previously, apps passed `--adapter` and `--extensions` paths manually. Going forward, example apps and e2e tests opt‑in via a single config file only (flags removed).
- Plane guardrails: migration tooling must not import runtime code. The CLI imports only the user’s config module; the config supplies IR for emit, and may optionally expose a lazy runtime factory for DB‑connected commands.

## Outcomes

- Apps specify packs once in `prisma-next.config.ts`.
- For emit, the CLI reads pre‑assembled IR from the config (family/target/adapter/extensions), produces `extensionIds`, `codecTypeImports`, and `operationTypeImports`, and passes them to `@prisma-next/emitter` along with an operation registry assembled from those manifests.
- The CLI does not import packs; the config owns the imports. No JSON file reads are required.

## Config Shape

File: `prisma-next.config.ts` (TS preferred for DX)

```ts
import { defineConfig } from '@prisma-next/cli'

import postgresAdapter from '@prisma-next/adapter-postgres/cli'
import postgres from '@prisma-next/targets-postgres/cli'
// future: import pgvector from '@prisma-next/ext-pgvector/cli'
import sql from '@prisma-next/family-sql/control'

export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  extensions: [ /* pgvector */ ],

  // Future: centralize DB settings here so both runtime workers and app code can consume the same values
  db: {
    // User is responsible for env var loading
    url: process.env.POSTGRES_URL,
  },
})
```

Notes
- Use explicit entrypoints to avoid cross‑plane imports:
  - `…/cli` entrypoints default‑export IR‑only descriptors for tooling (safe for emit).
  - `…/runtime` entrypoints export runtime factories/types for DB‑connected execution.
- `@prisma-next/family-sql/control` default‑exports a FamilyDescriptor (IR‑only) used to select the family hook.
- `@prisma-next/targets-postgres/cli` default‑exports a TargetDescriptor (IR manifest for emission).
- `@prisma-next/adapter-postgres/cli` default‑exports an AdapterDescriptor (IR manifest) for emission; a matching `@prisma-next/adapter-postgres/runtime` module exports the runtime factory for DB‑connected commands.
- The CLI validates descriptor manifests read from the config.

## Package Entry Points and Contracts

- FamilyDescriptor (default from `@prisma-next/family-sql/control`)
  - `{ kind: 'family', id: 'sql', hook: TargetFamilyHook, assembleOperationRegistry, extractCodecTypeImports, extractOperationTypeImports }`
- TargetDescriptor (default from `@prisma-next/targets-postgres/cli`)
  - `{ kind: 'target', id: 'postgres', family: 'sql', manifest: ExtensionPackManifest }`
- AdapterDescriptor (default from `@prisma-next/adapter-postgres/cli`)
  - `{ kind: 'adapter', id: 'postgres', family: 'sql', manifest: ExtensionPackManifest, create?: (opts) => Adapter }`

### Types and Ownership (Family‑Agnostic CLI)

- CLI descriptor types (consumed by config): owned by `@prisma-next/cli`
  - `FamilyDescriptor`, `TargetDescriptor`, `AdapterDescriptor`, `PrismaNextConfig`
  - Export from `packages/framework/tooling/cli/src/exports/config-types.ts` as `@prisma-next/cli/config-types`
  - Descriptors reference `ExtensionPackManifest` (below) and keep packs decoupled from emitter internals
- Manifest types (IR used by emit): owned by `@prisma-next/cli`
  - `ExtensionPackManifest`, `OperationManifest` from `packages/framework/tooling/cli/src/pack-manifest-types.ts`
  - Used inside descriptors as `manifest: ExtensionPackManifest`
- Emitter types (codegen wiring): owned by `@prisma-next/emitter`
  - `TypesImportSpec`, `TargetFamilyHook` — used within CLI implementation, not by pack `/cli` modules
- Operation registry types (SQL): owned by `@prisma-next/sql-operations`
  - `SqlOperationSignature`, `SqlOperationRegistry`
- Runtime adapter SPI (SQL): owned by `@prisma-next/sql-relational-core`
  - `Adapter`, `AdapterProfile`, AST and lowered statement types
  - `/runtime` entrypoints’ factories return `Adapter<…>` from this package

Resolution:
- The config imports descriptor objects from `/cli` entrypoints. The CLI validates them with `ExtensionPackManifestSchema` and uses them — no JSON reads or direct pack imports inside CLI code.

Design intent
- “Family‑specific at the type level, common at the shape level”: descriptors keep strong family typing in their own packages; the CLI depends on a tiny, common surface (discriminators, ids, hook, helpers) and treats everything else (e.g., manifest internals) as opaque.

## CLI Changes

- `emit` command surface (config‑only):
  - `--config <path>`: path to `prisma-next.config.ts` (optional; defaults to `./prisma-next.config.ts` if present)
  - Remove deprecated flags: `--adapter`, `--extensions`, and discovery
- Behavior:
  1) Load config (explicit via `--config` or default)
  2) Read `family.hook` and the family’s assembly helpers from `family` (passed through the config)
  3) Read IR from `target`, `adapter`, and `extensions` in the config (already imported by the user)
  4) Call family helpers to assemble `operationRegistry`, `codecTypeImports`, `operationTypeImports`, and derive `extensionIds`
  5) Select the family hook using `family.id` (e.g., sql)

Discovery: Removed. Packs must be defined explicitly in config. This keeps behavior deterministic and reviewable.

### Command Consumption (what each command reads)
- emit (pure migration): `family` (including `hook` and family helpers), `target.manifest`, `adapter.manifest`, `extensions[*].manifest`; ignores `db`. Programmatic API accepts these as pre‑assembled data.
- future db:introspect/migrate:apply: may read `db.url` and (optionally) a lazy runtime factory exposed by the config, for example:
  ```ts
  // inside prisma-next.config.ts (optional runtime section)
  export const runtime = {
    createAdapter: async () => (await import('@prisma-next/adapter-postgres/runtime')).createAdapter({ dsn: process.env.POSTGRES_URL! })
  }
  ```
  CLI DB commands can call `config.runtime?.createAdapter()` when needed; emit ignores it. This preserves tree‑shaking and avoids eager runtime imports during emit.

## Artifacts and Guardrails

- Framework/tooling packages import only the user’s config; they never import packs directly.
- The user config controls what is imported, using `/cli` (IR) for emit and optionally exposing a lazy runtime factory for DB‑connected commands.
- No migration→runtime imports inside CLI code; optional runtime access happens via user‑provided callbacks.

Programmatic API
- All commands accept already‑assembled inputs from the config: either the whole config object or the minimal dependencies for the command (e.g., emit receives family.hook and helper outputs). No filesystem scanning or pack discovery.

Deterministic composition rules
- extensionIds order: `[adapter.id, target.id, ...extensions.map(e => e.id)]` (duplicates are deduped, stable order preserved).
- Type imports: merge `types.codecTypes.import` and `types.operationTypes.import` from adapter/target/extensions; dedupe by `package/named/alias` triple.
- Operation manifests: union of adapter/target/extensions manifests; converted to signatures and registered; conflicts resolved by deterministic last‑write wins with a warning.

## Acceptance Criteria

- CLI:
  - `pnpm exec prisma-next emit --contract src/contract.ts --out contracts --config prisma-next.config.ts` emits `contract.json`/`contract.d.ts` with:
    - `extensions` populated with IDs from `adapter`, `target`, and `extensions`
    - codec/operation type imports from their manifests
- Behavior:
  - Config‑only; flags are removed
- Tests:
  - Integration tests cover config loading via default exports (`family`, `target`, `adapter`, `extensions`)
- Docs:
  - AGENTS.md and CLI README include a minimal example and config reference

Diagnostics and error handling
- Invalid config shape: show which field is missing/invalid (family/target/adapter/extensions).
- Unsupported family id: “Unsupported family '<id>'; expected one of: …”.
- Manifest validation failure: path to offending pack and schema messages.
- Duplicate extension ids: list duplicates and sources; suggest removing or reordering.
- Missing type imports in manifest: identify which pack lacks `types.codecTypes.import`/`types.operationTypes.import`.

## Implementation Plan

1) Config loader
- Add `packages/framework/tooling/cli/src/config.ts`:
  - `loadConfig(path?: string): unknown` (returns the user’s config object)
  - Load via dynamic import of the TS module; accept default export or named `config`

2) Family‑provided helpers (no bridge layer)
- The family’s `/cli` default export must include: `hook`, `assembleOperationRegistry`, `extractCodecTypeImports`, `extractOperationTypeImports`.
- Move SQL‑specific `pack-assembly.ts` and `pack-manifest-types.ts` under the SQL family (e.g., `packages/sql/tooling/assembly`) and re‑export the helpers from `@prisma-next/family-sql/control`.

3) Emit command
- Update `packages/framework/tooling/cli/src/commands/emit.ts` to:
  - Parse `--config`
  - Call `loadConfig()` to get the raw user config
  - Resolve the family bridge by `config.family.id`
  - `bridge.validateDescriptors(config)`
  - Use bridge methods to assemble registry/imports and obtain the family hook
  - Remove legacy `--adapter`, `--extensions`, and discovery logic

4) Examples and tests
- Add `prisma-next.config.ts` in `examples/todo-app`
- Extend `emit.integration.test.ts` to exercise programmatic API with pre‑assembled config data and config loading via `/cli` entrypoints; ensure `extensions` are honored. Verify the CLI uses the SQL family bridge and remains family‑agnostic.

5) Docs
- Update AGENTS.md and CLI README with `/cli` vs `/runtime` guidance and the unified config shape

Security and side‑effects
- Keep config modules side‑effect‑free; prefer lazy runtime factories (e.g., adapter.create) over eager instances.
- Do not read .env inside the CLI; let the user config resolve env and pass values in `db`.

Testing strategy
- Unit tests for family helpers: registry assembly, type import extraction, extensionIds ordering and dedupe.
- Integration tests for emit: config load, helper invocation, and artifact contents.
- Negative tests: invalid manifests, duplicate ids, missing imports.

## Risks & Mitigations

- Misconfigured packs or invalid manifests
  - Clear error messages referencing package name and manifest path
- Plane boundary regression
  - CLI imports only the user’s config; no JSON reads or direct pack imports

---

## Detailed Design (Second Pass)

### Problem Statement

We want a single, simple way for applications to declare the SQL family, target, adapter, and extensions in one config file and have all CLI commands (emit today; DB-connected commands later) consume that information consistently. The current flags (`--adapter`, `--extensions`) add friction and are not scalable as we add more packs. We also want to maintain plane guardrails: pure migration-plane commands must not import or execute runtime code.

### Terminology & Domains

- SQL family: the domain providing contract types, ops, lanes, runtime, and family tooling.
- Targets (packs): concrete database packs (Postgres/MySQL) contributing manifests for types/ops/capabilities.
- Adapter: runtime implementation that lowers SQL ASTs and negotiates capabilities with the DB.
- Planes: migration (authoring/tooling/emit) vs runtime (lanes/runtime/adapters). Migration must not import runtime code; runtime may consume migration artifacts.

### Unified Config (works for emit and DB-connected commands)

User writes a single file `prisma-next.config.ts`:

```ts
import { defineConfig } from '@prisma-next/cli'

import postgresAdapter from '@prisma-next/adapter-postgres/cli'
import postgres from '@prisma-next/targets-postgres/cli'
// future: import pgvector from '@prisma-next/ext-pgvector/cli'
import sql from '@prisma-next/family-sql/control'

export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  extensions: [ /* pgvector */ ],

  // Optional; used only by DB-connected commands
  db: {
    url: process.env.POSTGRES_URL,
  },
})
```

Key properties:
- `family`: IR-only descriptor (selects family hook, e.g., `'sql'`).
- `target`: target pack descriptor (IR-only manifest used by emit).
- `adapter`: adapter descriptor (IR-only manifest for emit; may also provide a runtime factory under the default export for DB-connected commands).
- `extensions`: zero or more extension pack descriptors (IR-only manifests for emit; some may also ship runtime helpers but not required).
- `db`: optional runtime connection hints for future commands; ignored by emit.

### Package Default Export Contracts

To support the simple config above, packages expose default exports designed for CLI config usage:

- `@prisma-next/family-sql/control` → FamilyDescriptor: `{ kind: 'family', id: 'sql', hook: TargetFamilyHook, assembleOperationRegistry, extractCodecTypeImports, extractOperationTypeImports }`
- `@prisma-next/targets-postgres/cli` → TargetDescriptor: `{ kind: 'target', id: 'postgres', family: 'sql', manifest: ExtensionPackManifest }`
- `@prisma-next/adapter-postgres/cli` → AdapterDescriptor: `{ kind: 'adapter', id: 'postgres', family: 'sql', manifest: ExtensionPackManifest, create?: (opts) => Adapter, adapter?: Adapter }`
- `@prisma-next/ext-…/cli` (optional) → ExtensionDescriptor (same shape as TargetDescriptor, or a narrowed `kind: 'extension'` if we add it)

Notes:
- Default exports are pure data objects; if a runtime `create` function is present on the adapter default export, it is a property, not executed unless a DB-connected command opts in.
- Root default exports are IR-first to keep emit pure. Subpaths like `/runtime` can still expose additional runtime helpers as needed, but the config does not need to import them.

### Family‑Agnostic CLI with Family‑Specific Types

“Family‑specific at the type level, common at the shape level” means the SQL packages keep strong types internally, while the CLI only relies on shared field names (`kind`, `id`, `family`, `manifest`) and callable helpers (`assembleOperationRegistry`, `extract*Imports`) plus the `TargetFamilyHook` exposed by `family`.

Minimal common shape the CLI relies on:
- Family (/cli): `{ kind: 'family'; id: string; hook: TargetFamilyHook; assembleOperationRegistry; extractCodecTypeImports; extractOperationTypeImports }`
- Adapter/Target/Extension (/cli): `{ kind: 'adapter'|'target'|'extension'; id: string; family: string; manifest: unknown; create?: (...args) => unknown; adapter?: unknown }`

### CLI Emit Behavior (Pure Migration Plane)

Given `{ family, target, adapter, extensions }` from the config, `emit`:
1) Selects the family hook by `family.id` (e.g., `'sql'`) and uses it.
2) Calls family helpers with `{ adapter, target, extensions }` to assemble `operationRegistry`, `codecTypeImports`, and `operationTypeImports`.
3) Builds `extensionIds` as `[adapter.id, target.id, ...extensions.map(e => e.id)]` (deduped, consistent order: adapter → target → extensions).
4) Validates the user’s `contract.ts` via `@prisma-next/sql-contract-ts`, calls `emit()` with the assembled inputs and the family hook, then writes `contract.json`/`contract.d.ts`.

Never executed by emit:
- `adapter.create` (even if present).
- Any runtime code paths (adapters/drivers/codecs); emit remains migration-plane only.

### Future DB-Connected Commands (Introspect, Migrate, Capabilities)

We keep the same config shape. These commands may use `adapter.create` and `db.url`:
- `db:introspect`: construct adapter via `adapter.create({ dsn: config.db?.url, … })`; connect and retrieve schema snapshot.
- `db:capabilities`: construct adapter and probe capabilities.
- `migrate:apply`: construct adapter and apply a plan.

Two execution strategies (we can choose per command or uniformly):
1) In-process: The CLI evaluates the user config (userland import), then calls a lazy factory (e.g., `adapter.create` or `config.runtime?.createAdapter()`). Framework/tooling packages still don’t import runtime directly — the user’s config does, on demand. Simpler to wire; ensure side-effect-free evaluation.
2) Worker/subprocess: Spawn a worker in the SQL runtime plane for stricter isolation. Pass a typed JSON request (dsn, options). More boilerplate; stronger boundary.

### Hook Validates Operator Registry

- The emitter passes `ctx.operationRegistry` and `ctx.extensionIds` into `TargetFamilyHook.validateTypes`.
- The SQL hook should validate operator signatures and `lowering.targetFamily`, arg/return kinds, and check typeIds against namespaces allowed by `extensionIds`.
- This keeps operator validation in the family layer and out of the CLI.

Both approaches preserve our guardrails: framework tooling never imports runtime packages.

### Validation & Errors

- Validate config shape: required fields for emit (`family`, `target`, `adapter`), types of default exports, and manifest schemas.
- Helpful error messages:
  - Missing or invalid `family.id`: “Unsupported family; expected 'sql'.”
  - Missing `adapter.manifest.types.*.import`: “Adapter manifest must provide codec type import for contract.d.ts generation.”
  - Duplicate extension IDs: “Duplicate extension id 'postgres'; remove duplicates in config.”
- For DB-connected commands: if `adapter.create` is missing, error with guidance to update the adapter package or use a compatible version.

### Backward Compatibility & Migration

- Flags `--adapter`/`--extensions` are removed (or optionally deprecated for a short window with warnings).
- Example apps and e2e tests are updated to use `prisma-next.config.ts` only.
- No JSON manifest reads in CLI; all manifests come from default exports.

### Examples

Minimal emit-only config (no DB): see “Config Shape” above.

With extensions (e.g., pgvector later):
```ts
import pgvector from '@prisma-next/ext-pgvector'
export default defineConfig({ family: sql, target: postgres, adapter: postgresAdapter, extensions: [pgvector] })
```

DB-connected (future): same config, plus `db.url`. Commands consuming runtime read `adapter.create` and `db.url`.

### Open Questions / Follow-ups

- Should we add `kind: 'extension'` distinct from `'target'` for non-adapter packs? For now, both can share the `TargetDescriptor` shape.
- How do we order extensionIds deterministically when multiple extensions depend on each other? Current rule: adapter → target → extensions in import order.
- Add a tiny type package in `@prisma-next/cli` to export `FamilyDescriptor`, `TargetDescriptor`, `AdapterDescriptor` typings for pack authors?

### Notes

What stays generic for the CLI

Family discriminator and hook
The CLI reads config.family.id (e.g., 'sql') and a hook that implements TargetFamilyHook (already generic and owned by @prisma-next/emitter).
Opaque descriptors from packs
The CLI sees config.adapter, config.target, config.extensions as opaque objects with a few common fields (e.g., id, family, manifest), but it does not parse SQL-specific content inside manifest.
Assembly and validation are delegated
Anything family-specific (assembling an operation registry, extracting codec/operation type imports, validating operator signatures) is handled by the family’s code, not the CLI.
How to wire this without adding a new “bridge” concept

Keep using TargetFamilyHook for emit-time validation and .d.ts generation. Extend the family’s /cli export to also include assembly helpers the CLI can call. The CLI receives these function references from the config’s family export; it doesn’t import SQL code itself.
Concretely, the family’s /cli default export can include:
hook: TargetFamilyHook (existing)
assembleOperationRegistry(descriptors): builds the registry from adapter/target/extension manifests
extractCodecTypeImports(descriptors): returns TypesImportSpec[]
extractOperationTypeImports(descriptors): returns TypesImportSpec[]
This keeps the CLI fully family-agnostic:

It loads the user’s config, picks family.hook and the family’s assembly helpers that came from the config import, and uses them to produce the inputs that emit needs.
It never imports SQL types or code paths directly and treats manifests as opaque data.
What “family-specific at the type level” means

Inside the SQL packages, descriptors are strongly typed to SQL specifics (e.g., SqlOperationManifest with lowering.strategy/function/infix, SQL capability flags, etc.).
Exported config objects follow the same common shape the CLI expects (fields like kind, id, family, manifest), and include callable helpers and the TargetFamilyHook.
The CLI only depends on:
a discriminant family.id: string
a hook: TargetFamilyHook
function references: assembleOperationRegistry, extractCodecTypeImports, extractOperationTypeImports
top-level fields like adapter.id, target.id, etc., used only for extensionIds and diagnostics
Minimal common shape (what the CLI actually uses)

Family (/cli)
{ kind: 'family'; id: string; hook: TargetFamilyHook; assembleOperationRegistry: (d) => unknown; extractCodecTypeImports: (d) => TypesImportSpec[]; extractOperationTypeImports: (d) => TypesImportSpec[] }
Adapter/Target/Extension (/cli)
{ kind: 'adapter'|'target'|'extension'; id: string; family: string; manifest: unknown; create?: (...args) => unknown; adapter?: unknown }
The CLI ignores the internals of manifest and only passes descriptor arrays to the family-provided functions above; for emit it never calls create/adapter.
Validation stays in the family hook

The emitter passes ctx.operationRegistry and ctx.extensionIds into TargetFamilyHook.validateTypes. The SQL hook should:
Validate operator signatures and lowering.targetFamily
Validate typeId formats/namespaces against extensionIds
Enforce any SQL-specific invariants
That keeps operator validation where it belongs (in the family hook), not in the CLI.
Putting it together (flow)

CLI loads config (userland import).
Reads family.id and family.hook (generic) plus family assembly helpers (passed via the config).
Calls family assembly helpers with { adapter, target, extensions } to get:
operationRegistry
codecTypeImports
operationTypeImports
extensionIds (derived from { adapter.id, target.id, ext.id })
Calls emit(ir, { operationRegistry, codecTypeImports, operationTypeImports, extensionIds }, family.hook).
The hook validates types and operator registry and generates contract.d.ts.
Result: one common, family-agnostic CLI, and family-specific typing stays inside the family /cli packages and the TargetFamilyHook implementation.
