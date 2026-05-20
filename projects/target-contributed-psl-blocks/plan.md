# Project Plan — Target-contributed top-level PSL blocks

## Summary

Three milestones sequenced **mechanism → exemplar → docs**. M1 ships the framework SPI surface (`pslBlocks` namespace on `AuthoringContributions`, framework-parser registry dispatch, pack-load-time validation). M2 migrates `enum` from framework-parser to Postgres-pack contribution as the load-bearing proof-of-concept. M3 lifts the ADR draft into durable docs and closes the project out.

The split between M1 and M2 is deliberate: M1 ships the mechanism behind a synthetic "fake-target" test (per AC5) so the SPI shape can be exercised + critiqued without the enum migration's fixture-regeneration cost. M2 lands the enum migration once the SPI is settled — the fixture cascade is then mechanical.

**Spec:** [`projects/target-contributed-psl-blocks/spec.md`](spec.md)
**Linear (PR umbrella):** [TML-2537 — PR3 — Target-contributed top-level PSL blocks + migrate `enum`](https://linear.app/prisma-company/issue/TML-2537) (blocked by TML-2520).
**Linear (project):** Same Linear project as [TML-2459](https://linear.app/prisma-company/issue/TML-2459) (Target-Extensible IR + Namespaces) — this is the third PR in the series.

## Cross-project dependencies

This project must land **after** the PR2 follow-up project (TML-2520) merges. PR2 ships substantial PSL parser changes (the `namespace { … }` block + the dotted-bare-type regex extension + the Reading D collapse of `PslDocumentAst.models` into `PslDocumentAst.namespaces`); attempting to land this project against an unmerged PR2 would force the implementer to re-derive the parser's current shape mid-flight.

Sequencing: TML-2459 (PR1, merged) → TML-2520 (PR2, in flight) → **this project (PR3)**.

Downstream projects that consume this project's mechanism:

- **Postgres RLS** (`projects/postgres-rls/`) — wants `policy { … }` blocks. First real downstream consumer of the registry beyond the enum proof-of-concept.
- **Postgres roles** (post-RLS) — wants `role { … }` blocks.
- **Postgres-specific entity types** (domains, custom operators) — uses the same mechanism.

## Milestones

### M1 — Framework SPI + registry dispatch + fake-target proof-of-concept

**Goal:** ship the framework SPI surface (`pslBlocks` namespace on `AuthoringContributions`, framework-parser registry dispatch, pack-load-time validation) behind a synthetic "fake-target" test that exercises the round-trip without depending on real-target fixture surface. The SPI shape is settled here, in a milestone scoped to the mechanism itself.

**Pre-implementation reconnaissance.** Before declaring task scope final, the implementer:

- Reads the framework parser's top-level dispatch (`packages/1-framework/2-authoring/psl-parser/src/parser.ts`) to identify the natural extension point for unknown-keyword dispatch.
- Reads the M3.5 `entityTypes` contribution shape (`packages/1-framework/1-core/framework-components/src/shared/framework-authoring.ts`) to inform the structurally-parallel `pslBlocks` shape.
- Enumerates the parser-helper surface (token cursor, diagnostic sink, common sub-shape parsers like field lists / attribute lists / brace-delimited bodies) — these are the candidates for the parser SPI.
- Lifts the existing `parseEnumBlock` into a standalone function as a thought experiment to surface the minimum SPI shape the lift needs.

The reconnaissance output is a short table in this section enumerating SPI candidates with "needed for enum lift" vs "speculative" columns; the speculative candidates get deferred unless RLS / roles surface them later.

**Tasks:**

- [ ] **Task 1 — Add `pslBlocks` namespace to `AuthoringContributions`.** Structurally parallel to today's `entityTypes`. Each contribution declares: keyword (`policy`, `role`, …), parser function (signature TBD per reconnaissance), AST node `kind` discriminator (matches the corresponding `entityTypes` factory's discriminator). End-to-end type narrowing: a pack's contributed parser's return type narrows to the AST node shape its factory consumes.
- [ ] **Task 2 — Framework parser registry dispatch.** Extend the parser's top-level dispatch to consult the `pslBlocks` registry on unknown identifiers before failing. Built-in keywords (`model`, `type`, `types`, `namespace`) stay framework-parsed; the registry is additive at the front of the dispatch. Registry is built at descriptor-build time (mirroring the lowering registry per the target-extensible-ir project's FR8e) so per-parse overhead is zero.
- [ ] **Task 3 — Pack-load-time validation.** Surface a clear error when a `pslBlocks` contribution has no matching `entityTypes` factory with the same discriminator. Same diagnostic shape as the existing duplicate-`entityTypes` check. The error names the contributing pack and the offending discriminator.
- [ ] **Task 4 — Parser SPI surface.** Extract the parser helpers the SPI needs (per reconnaissance) into a stable framework module. Helpers stay framework-owned; pack-contributed parsers consume them via a parser-context handle. The contributed parser does not own diagnostic formatting or recovery logic.
- [ ] **Task 5 — Fake-target round-trip test.** Synthetic test (AC5) that contributes a `pslBlocks.demoBlock` parser + matching `entityTypes.demoBlock` factory; exercises parse → lower → IR-class instance → serialize → hydrate → IR-class instance end-to-end. The test does not depend on Postgres-specific surface; it exercises only the framework SPI. Acts as the regression test for the mechanism going forward.
- [ ] **Task 6 — Parser test coverage for the registry.** Three cases per AC6: (a) registered keyword parses correctly; (b) unregistered keyword surfaces the "this target does not contribute the keyword" diagnostic pointing at the keyword span; (c) pack-load-time validation surfaces a clear error when discriminators mismatch. The diagnostic text names the target (per AC4 wording).

**Validation gate:**

```bash
pnpm typecheck
pnpm lint:deps
pnpm test:packages
```

`test:integration` is not required for M1 because no IR-shape changes land in this milestone — the fake-target test is package-scoped. The integration suite covers M2.

### M2 — `enum` migration to Postgres-pack contribution

**Goal:** lift `enum { … }` parsing from the framework parser to the Postgres pack's `pslBlocks` contribution. Validates the M1 mechanism against the load-bearing real case + improves SQLite/Mongo UX by moving the "this target does not support enum" failure from lowering time (today: bad diagnostic) to parse time (clear diagnostic).

**Pre-implementation reconnaissance.** Before committing to a single-commit migration, the implementer:

- Enumerates every fixture file containing `enum { … }` PSL or `kind: 'sql-enum-type'` IR-class JSON. The R1 experience of PR2 (32 fixture files regenerated for one IR constant rename) is the calibration point: assume the enum migration touches at minimum the Postgres enum exemplar tests, the SQLite/Mongo "enum is unsupported" diagnostic tests, and the integration / e2e tests that load contracts containing enums.
- Writes the inventory as a small audit (mirror of PR2's `m5a-consumer-audit.md`) before opening the migration commit.

**Tasks:**

- [ ] **Task 1 — Lift `parseEnumBlock` to a standalone function.** Today it lives in the framework parser. Move it (or its body) to a new module that can be imported by the Postgres pack's contributions. Adjust to consume the M1 parser SPI (token cursor, diagnostic sink, helpers) rather than framework-private internals.
- [ ] **Task 2 — Contribute `pslBlocks.enum` from the Postgres pack.** The Postgres pack ships both the parser (from Task 1) and the existing `entityTypes.enum` factory (unchanged — already contributed by M4 / M7 of the target-extensible-ir project). Both share the `'sql-enum-type'` discriminator. Pack-load-time validation passes.
- [ ] **Task 3 — Remove `enum` from the framework parser's top-level dispatch.** The framework parser no longer knows the `enum` keyword. (Verified by AC7's `rg` gate: no `enum`-specific parsing code in framework-parser source files.)
- [ ] **Task 4 — Update SQLite + Mongo diagnostic tests.** Today they assert lowering-time "no factory registered for kind `sql-enum-type`" or similar. Post-migration they assert parse-time "unknown top-level identifier `enum`; this target does not contribute the keyword". Update the test expectations + verify the new diagnostic copy is actionable (clear direction to either switch column types or switch targets).
- [ ] **Task 5 — Fixture regeneration cascade.** Run the pre-identified fixture-regeneration commands (`pnpm fixtures:emit`, extension `build:contract-space`, `UPDATE_*=1` env vars for affected test suites) and verify the resulting fixtures are semantically identical to pre-migration (the enum AST shape and IR class are unchanged; only the parser dispatch path differs). Land as a focused second commit per the PR2 R1 pattern (mechanical-rename commit + fixture-regen commit, keep the substantive change reviewable in isolation).
- [ ] **Task 6 — Integration / e2e gates.** Postgres enum-using contracts continue to parse, lower, emit, and verify identically. SQLite + Mongo contracts using `enum` surface the expected parse-time diagnostic.

**Validation gate:**

```bash
pnpm typecheck
pnpm lint:deps
pnpm test:packages
pnpm test:integration
pnpm test:e2e
```

`test:e2e` is required because the enum migration touches the Postgres enum exemplar's end-to-end coverage (the M4 enum exemplar from target-extensible-ir). The full gate is also load-bearing because the migration changes the parser entry point for a real keyword users author against — regressions surface only in the full cascade.

Per-round implementer commits also run `rg "parseEnumBlock|'enum'\s*[:=]" packages/1-framework/2-authoring/psl-parser/` after the migration lands to assert no surviving framework-parser references to the keyword (AC7's `rg` gate).

### M3 — Documentation + ADR + project close-out

**Goal:** lift the parsing-layer extensibility mechanism into durable docs alongside the existing IR convention and the M3.5 semantic-lowering ADR. Close out the project.

**Tasks:**

- [ ] **Task 1 — ADR.** Draft an ADR under `docs/architecture docs/adrs/` naming the three extension layers (IR, semantic lowering, parsing) and the discriminator convention that ties them together. The ADR references the M3.5 mechanism + this project's `pslBlocks` mechanism + the IR convention as a single coherent extensibility story. AC8 satisfied.
- [ ] **Task 2 — Subsystem docs.** Update the PSL Parser subsystem doc (if one exists; otherwise the Authoring subsystem doc) to describe the `pslBlocks` contribution path with a minimal example. Cite the discriminator convention.
- [ ] **Task 3 — `AGENTS.md` / `CLAUDE.md` Golden Rules update.** Add a line covering "PSL extension is pack-contributable via `pslBlocks`; framework-parsing covers only the framework-primitive set (`model`, `type`, `types`, `namespace`)."
- [ ] **Task 4 — Migration tools convenience (optional, surface-only).** If PR2's R1 experience surfaced a recurring need for a "recompute hand-authored migration hashes from current contract sources" tool (it did, per PR2's M5a R1 implementer report), document the gap as a follow-up ticket. Do not implement here — separable.
- [ ] **Task 5 — Project close-out.** Verify all AC clauses pass; delete `projects/target-contributed-psl-blocks/`; ensure no in-tree references to the project dir remain (per `.cursor/rules/doc-maintenance.mdc`).

**Validation:** ADR is reviewable as a markdown diff; the project dir is deleted; downstream projects (RLS, roles, custom Postgres types) reference the ADR and the merged docs as their substrate.

## Open items

- **Parser SPI shape decided during M1 reconnaissance — record as ADR addendum if non-trivial.** If the SPI extraction surfaces design choices worth pinning beyond "minimum to lift `enum`" (e.g. how diagnostic recovery works for pack-contributed parsers), the ADR draft should cover them rather than discovering them again when RLS lands.
- **Multi-pack contributions of the same keyword** (per spec's Open Question 3): the spec proposes pack-load-time validation rejecting duplicates. Confirm during M1 reconnaissance — does the M3.5 `entityTypes` mechanism handle the same case the same way? If yes, mirror; if not, surface to project owner.
- **Documentation-generation tooling** (per spec's Open Question 4): the contributed parser SPI may benefit from carrying structured metadata so a future "generate PSL grammar reference" tool can consume it. Out of this project's scope but worth a flag in the ADR.

## Risk register (echoed from spec for plan-side visibility)

- **R1 — fixture cascade scope (M2).** Mechanical-rename scope is the headline risk. Pre-flight the fixture surface before committing.
- **R2 — parser SPI shape mismatch (M1).** Resist over-designing for hypothetical future consumers. The "minimum to lift `enum`" shape is the right calibration; downstream consumers (RLS, roles) surface any SPI gaps as they consume the mechanism.
- **R3 — SQLite/Mongo diagnostic UX regression (M2).** Better than today but the diagnostic copy needs care. Include a docs link to "what's supported on this target" in the diagnostic text.
- **R4 — framework-parser keyword-set consumers (M2).** Mirror the PR2 M5a R2 audit pattern: enumerate consumers before committing.

## PR sequencing context

This project is **PR3 of the target-extensible-ir series**:

1. **PR1 (merged, `target-extensible-ir` branch)** — Polymorphic IR + entityTypes mechanism + Postgres enum exemplar + supporting docs.
2. **PR2 (in flight, TML-2520, `tml-2520-…` branch)** — Namespace exemplar + cross-namespace FK references + namespace ADRs.
3. **PR3 (this project)** — Target-contributed PSL block registry + `enum` migration to Postgres-pack contribution + parsing-layer extensibility ADR.

PR4 was **proposed and dropped** during PR2 design: migrate `namespace { … }` from framework-parsed to pack-contributed. Dropped because `namespace` is a framework primitive every multi-storage target needs; per-target *semantic interpretation* (handled by per-family interpreters per PR2's FR16c) is sufficient.

## Close-out checklist

- [ ] All ACs (AC1–AC8) PASS or have accepted-deferral records in the project's `reviews/code-review.md`.
- [ ] ADR promoted from `projects/target-contributed-psl-blocks/` (if drafted there during M3 R1) to `docs/architecture docs/adrs/`.
- [ ] Subsystem docs reference the ADR.
- [ ] Downstream projects (`projects/postgres-rls/`, eventual roles project, etc.) updated to cite this project's mechanism as their substrate.
- [ ] `projects/target-contributed-psl-blocks/` deleted.
- [ ] In-tree references to `projects/target-contributed-psl-blocks/**` scrubbed per `.cursor/rules/doc-maintenance.mdc`.
