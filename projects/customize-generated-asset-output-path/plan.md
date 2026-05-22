# Project Plan: customize-generated-asset-output-path

**Spec:** [`./spec.md`](./spec.md)
**Design notes:** [`./design-notes.md`](./design-notes.md)
**Linear ticket:** [TML-2664](https://linear.app/prisma-company/issue/TML-2664/mongo-feature-request-customize-generated-asset-output-path) (no separate Linear Project — per operator direction, the existing ticket in `[PN] EA Release` is the surface)

**Purpose** _(from spec)_: Give Prisma Next users control over where the contract emitter writes its two generated artifacts (`contract.json`, `contract.d.ts`), through a config-file option and a matching CLI flag, applied consistently across every first-party target.

## At a glance

Single slice covering both Mongo + Postgres `defineConfig` wrappers, the CLI flag, and tests. No stack; nothing to parallelise. Design ceremony was substantial; implementation is contained — per the [`Design depth ≠ slice count`](../../drive/triage/README.md#design-depth--slice-count) heuristic.

## Composition

### Single slice

**Slice `output-path-override`** — expose `output?: string` on both Mongo + Postgres `defineConfig` wrappers and add `--output` to `prisma-next contract emit`, with CLI > config > default precedence. Land both wrappers + CLI + tests + docs in one PR.

- **Purpose**: deliver every PDoD condition in one cohesive change so the user-facing surface ships consistent across Mongo + Postgres in a single rollout step.
- **Scope**:
  - `packages/3-extensions/mongo/src/config/define-config.ts` — add `output?: string` to `MongoConfigOptions`; default-path derivation unchanged; pass through to `ContractConfig.output`.
  - `packages/3-extensions/postgres/src/config/define-config.ts` — same change to `PostgresConfigOptions`, identical surface.
  - `packages/1-framework/3-tooling/cli/src/commands/contract-emit.ts` — add `--output <path>` flag.
  - `packages/1-framework/3-tooling/cli/src/control-api/operations/contract-emit.ts` — accept CLI override; CLI > config > default precedence at the entry point.
  - Test additions: unit tests for each wrapper (option threaded into `ContractConfig.output`); CLI test for the flag + precedence; integration / e2e test confirming an override produces artifacts at the requested path (one target is sufficient for the e2e — slice author picks).
  - Docs: a short section in the Contract Emitter subsystem doc or the CLI reference (slice author picks the right home).
- **Depends on**: nothing internal; nothing external.
- **Linear**: [TML-2664](https://linear.app/prisma-company/issue/TML-2664/mongo-feature-request-customize-generated-asset-output-path) — the ticket *is* the slice's Linear surface; no separate slice issue.

### Out of project (tracked separately)

- **TML-2677** — Add `@prisma-next/sqlite/config` `defineConfig` wrapper at ergonomic parity with Mongo + Postgres. Surfaced during this project's slice spec authoring; deliberately deferred (not a config-knob extension; needs its own design pass + demo migration).

## Dependencies (external)

None.

## Project-DoD coverage map

| Project-DoD | Delivered by |
|---|---|
| **PDoD1.** Single slice merged | `output-path-override` |
| **PDoD2.** `output` on both Mongo + Postgres `defineConfig` wrappers | `output-path-override` |
| **PDoD3.** `--output` flag with CLI > config > default precedence | `output-path-override` |
| **PDoD4.** Default behaviour byte-identical for Mongo + Postgres fixtures | `output-path-override` (test invariant) |
| **PDoD5.** Tests covering wrappers, CLI flag, precedence, default-unchanged | `output-path-override` |
| **PDoD6.** Docs updated (config / CLI reference) | `output-path-override` |
| **PDoD7.** Repo green: build, test:packages, test:integration, test:e2e, lint:deps, fixtures:check | `output-path-override` (slice DoD gates) |
| **PDoD8.** Final retro complete; output landed | close-out |
| **PDoD9.** Long-lived docs migrated into `docs/` | close-out |
| **PDoD10.** Repo-wide references to `projects/...` removed | close-out |
| **PDoD11.** `projects/customize-generated-asset-output-path/` deleted | close-out |
| **PDoD12.** TML-2664 auto-closed by PR merge | `output-path-override` PR merge |

## Risks + open questions

1. **CLI flag wiring may touch more files than the two referenced.** The CLI uses a control-API split (command file ↔ operation file); the slice author may discover an args type, a control-API descriptor, or a help-text surface that also needs updating. Not a planning risk — just expect the slice's dispatch list to be 2-4 files on the CLI side rather than exactly 2.
2. **Soft-warning surface choice.** The spec calls for soft warnings on unusual paths; the slice author picks the warning mechanism (existing diagnostic infrastructure vs `console.warn`). Working position: use whatever the CLI already uses for emit warnings.

## Close-out (required)

- [ ] Verify all acceptance criteria in [`./spec.md`](./spec.md)
- [ ] Mandatory final retro complete; output landed in canonical / `drive/calibration/` / ADR
- [ ] Migrate long-lived docs into `docs/` (likely small additions to the Contract Emitter subsystem doc; possibly a one-line clarification to the `contract-space-package-layout` rule)
- [ ] Strip repo-wide references to `projects/customize-generated-asset-output-path/**` (replace with canonical `docs/` / `.cursor/rules/` links or remove)
- [ ] Delete `projects/customize-generated-asset-output-path/`
- [ ] Linear ticket [TML-2664](https://linear.app/prisma-company/issue/TML-2664/mongo-feature-request-customize-generated-asset-output-path) auto-closed by PR merge integration
