# Slice: graph-render redesign — back-arc convergence + configurable geometry

_Parent project `projects/migration-graph-rendering/`. Outcome: rollback back-arcs to the same target collapse into one shared lane (narrower, truer output), and the layout/render geometry (columns-per-lane etc.) becomes configurable constants rather than hard-coded values._

> **Design-of-record:** [`../../design/graph-render-redesign.md`](../../design/graph-render-redesign.md). Execution only. **Builds on** `render-redesign-core` (the line/plane/occlusion pipeline must exist first — convergence is a layout-routing change expressed in the new model).

## At a glance

Two enhancements on top of the correct pipeline: (1) **back-arc convergence** — back-arcs that land on the same target node share a single back-lane (sources tee in, one landing) instead of one lane each, which narrows the graph and removes crossings; (2) **configurable geometry** — extract the hard-coded spacing/columns-per-lane values into named parameters so the layout's density can change without rewriting the renderer.

## Chosen design

Per the design doc (§ Planes → convergence, § Geometry is configurable). In scope:
- **Convergence:** group back-arcs by target node; route one shared upper-plane back-lane per target, with each source teeing into it and a single landing at the target. (See the design doc's worked before/after — three `rollback_to_users_*` arcs → one lane.)
- **Configurable geometry:** identify every hard-coded geometry constant across the layout + renderer (columns-per-lane, gutter widths, label gaps, hash-column width, etc.), lift them into a single named-constants surface (or an options object) consumed by both phases. Changing "3 columns per lane" must be a one-line config change with no renderer edits.
- **Out:** the core data model / occlusion (that's `render-redesign-core`); any colour-semantics change.

## Coherence rationale

Both are layout-side parameterisations of an already-correct pipeline — convergence changes *which lane* a back-arc occupies; the geometry work changes *how wide* lanes are. One reviewer holds "the layout is now configurable and converges back-arcs"; the test suite proves the rendered output matches the converged + parameterised expectation.

## Test-first discipline

Author tests before implementation, red-first:
1. **Convergence tests** — a fixture with ≥2 back-arcs to one target asserts they share one back-lane (column count drops vs the per-arc layout; the rendered graph matches the design doc's converged example), and crossings reduce accordingly.
2. **Geometry-parameter tests** — render the same fixture at, e.g., 2 vs 3 columns-per-lane and assert the output scales as expected with **no** code change beyond the constant; assert the default produces today's spacing (no unintended visual change).

## Slice-specific done conditions

- [ ] Back-arcs to a shared target render as one lane; a multi-rollback fixture's width shrinks to the converged form and matches the design doc's example.
- [ ] Every geometry constant is a named parameter; a test flips columns-per-lane and the output scales with no renderer change; the default keeps existing output byte-identical.
- [ ] No regression to colour-correctness from `render-redesign-core` (the colour matrix stays green).

## Open Questions

1. Default columns-per-lane and the full set of geometry parameters to expose (design doc § Open questions). Working position: enumerate during build from the current hard-coded sites; default to today's values.

## References

- Design: [`../../design/graph-render-redesign.md`](../../design/graph-render-redesign.md)
- Prerequisite slice: `../render-redesign-core/`
