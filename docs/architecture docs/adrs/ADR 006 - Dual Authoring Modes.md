# ADR 006 — Dual Authoring Modes (PSL-first and TS-first) with a Single Canonical Artifact

## Context

- Teams want flexibility to author schemas in PSL or in TypeScript for agent and tool ergonomics
- Having multiple sources of truth creates drift and unclear build boundaries
- Our safety model depends on a deterministic, hashable contract artifact consumed by queries, runtime, migrations, and PPg
- We need great DX in dev (auto emit) and strong determinism in CI

## Decision

- Support two authoring modes per project: PSL-first or TS-first
- A project declares one authoritative mode in config
- Both modes must emit the same canonical artifact: `contract.json` plus `.d.ts` types
- Only `contract.json` is the system of record for downstream tools and hashing
- Back-generation of the non-authoritative form is optional and clearly marked as derived

## Details

### Authoring modes

#### PSL-first
- Source of truth is `schema.prisma`
- Emitter parses PSL and produces `contract.json` and `contract.d.ts`

#### TS-first
- Source of truth is `contract/contract.ts` using `defineContract()`
- Emitter executes the builder in a constrained environment and produces `contract.json` and `contract.d.ts`

### Canonical artifact

- `contract.json` is canonical, deterministic, and cross-platform stable
- Hashing follows ADR 004 with coreHash and profileHash
- `.d.ts` provides types only, no generated runtime objects

### Configuration

`prisma-next.config.ts` declares:
- `authoring: 'psl' | 'ts'`
- Schema path for PSL mode or builder entry for TS mode
- `outDir` for emitted artifacts
- Target info and naming scheme used for deterministic names

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

- `contract.json.meta.source` records the authoring mode and source path
- Tooling warns if both PSL and TS sources are present but the config declares a different authoritative mode

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
- Provenance metadata in artifacts

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
- Require projects to declare one authoritative mode, enforce determinism, and surface provenance
- Keep `.d.ts` emission types-only and rely on `makeT(contractJson)` for runtime construction
