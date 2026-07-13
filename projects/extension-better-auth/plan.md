# extension-better-auth — Plan

**Spec:** `projects/extension-better-auth/spec.md`
**Linear Project:** [BetterAuth Extension](https://linear.app/prisma-company/project/betterauth-extension-3b602d4b711a)

## At a glance

**Single slice, single PR** (operator decision, 2026-07-10): the whole extension — managed contract space, contract-typed adapter, example app, docs close-out — lands as one PR. Internally the work is a pure stack of three phases following the repo's sandwich pattern (contract/IR layer → consumer layer → example layer); each phase's hand-off is consumed by the next on the same branch.

## Composition

### Slice `extension-better-auth` (the only slice; one PR)

- **Tracking issue:** [TML-2994](https://linear.app/prisma-company/issue/TML-2994) (PR carries this prefix); phase issues [TML-2995](https://linear.app/prisma-company/issue/TML-2995), [TML-2996](https://linear.app/prisma-company/issue/TML-2996) are its sub-issues and are closed by the same PR.
- **Outcome:** every project-DoD condition in the spec — the package, the managed space, the conformant adapter, the integration tests, and `examples/better-auth` — is true on `main` after one merge.
- **Builds on:** None (external: `better-auth` v1.5+ and `@better-auth/test-utils` join the workspace).
- **Hands to:** Project-DoD closure; close-out ceremony deletes `projects/extension-better-auth/`.

#### Phase stack (in order, same branch)

1. **P1 — package scaffold + managed contract space** — Linear: [TML-2994](https://linear.app/prisma-company/issue/TML-2994)
   - **Outcome:** `@prisma-next/extension-better-auth` exists at `packages/3-extensions/better-auth/` with `/pack` + `/contract` subpaths. The pack ships the managed contract space (`spaceId: 'better-auth'`): `User`, `Session`, `Account`, `Verification` with BetterAuth-default table names in `public`, text ids, navigable internal FK relations, unique constraints, and a baseline migration. On a fresh database `contract emit` + `db init` create the four tables and `db update` is a no-op at head. `/contract` ships `extensionModel`-branded handles. Registered in `architecture.config.json`.
   - **Hands to:** Typed ORM collections + navigable relations the adapter compiles against; branded handles for the example's cross-space FK.
   - **Focus:** No `better-auth` dependency yet, no adapter code, no example. (Precedents: `packages/3-extensions/supabase` layout; `packages/3-extensions/pgvector` managed space shipping migrations.)

2. **P2 — contract-typed adapter + conformance suite** — Linear: [TML-2995](https://linear.app/prisma-company/issue/TML-2995)
   - **Outcome:** The `/adapter` subpath ships `prismaNextAdapter(db)` built on `createAdapterFactory` (`better-auth` v1.5+ peerDependency): full CRUD surface plus native `consumeOne` (`Collection.delete()`), `transaction` (runtime transaction API), and native `join` (`Collection.include()`). Model/field mapping exhaustively typed against `contract.d.ts`; unknown surfaces fail fast with typed errors; values cross through codecs. BetterAuth's official conformance suite — including join coverage — passes over PGlite in `pnpm test:integration`, plus an end-to-end `betterAuth()` sign-up → session test.
   - **Hands to:** A conformant adapter surface an app hands to `betterAuth({ database: … })` — what P3's example consumes.
   - **Focus:** Adapter + integration tests. No example app; no docs beyond the package README.

3. **P3 — examples/better-auth end-to-end + docs close-out** — Linear: [TML-2996](https://linear.app/prisma-company/issue/TML-2996)
   - **Outcome:** `examples/better-auth` runs end-to-end (emit → db init → sign-up → authenticated request) with a README, demonstrating a cross-space FK from an app model onto the `better-auth` `User`. Extension-authoring doc/skill references name this package as the managed-space precedent; ADR authored if the translation pattern is judged durable.
   - **Hands to:** PR-ready branch; close-out ceremony (project folder deletion) follows merge per project-DoD.
   - **Focus:** Example, docs, ADR audit. No adapter or contract changes except bugs the example surfaces.

## Dependencies (external)

- [ ] `better-auth` (v1.5+) and `@better-auth/test-utils` npm packages added to the workspace (peer + dev deps) — status: not yet added; lands with P2.
- [ ] PGlite-based integration-test infra — status: already in place (`test/integration`, `pnpm test:integration`).

## Sequencing rationale

The operator chose single-PR delivery over slice-per-PR: the three phases are strictly stacked (the adapter cannot typecheck without P1's `contract.d.ts`; the example cannot run without P2's adapter), so splitting them into PRs bought review granularity but no parallelism. Cost accepted: one larger review sitting; the phase structure above is the reviewer's reading order. Because nothing ships mid-project, the spec's transitional-shape constraints collapse to "CI green at the single merge."
