# Slice spec — `migration list --graph` review follow-ups (TML-2733)

Batches the open review findings from PR #628 (the merged `migration list --graph`
annotated-tree work, TML-2702) into one PR. Inputs are the two review artifacts at
[`../../reviews/pr-628/system-design-review.md`](../../reviews/pr-628/system-design-review.md)
and [`../../reviews/pr-628/code-review.md`](../../reviews/pr-628/code-review.md).

This is an **in-project slice** of the `migration-list-graph` project. It changes no
user-facing behaviour except one intended fix (`--ascii` now governs the flat list)
and one presentation-policy unification (kind-glyph intensity). No contract / `--json`
change.

## Operator decisions (load-bearing)

- **A — layout placement:** move the lane-allocator/layout module out of
  `migration-tools` and into the CLI formatter, per the settled design. Topology
  stays in `migration-tools`.
- **C — classifier "reuse" docs:** the tolerant classifier does **not** reuse
  `MigrationGraph` / `detectCycles`; it re-implements the adjacency + 3-colour DFS.
  Correct the docs to say so. Do **not** refactor to share the DFS (deliberately
  out of scope — tolerance vs. strictness justifies the second pass).
- **F01 — unplaceable forward edge:** implement the design's rule-5 degrade (an
  unplaceable forward edge renders **unwoven**) and add a fixture that exercises
  producer-sorts-above-consumer order. Do it properly rather than weakening the
  contract.

All other findings are taken at the implementer's discretion ("do the work
properly") and are specified below.

## Scope (In)

System-design (architect) findings:

- **A** Move `migration-list-graph-layout.ts` (+ its test) from
  `packages/1-framework/3-tooling/migration/` to the CLI
  `.../cli/src/utils/formatters/`. Remove the `exports/migration-list-graph-layout.ts`
  wrapper, its `package.json` subpath export, and its `tsdown.config.ts` entry.
  Repoint `migration-list-graph-render.ts` to a local import. The moved module
  keeps importing topology types from `@prisma-next/migration-tools/...` (CLI →
  migration-tools is a sound downward import).
- **B** Relocate `GlyphMode` / `GlyphModeInput` / `detectGlyphMode` out of
  `migration-list-graph-render.ts` into `terminal-ui.ts` (or a small sibling
  `glyph-mode.ts` that `terminal-ui` owns), so the renderer imports the capability
  rather than `terminal-ui` importing *up* into a formatter.
- **C** Docs-only: correct `spec.md` / `design-notes.md` / `plan.md` wording that
  claims the tolerant classifier "reuses" `MigrationGraph` / "mirrors `detectCycles`"
  — state that it re-implements an independent tolerant adjacency + DFS, and why
  (never-throw / no-genesis), without claiming code reuse.
- **D** Single source of truth for the Unicode kind-glyph table
  (`{ forward, rollback, self }`). One home (alongside `MigrationEdgeKind` or in the
  shared `migration-list-data-column` module both renderers import); both renderers
  consume it.
- **E** Thread glyph mode into the flat renderer so `--ascii` / `detectGlyphMode`
  governs the flat list too (spec already promises this). The kind glyph is realized
  by one mode-aware source across both views.
- **N1** Rename `MigrationGraphTopology` → `MigrationListGraphTopology` (symmetry
  with `MigrationListGraphLayout` and its file/producer; avoids reading as the
  strict `MigrationGraph`'s topology). Update all consumers.
- **N2** Rename the `ConnectorKind` member `joinBelow` → `joinAbove` so the names
  are node-relative and match the design vocabulary ("join above / fan below").
- **N3** Rename `EdgeKind` → `MigrationEdgeKind` (parallels `MigrationEdge`,
  unambiguous at the package export surface). Layout row-model union names stay as
  they are once the module is CLI-local.

Code-review (principal-engineer) findings:

- **F01** Implement rule-5 unwoven degrade for an unplaceable forward edge + fixture
  (producer sorts lexically above its consumer). See operator decision.
- **F02** Make the pure-cycle DFS seeding lexical **per component** (sort the still-
  WHITE remainder before the second seeding pass) so a graph with both a rooted
  component and a disjoint pure cycle seeds the cycle's back-edge lexically, as
  documented. Add a topology test (rooted component + disjoint 2-node cycle).
- **F03** Add a multi-space command/render test where one contract hash plays
  different topological roles across two spaces, locking per-space classification.
- **F04** Unify kind-glyph intensity across both views: **bright in both** (the kind
  glyph is the signal; matches the tuned graph aesthetic where lanes dim and glyphs
  stay bright). Route through the styler uniformly; add a one-line comment at the
  policy site.
- **F05** Right-trim each rendered graph line before joining; re-baseline affected
  goldens.
- **F06** Readability: give `migrationEntries`' accumulator an explicit
  `MigrationListEntry[]` type (kill the evolving-any); collapse `assignProducerLane`
  to the direct `Map.get`; inline the identity `canonicalTo`.

Where it falls out cleanly from A+E, restructure the handoff so the command computes
topology once and passes `kindByMigrationHash` into the renderer (renderer stops
calling `classifyMigrationListGraphTopology` itself). If it would balloon the diff,
leave it and note it; not a hard requirement of this slice.

## Scope (Out)

- Sharing the 3-colour DFS between `detectCycles` and the tolerant classifier
  (operator decision C: docs only).
- East-Asian Ambiguous-width (`↩`/`⟲`) alignment — spec-accepted, no behavioural fix.
- DB-marker overlay glyph / full back-edge arc drawing — tier-3 deferred.
- O(N²) lane scans — acceptable at CLI scale.
- Any `--json` / contract change.

## Done conditions (slice DoD)

- All In-scope findings addressed; review artifacts' finding table reconcilable to
  "fixed / docs-corrected / deliberately-deferred".
- `pnpm build`, `pnpm typecheck`, `pnpm lint:deps`, biome, and the migration +
  cli test suites green (modulo the pre-existing `version` /
  `removed-verb-redirects` spawn-timeout flakes noted in the code review).
- New tests exist for F01 (unwoven degrade), F02 (disjoint-cycle seeding), F03
  (per-space role discrimination), and E (flat-list ASCII).
- Renames complete with no dangling old names (`MigrationGraphTopology`, `EdgeKind`,
  `joinBelow`) outside history.
- Docs corrected for C; no remaining "reuse"/"mirrors detectCycles" claims.
- One PR, titled with the TML-2733 prefix.
