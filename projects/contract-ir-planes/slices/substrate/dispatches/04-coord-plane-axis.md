# D4 — Coordinate plane axis + artefact-review cleanup

> **Brief format & scope discipline.** Stay strictly inside the file list below. Do NOT rename any existing slot keys (`tables`, `types`, `collections`) — that work is A01, deferred to a standalone Linear ticket. Do NOT lift namespace concretions onto a `.entries` redirect — that work is A02(b), also deferred. Both are out of scope for this dispatch; if the diff strays outside the file list, halt and escalate.
>
> **Slice plan:** [`projects/contract-ir-planes/slices/substrate/plan.md`](../plan.md) § Dispatch 4. **Slice spec:** [`projects/contract-ir-planes/slices/substrate/spec.md`](../spec.md) § Approach (last paragraph). **ADR:** [`projects/contract-ir-planes/adrs/0001-contract-planes.md`](../../../adrs/0001-contract-planes.md) Decisions 3 + 5. **Linear:** [TML-2584](https://linear.app/prisma-company/issue/TML-2584) (parent; no slice ticket).

## Why this dispatch exists

The artefact-review architect + principal-engineer passes (under `projects/contract-ir-planes/reviews/artifacts-pre-d3/`) surfaced four substrate-altitude concerns:

- **A03** — the `EntityCoordinate` is plane-blind, but the project's claim is "every IR consumer addresses entities by this coordinate"; for that to be truthful when domain-side walks land (S1.C), the coord needs a `plane: 'domain' | 'storage'` axis.
- **A05 / A07 / A08 / F09** — planning-artefact text corrections (already landed by the orchestrator pre-dispatch).

D4 lands the A03 code change. The text edits are already on disk; this brief lists them for completeness only (no implementer action there).

## Settled decisions (don't re-question)

1. **Coordinate shape.** `EntityCoordinate = { plane: 'domain' | 'storage'; namespaceId: string; entityKind: string; entityName: string }`.
2. **Walk's plane binding.** `elementCoordinates(storage)` yields coordinates with `plane: 'storage'` (the input parameter's type binds the plane). A sibling `elementCoordinates(domain)` is **not** added in this dispatch — domain-plane content is populated by S1.C; the sibling walk lands then.
3. **Directional reference invariant.** Domain → storage is allowed; storage → domain is forbidden. The invariant is encoded as a separate validator (future), **not** as a constraint on the coord shape. The coord carries the *axis* the validator checks.
4. **Insertion-order iteration unchanged.** D4 does not change the iteration order of `Object.entries` over namespace properties; it only adds a constant field to each yielded coord. (See PE pass F04 — out of scope for D4; addressed by a separate JSDoc clause in D4's `EntityCoordinate` documentation.)
5. **No cast added at consumer sites.** Zero consumers of `EntityCoordinate` exist today (PE pass verified — F02 / PDoD6). Type extension is type-additive on the producer side. If a consumer somehow exists by dispatch start, surface and re-decompose.

## Files in play

Exactly five files. If anything else changes, halt and escalate.

1. **`packages/1-framework/1-core/framework-components/src/ir/storage.ts`**
   - Extend `EntityCoordinate` interface with `readonly plane: 'domain' | 'storage'` as the **first** field.
   - In `elementCoordinates(storage)`, every `yield` populates `plane: 'storage'` alongside the existing fields.
   - JSDoc on `EntityCoordinate` explains: (a) the `plane` axis values; (b) sibling `elementCoordinates(domain)` is a future addition (S1.C populates domain content; the sibling walk lands there); (c) the domain → storage directional reference invariant is enforced by a separate validator, not by the coordinate shape; (d) iteration order over namespace properties is `Object.entries`-order (consumers that depend on ordering must sort).
   - JSDoc on `elementCoordinates` mentions the `plane: 'storage'` constant for this overload.

2. **`packages/1-framework/1-core/framework-components/src/exports/ir.ts`**
   - No API change; verify the `EntityCoordinate` type re-export still names the same symbol. Touch only if a re-export hint requires regeneration.

3. **`packages/1-framework/1-core/framework-components/test/element-coordinates.test.ts`**
   - New test file (or extend if one exists — check via `rg --files packages/1-framework/1-core/framework-components/test` first). Three test cases in one file:
     - **SQL namespace concretion** (`SqlNamespacePayload` instance via `SqlStorage` constructor) — assert at least one coordinate yielded; assert every yielded coordinate has `plane === 'storage'`.
     - **Mongo namespace concretion** (`MongoNamespacePayload` via `MongoStorage`) — symmetric.
     - **Postgres-promoted namespace** (`PostgresSchema` instance via `PostgresContractSerializer` deserialize path or direct construction) — symmetric; specifically covers the `kind === 'schema'` case that D3's structural walk made walkable. Assert `plane === 'storage'`.
   - Each case should also sanity-check `namespaceId`, `entityKind`, and `entityName` are non-empty strings on the yielded tuples (regression guard for the structural walk).

4. **`packages/2-sql/9-family/test/...`** (if any test fixture or helper consumes `EntityCoordinate`)
   - Grep `rg "EntityCoordinate" packages/2-sql/` before touching. Most likely zero hits. If any, the type addition is structurally additive (extra field; existing code that doesn't read `plane` keeps compiling).

5. **`packages/2-mongo-family/9-family/test/...`** (symmetric to file 4)
   - Same grep, same expectation.

**Pre-dispatch grep gate (run first; refuse to proceed if surface is larger than the brief expects):**

```bash
rg --type ts "EntityCoordinate" packages/ | wc -l   # expect: ~3-5 hits (storage.ts + exports/ir.ts + test files; nothing in 2-sql, 2-mongo, or 3-targets)
rg --type ts "elementCoordinates" packages/ | wc -l # expect: ~3 hits (storage.ts + exports/ir.ts + any test)
```

If `EntityCoordinate` returns > 8 hits or any hit appears in `packages/2-sql/` / `packages/2-mongo-family/` / `packages/3-targets/` non-test source, HALT — the type has consumers the brief didn't account for; surface to orchestrator before continuing.

## Done when

- [ ] `pnpm typecheck` clean — type extension is purely additive on the producer side
- [ ] `pnpm test:packages` green — new walk test passes for SQL, Mongo, Postgres concretions; pre-existing element-coordinate tests still pass
- [ ] `pnpm lint:deps` clean — no layering shift
- [ ] `pnpm fixtures:check` clean — no on-disk shape change
- [ ] `rg "EntityCoordinate" packages/` enumerated; results match pre-dispatch expectation (no hidden consumers)
- [ ] Walk test covers all three namespace concretions in one test file; each asserts `plane === 'storage'`
- [ ] JSDoc on `EntityCoordinate` includes the four points named in file 1 above (plane axis values; future domain walk; directional-reference invariant; iteration order)

## Scope guardrails (refusal triggers)

If ANY of these apply, halt and escalate to orchestrator:

- The diff renames any of `tables`, `types`, `collections` (A01 — deferred to standalone ticket).
- The diff lifts entity maps under a new `.entries` property on any namespace concretion class (A02(b) — deferred to standalone ticket).
- The diff modifies more than the 5 files listed above (excepting the optional 4 and 5 if their grep returns zero hits).
- The diff modifies any on-disk `contract.json` or `contract.d.ts` file (no on-disk shape change in D4).
- `pnpm fixtures:check` reports any drift.
- `rg "EntityCoordinate" packages/` returns hits in non-test source under `packages/2-sql/`, `packages/2-mongo-family/`, or `packages/3-targets/` — surface; the brief assumed zero.

## Pre-flight reading

Read before starting:

1. [`projects/contract-ir-planes/slices/substrate/plan.md`](../plan.md) § Dispatch 4 (full).
2. [`projects/contract-ir-planes/adrs/0001-contract-planes.md`](../../../adrs/0001-contract-planes.md) Decisions 3 + 5 (the plane-axis rationale and the slot-key naming convention you're enforcing absence of slippage on).
3. [`packages/1-framework/1-core/framework-components/src/ir/storage.ts`](../../../../../packages/1-framework/1-core/framework-components/src/ir/storage.ts) (current state, post-D3).
4. [`drive/calibration/failure-modes.md`](../../../../../drive/calibration/failure-modes.md) F5 entry (destructive git ops forbidden without orchestrator approval).

Optional context (skim only if a question arises):

- [`projects/contract-ir-planes/reviews/artifacts-pre-d3/system-design-review.md`](../../../reviews/artifacts-pre-d3/system-design-review.md) finding A03 (the architect's framing of why this axis matters).
- [`projects/contract-ir-planes/reviews/artifacts-pre-d3/code-review.md`](../../../reviews/artifacts-pre-d3/code-review.md) findings F02 (the load-bearing walk-test requirement) and F04 (iteration-order JSDoc clause).

## Commit hygiene

- One commit per logical step. Suggested split: `(a)` extend type + walk + JSDoc; `(b)` add test for three concretions; `(c)` any test-helper / export touch-ups.
- Commit messages reference the slice + the dispatch + the architect/PE finding ID: `S1.A D4: extend EntityCoordinate with plane axis (A03) ...`.
- Sign all commits with `-s` per branch convention.
- Push to `tml-2584-s1a-substrate` after the gate set passes locally.

## Out of scope (explicitly deferred)

- A01 substrate rename (`tables` → `table`, etc.) — [TML-2634](https://linear.app/prisma-company/issue/TML-2634), `relatedTo: ['TML-2584']`. Filed by orchestrator pre-dispatch.
- A02(b) namespace `.entries` redirect — [TML-2636](https://linear.app/prisma-company/issue/TML-2636), `relatedTo: ['TML-2584']`. Filed by orchestrator pre-dispatch.
- A11 / F01 cleanup (D3's `'postgres-enum'` literal in family-base) — addressed by S1.B per project plan PDoD3.
- A06 (umbrella PDoD5 intermediate-merge windows) — umbrella-altitude concern; not addressed at this slice.
- A09 (free-function-over-structural-shape pattern catalogue entry) — project close-out per PDoD9.
- A10 (`Namespace.kind` brand set unbounded) — non-load-bearing; flagged for a future architect pass when a second walk consumer needs to dispatch on brand.

## Model tier note

Composer-2.5 (`composer-2.5-fast`). The bounded brief above is exactly the substrate Composer-2.5 calibration recommends — small, strict, no design judgment, no creativity at the dispatch boundary. If you find yourself needing to make a design call, halt and surface — the design is settled by the spec / plan / ADR. The implementer's job is type-mechanical execution + test authoring against the test plan above.
