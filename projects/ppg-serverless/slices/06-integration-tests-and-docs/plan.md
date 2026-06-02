# Slice 6 — Dispatch plan

Slice spec: [`./spec.md`](./spec.md)

## Sizing rationale

Two coherent outcomes that share the same slice but separate naturally:

1. **Validation** — real-PPG integration tests substitute for mocked-driver coverage from prior slices. The `@prisma-next/test-utils` extension is the precondition (the integration tests can't compose without `ppgUrl` on `DevDatabase`). This is one logical state: "the new facade round-trips real SQL through real PPG."
2. **Docs** — READMEs + repo map. This is the other logical state: "the new packages are documented for external consumers."

Splitting the slice into two dispatches keeps each one's verification independent. D1's verification is `pnpm test:packages` green. D2's verification is reviewer-accept on the documentation content. Combining them would mean the second commit's diff covers both code and docs — harder to review.

Matches **Single-package new feature** (D1) + **Voice-aware doc edits** (D2) per [`drive/calibration/sizing.md`](../../../../drive/calibration/sizing.md) and the model-tier routing in [`drive/calibration/model-tier.md`](../../../../drive/calibration/model-tier.md). Both inside the dispatch-INVEST *Small* ceiling.

## Dispatch plan

### Dispatch 1: `@prisma-next/test-utils` extension + integration tests

- **Outcome:** `DevDatabase` from `@prisma-next/test-utils` carries a `ppgUrl: string` field populated from `server.ppg.url`. The facade package has a new file `test/prisma-postgres-serverless.integration.test.ts` with 6–8 tests that round-trip SELECT, INSERT, an explicit `transaction(...)` commit, transaction rollback, `acquireConnection` lifecycle, and connection-level error normalisation against `@prisma/dev`'s in-process PPG endpoint. Tests run by default in CI; no env gating.

- **Builds on:** Slice 5's facade runtime (the integration tests exercise that real runtime); the chosen design in [`./spec.md`](./spec.md).

- **Hands to:** A validated facade — AC-4 verifiable end-to-end. D2 then writes the user-facing docs that describe this verified surface.

- **Focus:**
  - **`test-utils` change is minimal**: add one field to `DevDatabase`; populate from `server.ppg.url` through the same `normalizeConnectionString` helper that handles the TCP `connectionString`. Verify nothing breaks by running `pnpm typecheck` workspace-wide.
  - **Integration tests use `withDevDatabase` semantics**: each test opens its own `@prisma/dev` server, runs the operation, asserts, lets `withDevDatabase` clean up. No shared state.
  - **Real facade + real driver + real PPG protocol.** No mocking at any layer; this is the validation slice.
  - **`runtime().connection()` for raw DDL** — needed to set up tables before the SQL-builder-driven SELECT. Verify the facade's `runtime` exposes a `.connection()` method (`@prisma-next/sql-runtime`'s `Runtime` interface should — it's the raw-execution escape hatch).
  - Working positions on Open Questions:
    - OQ2 — no separate `test:integration` command; tests run inline via `pnpm test:packages`.
    - OQ1 (`./config` + `./contract-builder` stubs) — N/A for this dispatch; docs in D2 describe the limitation.

#### Completed when

1. `pnpm --filter @prisma-next/test-utils typecheck` exits 0. The `DevDatabase` interface change doesn't break existing callers.
2. `pnpm --filter @prisma-next/test-utils build` exits 0.
3. `pnpm --filter @prisma-next/prisma-postgres-serverless test` exits 0. Existing Slice-5 tests still pass (regression baseline) plus 6–8 new integration tests pass against the real PPG endpoint.
4. `pnpm test:packages` workspace-wide exits 0 (AC-6 final check).
5. `pnpm lint:deps` exits 0.
6. `pnpm --filter @prisma-next/test-utils lint` and `pnpm --filter @prisma-next/prisma-postgres-serverless lint` exit 0.
7. No transient project IDs in source (canonical regex on +diff returns empty); manual prose-attribution sweep empty.
8. No bare `as` casts in production code (the test-utils delta is a 1-field addition; should require zero casts).
9. Total integration-test runtime <2 minutes wallclock (single test file). If slower, surface for review of test scope.

#### Halt conditions

- `@prisma/dev`'s `server.ppg.url` doesn't materialise (e.g. `ppg` field undefined on the server object at runtime) — read the actual server object at runtime to confirm the field is present; surface if it isn't.
- Workspace-wide `pnpm test:packages` reveals an unrelated regression triggered by the `DevDatabase` extension — root-cause before continuing.
- An integration test wants a feature the facade doesn't expose (e.g. `runtime().connection()` for raw SQL) — surface; that's a Slice-5 follow-up, not a Slice-6 fix.
- Integration test runtime exceeds 5 minutes — surface; the test scope is wrong.

### Dispatch 2: READMEs + repo docs

- **Outcome:** `packages/3-targets/7-drivers/ppg-serverless/README.md` has its Slice-1 TODO placeholders replaced with real Architecture + Usage content. `packages/3-extensions/prisma-postgres-serverless/README.md` ships full Usage section + Cloudflare Workers example + documented `./config` / `./contract-builder` stub limitation. `docs/onboarding/Repo-Map-and-Layering.md` lists both new packages. All content uses neutral wording (no transient project IDs).

- **Builds on:** D1 (the validated facade behaviour is what the docs describe).

- **Hands to:** Project close-out (`drive-close-project`). After D2 SATISFIED, the slice closes; close-out verifies all project ACs, cleans up `projects/ppg-serverless/`, and opens the project PR.

- **Focus:**
  - **Driver README** — mirror `@prisma-next/driver-postgres/README.md`'s structure. Architecture mermaid: caller → SqlDriver → `@prisma/ppg.Client.newSession` → WS → PPG service. Usage: descriptor + create + connect with both binding variants (`{ kind: 'url' }`, `{ kind: 'ppgClient' }`).
  - **Facade README** — mirror `@prisma-next/postgres/README.md`'s structure. Cloudflare Workers example with the full code block from the spec. Document the stub `./config` and `./contract-builder` exports + the workaround (use `@prisma-next/postgres/config` with a TCP URL for migration tooling). Bindings, transactions, compatibility envelope.
  - **Repo Map** — one-line entries for both new packages, matching the format of adjacent entries.
  - **Neutral wording everywhere**. The README + Repo Map are source-shipping artifacts; transient project IDs are forbidden. Run the canonical regex + prose-attribution sweep before staging.

#### Completed when

1. Driver README ships Architecture mermaid + Usage code block (replacing Slice-1 TODOs).
2. Facade README ships Usage + Cloudflare Workers example + `./config` / `./contract-builder` stub-documentation + bindings + transactions + compatibility envelope.
3. Repo Map lists both new packages.
4. No transient project IDs in source / docs (canonical regex on +diff empty; manual prose-attribution sweep empty).
5. Build / lint / lint:deps clean (docs-only diff; should be trivially green).

#### Halt conditions

- Cloudflare Workers example references API the facade doesn't expose — surface; check the runtime's actual surface before writing the example.
- Architecture mermaid references a PPG concept that doesn't exist (e.g. a non-existent transport mode) — surface; ground in PPG's actual API.

## Hand-off completeness check

Slice-DoD per [`./spec.md`](./spec.md):

- [x] Integration tests pass — D1's `Completed when` #3.
- [x] `pnpm test:packages` workspace-wide green — D1's `Completed when` #4.
- [x] Driver README's TODO placeholders replaced — D2's `Completed when` #1.
- [x] Facade README + Workers example + stub-docs — D2's `Completed when` #2.
- [x] Repo Map updated — D2's `Completed when` #3.

The two dispatches together close the slice. Project close-out (`drive-close-project`) runs after.
