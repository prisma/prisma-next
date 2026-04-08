# refactor: TS contract authoring close-out — remove "staged" terminology

## Overview

The TS contract authoring redesign (Milestones 1-2) is complete. The staged contract DSL is proven, tested, and the long-term public surface. The remaining Milestone 3 close-out removes the internal "staged" codename from all public types, file names, internal helpers, test descriptions, and docs — then deletes the transient project folder.

## Problem Statement / Motivation

Every public type (`StagedContractInput`, `StagedModelBuilder`), file name (`staged-contract-dsl.ts`), and function (`buildStagedSemanticContractDefinition`) still carries the "staged" prefix from the prototyping phase. This:

- Confuses new contributors who see "staged" and assume it's a secondary/experimental surface
- Blocks documenting the DSL as the primary public API
- Creates naming noise in autocomplete and docs

The fix is mechanical: rename, update imports, update test descriptions, update ADR references, delete the transient project folder.

## Proposed Solution

A single PR that:

1. Renames 4 source files and 8 test files (drop `staged-` prefix)
2. Renames ~30 type aliases and 3 functions (drop `Staged` prefix)
3. Updates all import paths within the package
4. Updates test descriptions and fixture hashes
5. Renames ADR 181 filename (drop "Staged") and updates cross-references
6. Updates `packages/2-sql/2-authoring/contract-ts/README.md` to remove "staged" language
7. Deletes `projects/ts-contract-authoring-redesign/`

## Scope

All changes are within:
- `packages/2-sql/2-authoring/contract-ts/src/` (4 files renamed, ~6 files with import updates)
- `packages/2-sql/2-authoring/contract-ts/test/` (8 files renamed)
- `packages/2-sql/2-authoring/contract-ts/README.md`
- `docs/architecture docs/adrs/ADR 181 - Contract authoring DSL for SQL TS authoring.md` (renamed file + content)
- `docs/architecture docs/adrs/ADR 182 - Unified contract representation.md` (2 references to ADR 181 filename)
- `projects/ts-contract-authoring-redesign/` (entire directory deleted)

No cross-package type/function renames — the "staged" names don't leak outside `contract-ts`.

## Technical Considerations

- **No behavioral changes**: Pure rename + deletion. The emitted contract, runtime behavior, and public API shape are unchanged.
- **Import paths are package-internal**: All `staged-contract-*` imports are within `contract-ts/src/`. The `exports/contract-builder.ts` barrel re-exports the renamed types.
- **Backward compatibility**: No re-exports of old names needed.
- **ADR 181 filename change**: ADR 182 references ADR 181 by filename in 2 places — must update those links.
- **Coverage HTML files**: Auto-generated, will regenerate on next test run. Not committed.

## Acceptance Criteria

- [x] No file or directory under `packages/2-sql/2-authoring/contract-ts/` contains "staged" in its name
- [x] No exported type, function, or class contains "Staged" in its name
- [x] No test description string contains "staged" (except where it describes historical context)
- [x] ADR 181 filename is `ADR 181 - Contract authoring DSL for SQL TS authoring.md`
- [x] ADR 182 references to ADR 181 use the new filename
- [x] README.md refers to "contract DSL" not "staged contract DSL"
- [x] `projects/ts-contract-authoring-redesign/` is deleted
- [x] `pnpm build` succeeds for `@prisma-next/sql-contract-ts`
- [ ] `pnpm test` passes in `packages/2-sql/2-authoring/contract-ts/` (18 pre-existing failures on main, zero regressions)
- [ ] `pnpm typecheck` passes (1 pre-existing error on main in `build-contract.ts`, zero regressions)

## Implementation Plan

### Phase 1: Source file renames and type/function renames

Rename the 4 source files, then update all type names and function names within them.

**File renames:**

| Current | New |
|---------|-----|
| `src/staged-contract-dsl.ts` | `src/contract-dsl.ts` |
| `src/staged-contract-lowering.ts` | `src/contract-lowering.ts` |
| `src/staged-contract-types.ts` | `src/contract-types.ts` |
| `src/staged-contract-warnings.ts` | `src/contract-warnings.ts` |

**Key type renames (in `contract-dsl.ts`, formerly `staged-contract-dsl.ts`):**

| Current | New |
|---------|-----|
| `StagedModelBuilder` | `ContractModelBuilder` |
| `StagedContractInput` | `ContractInput` |
| `isStagedContractInput()` | `isContractInput()` |

**Key type renames (in `contract-types.ts`, formerly `staged-contract-types.ts`):**

All ~25 `Staged*` type aliases lose the `Staged` prefix:
- `StagedDefinitionModels` → `DefinitionModels`
- `StagedDefinitionTypes` → `DefinitionTypes`
- `StagedModelNames` → `ModelNames`
- `StagedModelTableName` → `ModelTableName`
- `StagedBuiltModels` → `BuiltModels`
- etc.

**Key renames (in `contract-lowering.ts`):**

| Current | New |
|---------|-----|
| `buildStagedSemanticContractDefinition()` | `buildSemanticContractDefinition()` |
| `RuntimeStagedModel` | `RuntimeModel` |
| `RuntimeStagedCollection` | `RuntimeCollection` |

**Key renames (in `contract-warnings.ts`):**

| Current | New |
|---------|-----|
| `RuntimeStagedModel` | `RuntimeModel` |
| `RuntimeStagedCollection` | `RuntimeCollection` |

### Phase 2: Update internal import paths

Update imports in files that reference the renamed source files:

- `src/contract-builder.ts` — update imports from `./staged-contract-dsl`, `./staged-contract-lowering`, `./staged-contract-types`; rename `StagedModelLike`, `StagedContractDefinition`, `StagedContractScaffold`, `StagedContractFactory`, `buildStagedContract`
- `src/contract-lowering.ts` — update import from `./staged-contract-dsl`, `./staged-contract-warnings`
- `src/contract-types.ts` — update import from `./staged-contract-dsl`
- `src/contract-warnings.ts` — update import from `./staged-contract-dsl`
- `src/composed-authoring-helpers.ts` — update import from `./staged-contract-dsl`
- `src/authoring-type-utils.ts` — update import from `./staged-contract-dsl`
- `src/exports/contract-builder.ts` — update re-exported type names

### Phase 3: Test file renames and updates

**File renames:**

| Current | New |
|---------|-----|
| `test/staged-contract-dsl.runtime.test.ts` | `test/contract-dsl.runtime.test.ts` |
| `test/staged-contract-lowering.runtime.test.ts` | `test/contract-lowering.runtime.test.ts` |
| `test/staged-contract-warnings.test.ts` | `test/contract-warnings.test.ts` |
| `test/contract-builder.staged-contract-dsl.test.ts` | `test/contract-builder.dsl.test.ts` |
| `test/contract-builder.staged-contract-dsl.helpers.test.ts` | `test/contract-builder.dsl.helpers.test.ts` |
| `test/contract-builder.staged-contract-dsl.parity.test.ts` | `test/contract-builder.dsl.parity.test.ts` |
| `test/contract-builder.staged-contract-dsl.portability.test.ts` | `test/contract-builder.dsl.portability.test.ts` |

**Content updates in each test file:**
- Import paths updated to new source file names
- Type references updated to new names (e.g., `StagedModelBuilder` → `ContractModelBuilder`)
- Function references updated (e.g., `buildStagedSemanticContractDefinition` → `buildSemanticContractDefinition`)
- `describe()` and `it()` strings: drop "staged" (e.g., "staged contract DSL authoring surface" → "contract DSL authoring surface")
- Fixture `storageHash` strings: drop "staged" (e.g., `sha256:staged-contract-dsl` → `sha256:contract-dsl`)

**Integration test:**
- `test/integration/test/staged-dsl-type-inference.test-d.ts` → `test/integration/test/dsl-type-inference.test-d.ts` (if it exists; search returned no results, may have already been renamed)

### Phase 4: Error message strings

Update any error messages that contain "staged":
- `contract-lowering.ts` line ~385: `'Unknown field "..." in staged contract definition'` → `'Unknown field "..." in contract definition'`

### Phase 5: ADR and docs updates

**ADR 181:**
- Rename file: `ADR 181 - Staged contract DSL for SQL TS authoring.md` → `ADR 181 - Contract authoring DSL for SQL TS authoring.md`
- Update any internal references to function/type names

**ADR 182:**
- Update 2 references to ADR 181 filename (lines ~108 and ~212)
- Update wording "Staged TS authoring" → "TS authoring" where appropriate

**README.md (`packages/2-sql/2-authoring/contract-ts/README.md`):**
- Replace "Staged Contract DSL" heading → "Contract DSL"
- Update any references to staged file names or types
- Position the DSL as the primary (not secondary) surface

### Phase 6: Delete transient project folder

Delete `projects/ts-contract-authoring-redesign/` and all contents:
- `spec.md`, `plan.md`, `authoring-api-options-recommendation.md`
- `contract.before.ts`, `contract.after.ts`, `contract-before-and-after.md`
- `plans/`, `reviews/`
- `.gitignore`, `tsconfig.json`

### Phase 7: Validate

- `pnpm build` in `packages/2-sql/2-authoring/contract-ts/`
- `pnpm test` in `packages/2-sql/2-authoring/contract-ts/`
- `pnpm typecheck` from repo root
- `pnpm lint:deps` from repo root

## Estimated Line Impact

| Category | Estimated lines changed |
|----------|------------------------|
| Source file renames (content unchanged, git tracks as rename) | ~0 net |
| Type/function/import renames within source files | ~200 |
| Test file renames (content unchanged) | ~0 net |
| Test import/describe/hash string updates | ~100 |
| ADR 181 filename + content | ~10 |
| ADR 182 cross-references | ~5 |
| README.md updates | ~20 |
| Project folder deletion | ~negative (removing files) |
| **Total additions+modifications** | **~335 lines changed** |

Well under the 2000-line target.

## Dependencies & Risks

- **Low risk**: Pure rename, no behavioral changes. If any import is missed, `pnpm build` / `pnpm typecheck` will catch it immediately.
- **Git rename detection**: Use `git mv` for file renames so git tracks them as renames rather than delete+create, preserving blame history.
- **No downstream consumers**: The "staged" names don't appear outside `contract-ts` package boundaries.

## References

- This closeout plan is the remaining Milestone 3 artifact after Phase 6 removes `projects/ts-contract-authoring-redesign/`.
- ADR 181: `docs/architecture docs/adrs/ADR 181 - Contract authoring DSL for SQL TS authoring.md`
- ADR 182: `docs/architecture docs/adrs/ADR 182 - Unified contract representation.md`
