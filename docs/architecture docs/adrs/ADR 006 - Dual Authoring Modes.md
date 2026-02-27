# ADR 006 — Dual Authoring Modes (PSL-first and TS-first) with a Single Canonical Artifact

## Context

- Teams want flexibility to author schemas in PSL or in TypeScript for agent and tool ergonomics
- Having multiple sources of truth creates drift and unclear build boundaries
- Our safety model depends on a deterministic, hashable contract artifact consumed by queries, runtime, migrations, and PPg
- We need great DX in dev (auto emit) and strong determinism in CI

## Decision

- Support two authoring modes per project: PSL-first or TS-first
- A project supplies one authoritative **contract source provider** in config
- Both modes must emit the same canonical artifact: `contract.json` plus `.d.ts` types
- Only `contract.json` is the system of record for downstream tools and hashing
- Back-generation of the non-authoritative form is optional and clearly marked as derived

## Details

### Problem statement

We want dual authoring surfaces without coupling the framework/CLI to every possible input format. The convergence boundary must remain a framework-defined Contract IR and a single canonical artifact (`contract.json`) so parity and determinism are enforceable.

### Constraints (non-negotiables)

- `contract.json` must be deterministic and cross-platform stable.
- Hashing must only cover canonical contract meaning (no file paths, no source IDs, no spans).
- The CLI/control plane must be source-agnostic (no `kind` switching on “PSL vs TS vs …”).
- Providers may produce rich diagnostics (including spans), but those diagnostics must not enter canonical artifacts.

### Authoring modes

#### PSL-first
- Source of truth is `schema.prisma`
- Emitter parses PSL and produces `contract.json` and `contract.d.ts`

#### TS-first
- Source of truth is `contract/contract.ts` using `defineContract()`
- Emitter executes the builder in a constrained environment and produces `contract.json` and `contract.d.ts`

### Canonical artifact

- `contract.json` is canonical, deterministic, and cross-platform stable
- Hashing follows ADR 004: meaning hashes (e.g. `storageHash`, optional `executionHash`) plus `profileHash` for pinned capability profile
- `.d.ts` provides types only, no generated runtime objects

### Responsibility split (how we decouple framework from authoring)

**Contract source provider (authoring-owned):**

- Loads input(s) (read files, evaluate TS builder, etc.).
- Parses/constructs an intermediate representation and returns **framework-defined `ContractIR`**.
- Returns structured diagnostics on failure (optionally with `sourceId` + span).

**Framework emission pipeline (framework-owned):**

- Validates provider-produced IR (structure + invariants).
- Normalizes IR into the canonical, parity-enforcing boundary (defaulting, stable ordering/identities).
- Canonicalizes + hashes from normalized IR.
- Emits `contract.json` + `contract.d.ts` deterministically.

This ensures the framework remains **ignorant of source formats** while still enforcing **shared meaning** and **identical canonical artifacts** across providers.

### Configuration

`prisma-next.config.ts` declares:

- `contract.source`: an async provider `() => Promise<Result<ContractIR, ContractSourceDiagnostics>>`
- `contract.output`: path to `contract.json` (types are colocated as `contract.d.ts`)

Example (shape):

```ts
import { defineConfig } from '@prisma-next/core-control-plane/config-types';
import { err, ok } from '@prisma-next/utils/result';

export default defineConfig({
  // ... family/target/adapter wiring ...
  contract: {
    output: 'src/prisma/contract.json',
    source: async () => {
      // Provider-owned I/O + parsing/authoring.
      // Must return framework-defined ContractIR (not JSON).
      try {
        const ir = await buildContractIrSomehow();
        return ok(ir);
      } catch (e) {
        return err({
          summary: 'Failed to build Contract IR',
          diagnostics: [
            { code: 'contract_source_error', message: String(e) },
          ],
        });
      }
    },
  },
});
```

### Dev and CI behavior

#### Dev
- Vite/Next/esbuild plugins auto-emit on import and on file change
- Errors surface inline in terminal and editor

#### CI
- Explicit `prisma-next contract emit` step required
- Pipeline verifies determinism by re-emitting and checking hashes

### Back-generation

- Optional renderers can derive PSL from a TS contract or a TS scaffold from PSL
- Back-generated files are annotated as derived and should not be committed as sources

### Meta and provenance

- Canonical artifacts exclude provider provenance (no schema paths/sourceIds)
- Canonical `contract.json` has no top-level `sources` field
- Source provenance is diagnostics-only (CLI/editor output), not hash input

### Failure modes

- If both sources change in the same branch, the emitter fails with a clear error
- If the derived file exists and differs from a fresh render, emitter warns and offers a fix strategy
- If the hashing changes across platforms, CI fails determinism checks

## Alternatives considered

- **Single authoring mode only**: Simpler docs but constrains teams and agents that prefer TS builders
- **Multiple sources of truth with last-write wins**: Easy to corrupt artifacts and defeats deterministic hashing
- **TS-only with PSL deprecated**: Excludes a large part of the existing ecosystem and increases migration cost

## Consequences

### Positive

- Teams choose the mode that fits their workflow and tools
- Deterministic `contract.json` keeps safety, hashing, and PPg features intact
- Agents can operate in either mode and rely on the same downstream artifact

### Trade-offs

- Slightly more complexity in config and docs
- Need clear guardrails to avoid dual-source drift

## Scope and non-goals

### In scope for MVP

- PSL-first and TS-first emission producing identical `contract.json` for equivalent intent
- Dev plugins for auto-emit and CI command for explicit emit
- Provider diagnostics with source spans; no provenance in canonical artifacts

### Out of scope for MVP

- Full fidelity PSL↔TS round-trip for advanced target extensions
- Integrated migration of large codebases between modes

## Backwards compatibility and migration

- Existing PSL projects can switch to PSL-first with minimal changes
- TS-first projects can be bootstrapped from an emitted PSL by generating a TS scaffold
- A one-time helper can render PSL from an existing contract to ease audits

## Open questions

- Degree of back-generation we want to support beyond basic scaffolds
- How to represent complex target extensions in PSL rendering without leaking adapter details
- Whether to allow mixed mode within a mono-repo with clear package boundaries

## Decision record

- Adopt dual authoring modes with a single canonical artifact
- Require projects to declare one authoritative source provider, enforce determinism, and keep provenance diagnostics-only
- Keep `.d.ts` emission types-only and rely on `makeT(contractJson)` for runtime construction
