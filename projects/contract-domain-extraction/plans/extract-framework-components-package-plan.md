# Extract framework-components into its own package

## Problem

The `@prisma-next/contract` package currently contains three distinct concerns:

1. **Contract data types** — `ContractBase`, `DomainModel`, `ContractIR`, `TypesImportSpec`, hash types, validation schemas. These describe the contract artifact itself.
2. **Framework component descriptors** — `ComponentMetadata`, `FamilyDescriptor`, `TargetDescriptor`, `AdapterDescriptor`, `ExtensionDescriptor`, `DriverDescriptor`, pack refs, instances, type renderers, authoring contribution types. These describe the composition system for building a Prisma Next stack.
3. **Assembly functions** — `assembleComponents()`, `extractCodecTypeImports()`, etc. These compose descriptors into assembled state for a specific plane (currently only control-plane/emission).

Concerns 2 and 3 do not belong in the contract package. Framework components are the composition primitives of the system — they describe what a family, target, adapter, extension, or driver contributes to both the control plane (codec type imports, parameterized renderers, authoring contributions) and the execution plane (codec registrations, operation handlers). They have no inherent relationship to the contract data structure; they merely reference some contract-adjacent types like `TypesImportSpec`.

The current placement causes:
- **Conceptual confusion**: importing descriptor types from `@prisma-next/contract/framework-components` implies they're part of the contract, but they're part of the composition system.
- **Package bloat**: the contract package carries assembly logic, type renderer normalization, and authoring template resolution — none of which are contract concerns.
- **Plane-specific assembly in a shared package**: `assembly.ts` currently extracts control-plane/emission-specific fields (`codecTypeImports`, `parameterizedRenderers`, etc.), but the execution plane needs its own assembly pattern for different facets of the same descriptors. Putting one plane's assembly in a shared package is misleading.

## Goal

Extract framework component descriptors, instances, authoring contribution types, type renderers, and assembly into a dedicated `@prisma-next/framework-components` package at the framework core/shared layer. The contract package retains only contract data types.

## What moves

### To `@prisma-next/framework-components` (new package)

**From `@prisma-next/contract` (`framework-components.ts`):**
- `ComponentMetadata`, `ComponentDescriptor`
- `FamilyDescriptor`, `TargetDescriptor`, `AdapterDescriptor`, `DriverDescriptor`, `ExtensionDescriptor`
- `FamilyInstance`, `TargetInstance`, `AdapterInstance`, `DriverInstance`, `ExtensionInstance`
- `TargetBoundComponentDescriptor`
- `PackRefBase`, `FamilyPackRef`, `TargetPackRef`, `AdapterPackRef`, `DriverPackRef`, `ExtensionPackRef`
- `ContractComponentRequirementsCheckInput`, `ContractComponentRequirementsCheckResult`, `checkContractComponentRequirements()`
- Type renderers: `TypeRenderer`, `TypeRendererString`, `TypeRendererRawFunction`, `TypeRendererTemplate`, `TypeRendererFunction`, `NormalizedTypeRenderer`
- `normalizeRenderer()`, `interpolateTypeTemplate()`

**From `@prisma-next/contract` (`framework-authoring.ts`):**
- All authoring contribution types and functions: `AuthoringContributions`, `AuthoringFieldNamespace`, `AuthoringTypeNamespace`, `AuthoringFieldPresetDescriptor`, `AuthoringTypeConstructorDescriptor`, `AuthoringFieldPresetOutput`, `AuthoringStorageTypeTemplate`, `AuthoringColumnDefaultTemplate`, `AuthoringArgRef`, `AuthoringArgumentDescriptor`, `AuthoringTemplateValue`
- `isAuthoringArgRef()`, `isAuthoringFieldPresetDescriptor()`, `isAuthoringTypeConstructorDescriptor()`
- `resolveAuthoringTemplateValue()`, `validateAuthoringHelperArguments()`
- `instantiateAuthoringTypeConstructor()`, `instantiateAuthoringFieldPreset()`

**From `@prisma-next/contract` (`assembly.ts`):**
- `AssemblyInput`, `AssembleComponentsInput`, `AssembledComponentState`, `AssembledAuthoringContributions`
- `assembleComponents()` and all `extract*()` functions
- `assertUniqueCodecOwner()` (shared helper)

### What stays in `@prisma-next/contract`

- Contract IR types (`ir.ts`)
- Emitted contract types (`types.ts`): `ContractBase`, `DomainModel`, `DomainField`, `DomainRelation`, hash types, `TypesImportSpec`, `RenderTypeContext`, `TypeRenderEntry`
- Contract validation (`validate-domain.ts`)
- JSON schema (`schemas/`)

### Dependency direction

`@prisma-next/framework-components` → `@prisma-next/contract` (for `TypesImportSpec`, `RenderTypeContext`)

This is the correct direction: the composition system references contract types it contributes to, not the other way around. The contract package has no dependency on framework components.

## What this enables

- **Plane-specific assembly subpaths.** The package can expose `@prisma-next/framework-components/assembly` for control-plane assembly (what exists today) and later `@prisma-next/framework-components/runtime-assembly` for execution-plane assembly. Both operate on the same descriptors but extract different facets.
- **Clean contract package.** `@prisma-next/contract` becomes purely about the contract data structure — what gets emitted, what gets validated, what gets consumed at runtime.
- **Accurate mental model.** Importing `@prisma-next/framework-components` to describe your stack composition is conceptually distinct from importing `@prisma-next/contract` to work with contract data.

## Steps

### Step 1: Create the package

Create `packages/1-framework/1-core/shared/framework-components/`:
- `package.json` — `@prisma-next/framework-components`
- `tsconfig.json`, `tsdown.config.ts`
- Dependency on `@prisma-next/contract` (for `TypesImportSpec`, `RenderTypeContext`) and `@prisma-next/utils`

Add to `architecture.config.json`: covered by the existing `packages/1-framework/1-core/shared/**` glob (domain: framework, layer: core, plane: shared).

### Step 2: Move source files

Move from `@prisma-next/contract/src/` to the new package's `src/`:
- `framework-components.ts`
- `framework-authoring.ts`
- `assembly.ts`

Update internal imports within the moved files (e.g. `./types` → `@prisma-next/contract/types`).

### Step 3: Set up exports

Export subpaths matching the current import paths to minimize churn:
- `@prisma-next/framework-components` — descriptors, instances, pack refs, type renderers, authoring types (everything from `framework-components.ts` + `framework-authoring.ts`)
- `@prisma-next/framework-components/assembly` — assembly functions and types

### Step 4: Update import paths across the codebase

Replace all imports:
- `@prisma-next/contract/framework-components` → `@prisma-next/framework-components`
- `@prisma-next/contract/assembly` → `@prisma-next/framework-components/assembly`

This is the bulk of the work. The grep shows ~70 files importing from `@prisma-next/contract/framework-components`. Most are straightforward path changes.

### Step 5: Remove old exports from `@prisma-next/contract`

- Delete `src/framework-components.ts`, `src/framework-authoring.ts`, `src/assembly.ts` from the contract package
- Remove `./framework-components` and `./assembly` from the contract package's `exports` and `tsdown.config.ts`
- Remove the `@prisma-next/utils` dependency from `@prisma-next/contract` if it was only used by authoring helpers

### Step 6: Verification

- `pnpm lint:deps` clean (no layering violations — same layer, same plane)
- `pnpm typecheck` clean
- `pnpm test:packages` pass
- All imports resolve correctly

## Scope boundaries

- **This plan only moves code.** No API changes, no renames, no refactors of assembly logic. The functions and types move verbatim.
- **Assembly remains control-plane-specific for now.** A future task can add execution-plane assembly to the same package.
- **`TypesImportSpec` stays in `@prisma-next/contract`.** It describes what appears in `contract.d.ts` — that's a contract concern. Framework components reference it, not the other way around.

## Sequencing

This can be done independently of tasks 5.8 (control flow inversion) and 3.10 (Mongo PSL interpreter). It has no prerequisite beyond the current state of the codebase.

If done before 5.8, the 5.8 plan should reference `@prisma-next/framework-components/assembly` instead of `@prisma-next/contract/assembly`.

## Risk

Low. This is a pure move with no behavioral changes. The main risk is the breadth of import path updates (~70 files), which is mechanical.
