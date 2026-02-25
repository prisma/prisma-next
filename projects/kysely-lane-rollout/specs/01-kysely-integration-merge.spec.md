# Summary

Merge the current Kysely integration work in a **shippable** state without attempting the architectural lane extraction. Phase 1 is explicitly about fixing correctness, observability, and merge blockers so Kysely-authored queries become **Prisma Next-visible** (PN AST on plans, Prisma Next lowering path, plugin/guardrail introspection), while keeping package boundaries and high-level structure intact.

# Description

Kysely support began as a runtime-attached integration: author queries with Kysely, then execute them through Prisma Next runtime. The earliest iteration compiled Kysely queries to a SQL string and attached that to a plan, which made Kysely queries a black box inside Prisma Next (plugins and safety rails couldn’t inspect the query).

This Phase 1 spec defines what it means to “merge what we have”:

- keep the integration form factor (extensions package, runtime-attached execution surface)
- fix the black-box issue for supported queries by producing **Prisma Next `QueryAst`** + metadata in the plan
- ensure supported Kysely queries are lowered/executed using Prisma Next’s adapter/lowering pipeline rather than treating Kysely-compiled SQL as authoritative
- fix failing tests, typecheck, lint, and any known correctness issues discovered during this work

This phase intentionally does **not** create the proper build-only Kysely lane; that is Phase 2 and is specified separately.

# Requirements

## Functional Requirements

### 1) AST-backed Kysely plans for supported queries

- Supported Kysely-authored queries executed through the integration path produce a plan with:
  - `ast: QueryAst` (PN SQL AST) populated for supported kinds
  - `params` aligned to `meta.paramDescriptors`
  - lane metadata identifying Kysely as the origin (e.g. `lane: 'kysely'`)
- Runtime plugins and guardrails can inspect these plans (they are no longer opaque SQL strings).

### 2) Lower via Prisma Next, not “SQL string as truth”

- For supported query kinds, execution uses Prisma Next’s lowering/adapter pipeline.
- Kysely-compiled SQL string is not used as the primary execution artifact for supported query kinds.
- If unsupported query kinds exist in the integration:
  - they fail with a **stable, structured runtime error envelope** (not a raw thrown `Error` and not a silent fallback).
  - **Envelope shape**: `RuntimeError` / `RuntimeErrorEnvelope` per existing conventions.
  - **Stable code**: `PLAN.UNSUPPORTED`
  - **Details** (structured): must include at least `{ lane: 'kysely', kyselyKind: string }` and may include `{ reason?: string }`.
  - This behavior is covered by a test for at least one unsupported kind.

### 3) Correctness and mergeability fixes only

- Fix merge blockers and correctness issues discovered during implementation:
  - failing tests
  - typecheck failures
  - lint failures
  - known functional bugs in transform/guardrails/metadata assembly
- Make the minimal documentation updates required for teammates to use the merged result without tribal knowledge.

## Non-Functional Requirements

- **Scope discipline**: avoid package-layer refactors; no extracting a new lane package in Phase 1.
- **Regression safety**: keep current supported Kysely behavior stable (parity tests remain green).
- **Determinism**: plan metadata and parameter ordering are deterministic and tested.

## Non-goals

- Creating `@prisma-next/sql-kysely-lane` (Phase 2).
- Introducing ORM interop protocol (`WhereArg`, `ToWhereExpr`) (Phase 2).
- Removing runtime attachment or hiding execution APIs (Phase 2).
- Constructing PN AST directly without going through Kysely op nodes/compile APIs (Phase 3).
- Expanding transformer support to new Kysely node kinds beyond what is already implemented.

# Acceptance Criteria

- [ ] Supported Kysely execution path yields plans that include PN `QueryAst` (not only SQL strings).
- [ ] Supported Kysely execution path uses Prisma Next lowering/adapter pipeline (not Kysely-compiled SQL as the execution truth).
- [ ] Runtime plugins/guardrails can inspect and enforce behavior based on the AST-backed plan (tests demonstrate this).
- [ ] Kysely guardrails + transformer tests are green and cover the supported node kinds.
- [ ] Unsupported Kysely query kinds fail with `PLAN.UNSUPPORTED` as a structured runtime error envelope (and the error `details` include `lane: 'kysely'` + `kyselyKind`).
- [ ] The repo is mergeable at Phase 1 completion:
  - [ ] `pnpm test:packages` (or the repo’s agreed test gate for this work) passes
  - [ ] typecheck passes
  - [ ] lint passes
- [ ] Phase 1 changes are explicitly documented as “runtime-attached integration” with a link to Phase 2 extraction spec.

# Other Considerations

## Security

Guardrails are safety rails. Any change to guardrail behavior must be explicit and justified. If a guardrail becomes stricter/looser, Phase 1 must include a test that demonstrates and locks the intended behavior.

## Observability

This phase’s definition of “observable” is: the runtime and plugins can reason about Kysely queries via `QueryAst` attached to the plan, and tests enforce that contract.

# References

- Project tracker: `projects/kysely-lane-rollout/spec.md`
- Phase 2 spec (Drive): `projects/kysely-lane-rollout/specs/02-kysely-lane-build-only.spec.md`
- Phase 2 spec (Agent OS source): `agent-os/specs/2026-02-19-kysely-query-lane-build-only/spec.md`
- Branch intent: `tml-1892-transform-kysely-ast-to-pn-ast`
- Error envelope conventions: `docs/architecture docs/adrs/ADR 027 - Error Envelope Stable Codes.md`, `packages/1-framework/4-runtime-executor/src/errors.ts`

# Open Questions

1. What is the Phase 1 merge gate for CI? (full test suite vs a targeted subset)
2. Which Kysely query kinds remain unsupported in Phase 1 (and which one do we use in the “unsupported kind” error-envelope test)?
3. What’s the minimal docs we want for Phase 1 so teammates can use the integration without reading commit history?

