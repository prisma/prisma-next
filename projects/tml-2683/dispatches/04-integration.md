# Brief: D4 — Integration coverage: STI + MTI target includes on a real DB

## Task

Add real-DB integration coverage in `test/integration/test/sql-orm-client/` for
`.include('<polyRel>')` where the related model is polymorphic — both an STI-target relation and
an MTI-target relation — exercised against **both** PGlite (Postgres) and SQLite, the two targets
the existing integration suite already runs. The tests must assert: (1) STI-target include returns
each child row shaped per its discriminator variant (variant-specific fields present + correct);
(2) MTI-target include returns rows with the variant tables' columns present; (3) a variant-specific
`where` on the include refinement filters correctly (this is the runtime confirmation of AC-3 — only
works because D1 joined the variant tables into the child SELECT); (4) a `.variant('X')`-narrowed
include returns only that variant's rows with the narrowed shape. This is the slice's acceptance
surface: D1–D3 are unit/type-verified; D4 confirms the whole read path end-to-end on real engines.

There is **zero** polymorphism coverage in the integration suite today, so you will need to author a
polymorphic-relation fixture: a parent model with a 1:N relation to an STI poly model and a 1:N
relation to an MTI poly model, the real tables (base + MTI variant tables) created in the test DB,
and seed helpers. The slice spec's working position (Open Question #2) is a **standalone poly
contract + seed helpers** rather than bending the shared `getTestContract()` — confirm what fits the
suite's harness and say which you chose.

## Scope

**In:**
- A polymorphic fixture for the integration suite: contract + DDL (base table, STI discriminator
  column, MTI variant tables joined on PK) + seed helpers, following the patterns the existing
  `test/integration/test/sql-orm-client/` tests use to stand up schema and seed rows (see
  `integration-helpers.ts`, `runtime-helpers.ts`, `helpers.ts`, and how `include.test.ts` /
  `nested-includes.test.ts` create + seed + run across targets).
- New test file(s) under `test/integration/test/sql-orm-client/` covering the four assertions above,
  parameterized over both targets exactly as the suite's existing cross-target tests are.
- Mirror the poly contract shape from the unit fixtures (`packages/3-extensions/sql-orm-client/test/helpers.ts`
  `buildStiPolyContract` / `buildMixedPolyContract`) so the integration models match what the unit
  layer already exercises.

**Out:**
- Any production-code change in `packages/3-extensions/sql-orm-client/src/**`. D1–D3 delivered the
  behavior; D4 is **tests + fixtures only**. If an integration test fails because of a real
  production bug (not a fixture/seed mistake), that is a halt-and-surface — do NOT patch
  `src/**` from this dispatch; report it so the orchestrator can reopen the relevant dispatch.
- Unit / type-level tests (D1–D3 own those).
- The `.variant()` type surface (D3).

## Completed when

- [ ] STI-target `.include()` integration test passes on PGlite + SQLite, asserting per-variant row shape.
- [ ] MTI-target `.include()` integration test passes on PGlite + SQLite, asserting variant columns present.
- [ ] Variant-specific `where` on a poly include refinement is exercised and filters correctly (AC-3).
- [ ] `.variant('X')`-narrowed poly include is exercised and returns only that variant (AC-4 at integration).
- [ ] The new fixture (contract + DDL + seeds) is committed and self-contained (no external DB).
- [ ] Validation gate green (below).

## Standing instruction

Stay focused on the goal; control scope. Tests are the deliverable here. If you hit a real
production defect, HALT and surface it with the failing assertion + evidence — do not fix `src/**`.
Trivial-and-related fixture/helper additions that serve the goal are fine in the same dispatch.

## References

- Slice spec: `projects/tml-2683/spec.md` — slice-DoD (the integration condition), Open Question #2 (standalone contract vs extend shared).
- Slice plan: `projects/tml-2683/plan.md` § Dispatch 4 (note the sanctioned resize: if the shared contract can't be cleanly extended, authoring the poly fixture can be its own sub-step).
- D1–D3 commits on this branch (`git log --oneline df99e8c7a..HEAD`) — the behavior you're confirming.
- Existing integration patterns: `test/integration/test/sql-orm-client/include.test.ts`, `nested-includes.test.ts`, `integration-helpers.ts`, `runtime-helpers.ts`, `helpers.ts`.
- Unit poly fixtures to mirror: `packages/3-extensions/sql-orm-client/test/helpers.ts` (`buildStiPolyContract`, `buildMixedPolyContract`); unit poly include behavior: `query-plan-select.test.ts`, `collection-dispatch.test.ts`, `collection-variant.test.ts`.
- Implementer persona: `skills-contrib/drive-dispatch/agents/implementer.md`.

## Operational metadata

- **Model tier:** orchestrator-grade (opus) — real-DB fixture authoring + cross-target wiring; the suite's harness is non-obvious.
- **Validation gate (run once, at end):**
  - the new integration test file(s) on **both** targets (discover the suite's target-parameterization + the right `pnpm --filter <integration-pkg> test <path>` or `pnpm test:integration` invocation; report the exact commands)
  - `pnpm --filter <integration-test-package> typecheck` (discover the package name)
  - a focused run confirming you did not break sibling integration tests in `sql-orm-client/`
  - `pnpm lint:deps`
- **Halt conditions:** an integration test fails due to a real `src/**` defect (surface, do not patch src); the suite can't run both targets without infra you don't have; a new external dependency would be required; diff strays into `packages/**/src`.
- **Heartbeats:** `wip/heartbeats/implementer.txt` per persona cadence (integration runs are long — foreground them and ping before/after). **Commit hygiene:** explicit staging; never push.
