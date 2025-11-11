# Project Brief — Move Pack Assembly From Framework CLI To Family /cli

Goal: Make the CLI family‑agnostic by moving pack assembly logic (operation registry, type import extraction, extensionIds) out of the framework CLI and into family‑provided helpers that are exported via each family’s `/cli` entrypoint. Switch the CLI to config‑only inputs and remove pack flags.

## Context

Current state:
- Framework CLI hosts `pack-loading.ts` and `pack-assembly.ts` that parse manifests and assemble family‑specific structures.
- The `emit` command accepts `--adapter` and `--extensions` flags; the CLI reads manifests, constructs an operation registry and type imports, and passes them to the emitter.
- TargetFamilyHook already covers family validation and `.d.ts` generation, but the CLI still pulls family‑specific logic into framework scope.

Problems:
- Couples framework CLI to SQL types/assumptions and risks cross‑plane imports.
- Two ways to supply packs (flags vs code) invite drift.
- Harder to tree‑shake; emit pays the cost of loading runtime‑adjacent code.

## Decision

- Config‑only inputs: Applications declare `family`, `target`, `adapter`, and `extensions` in `prisma-next.config.ts`. CLI reads only the config module (not packs or JSON).
- Family /cli helpers: Each family’s `/cli` default export provides:
  - `hook: TargetFamilyHook` (for the emitter)
  - `assembleOperationRegistry(descriptors)`
  - `extractCodecTypeImports(descriptors)`
  - `extractOperationTypeImports(descriptors)`
- CLI orchestration: `emit` loads the config, reads the family hook and helpers from `config.family`, calls helpers with `{ adapter, target, extensions }`, derives `extensionIds`, and then calls `emit(ir, { … }, family.hook)`.
- Remove pack flags and pack‑loading/assembly from framework CLI. No discovery, no JSON reads.

## Scope

In scope:
- Add family‑provided helpers under SQL family (and pattern for other families).
- Update framework CLI to config‑only surface, remove reliance on `pack-loading.ts` and `pack-assembly.ts`.
- Update docs and tests to reflect `/cli` vs `/runtime` entrypoints and config‑only model.

Out of scope:
- Changing TargetFamilyHook API (keeps `validateTypes`, `validateStructure`, `generateContractTypes`).
- Rewriting adapter/driver/runtime code.

## Proposed Layout

- packages/sql/tooling/emitter/                # SQL TargetFamilyHook (unchanged)
- packages/sql/family/cli/
  - index.ts                                   # default export: { id: 'sql', hook, assembleOperationRegistry, extractCodecTypeImports, extractOperationTypeImports }
  - assembly.ts                                # family helper implementations
- @prisma-next/targets-postgres/cli            # target descriptor (IR)
- @prisma-next/adapter-postgres/cli            # adapter descriptor (IR) (+ optional create/adapter)
- @prisma-next/adapter-postgres/runtime        # runtime factory (not used by emit)

## Config Shape (unchanged from 20‑CLI brief)

```ts
import { defineConfig } from '@prisma-next/cli';
import sql from '@prisma-next/family-sql/cli';
import postgres from '@prisma-next/targets-postgres/cli';
import postgresAdapter from '@prisma-next/adapter-postgres/cli';

export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  extensions: [],
  db: { url: process.env.POSTGRES_URL },
});
```

## Framework CLI Changes

- emit command:
  - Add `--config <path>` (default to `./prisma-next.config.ts` if present)
  - Remove `--adapter` and `--extensions` flags
  - Load config, read `family.hook` and helpers from `config.family`
  - Call helpers with `{ adapter, target, extensions }` to get `operationRegistry`, `codecTypeImports`, `operationTypeImports`, and compute `extensionIds`
  - Call emitter with assembled inputs and `family.hook`

- Remove or deprecate:
  - `src/pack-loading.ts`, `src/pack-assembly.ts` (callers moved to family)
  - Tests relying on pack flags

## Family Responsibilities (SQL)

- Provide `/cli` helpers that assemble:
  - `SqlOperationRegistry` by converting operation manifests to signatures and registering them
  - `TypesImportSpec[]` for codec and operation types from manifests
  - Validate helper inputs locally; hook performs final validation during emit (`validateTypes` with `ctx.operationRegistry` + `ctx.extensionIds`)

- Deterministic composition:
  - `extensionIds`: `[adapter.id, target.id, ...extensions.map(e=>e.id)]` (dedupe, preserve order)
  - Deduplicate type imports by `{ package, named, alias }`
  - Merge manifests (warn on conflicts)

## Acceptance Criteria

- CLI:
  - `prisma-next emit --contract src/contract.ts --out dist --config prisma-next.config.ts` emits artifacts; no pack flags
  - Framework CLI has no imports of SQL types or pack assembly utils
- Family:
  - SQL `/cli` exports hook and helpers; emit succeeds using them
  - TargetFamilyHook.validateTypes validates operator registry + extensionIds
- Docs:
  - CLI README, Onboarding, Package‑Layering, and ADRs reflect config‑only model and `/cli` vs `/runtime`
- Tests:
  - Integration tests cover config loading and helper execution
  - Negative tests for invalid descriptors/manifests

## Migration Plan

1) Implement SQL family helpers in `packages/sql/family/cli/assembly.ts`; re‑export via `family‑sql/cli`.
2) Update `emit` to load config, call family helpers, and remove flags.
3) Migrate tests off flags; add config‑based tests.
4) Remove `pack-loading.ts` and `pack-assembly.ts` after a brief deprecation window (optional).
5) Update docs (already drafted in 20‑CLI brief and ADR‑150).

## Risks & Mitigations

- Risk: Hidden SQL type leaks into CLI — Mitigation: helpers live in family packages, CLI reads only config and calls function references.
- Risk: Eager runtime imports in config — Mitigation: recommend lazy factories (create()) or separate `/runtime` imports.
- Risk: Duplicate manifests or type imports — Mitigation: deterministic merge + warnings.

## References
- 20‑CLI Support for Extension Packs (config‑only, /cli vs /runtime)
- ADR‑150 Family‑Agnostic CLI and Pack Entry Points
- 01‑Emitter Hook Architecture (manifest‑agnostic hooks)

