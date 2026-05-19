# Project Spec — Target-contributed top-level PSL blocks (PR3 of the target-extensible-ir series)

## Summary

Lift the framework PSL parser from "hardcoded for a small set of top-level keywords" to "extensible via target-pack contributions". Migrate `enum` from framework-parser to Postgres-pack contribution as the load-bearing proof-of-concept. Closes the substrate gap that downstream work (RLS, roles, custom Postgres-domain types) hits the moment it tries to ship target-specific top-level PSL syntax.

This project is **PR3 of the target-extensible-ir series.** PR1 delivered the polymorphic IR + the *semantic-lowering* extensibility (the M3.5 `entityTypes` mechanism — target packs contribute factories that lower already-parsed AST nodes to IR-class instances). PR2 (TML-2520) delivered the namespace exemplar without depending on this work, because `namespace { … }` is a framework concept that every multi-storage target needs and was therefore acceptable as a framework-parsed top-level keyword. PR3 closes the remaining gap: the *parsing-layer* extensibility that PR1 should have shipped.

## Linear

- **Originating ticket:** [TML-2537 — PR3 — Target-contributed top-level PSL blocks + migrate `enum`](https://linear.app/prisma-company/issue/TML-2537) (blocked by TML-2520).
- **Linear project:** [Target-Extensible IR + Namespaces](https://linear.app/prisma-company/issue/TML-2459) (same project as TML-2459 and TML-2520; this is the third PR in the series).

## Why now

Three downstream projects are blocked or compromised by the absence of target-contributed top-level PSL blocks:

1. **Postgres RLS (`projects/postgres-rls/`)** wants `policy { … }` blocks in PSL. Without the registry, this either requires editing the framework parser (which leaves SQLite + Mongo carrying parser surface they can never use) or being authored only via the TS builder (which breaks the framework's "PSL and TS are structurally parallel" promise).
2. **Postgres roles / privileges** (post-RLS) wants `role { … }` blocks for the same reasons.
3. **Postgres-specific entity types** (domains, custom operators, possibly future native composite-type DDL) — same shape.

Each of these will hit this gap on its first PR. Shipping the registry now means downstream work lands as focused feature PRs rather than each one re-litigating the substrate question.

The `enum` migration also has standalone value beyond serving as the proof-of-concept: today the framework parser knows about `enum { … }` even for SQLite + Mongo targets where the keyword is effectively Postgres-flavoured. SQLite has no native enum type; Mongo has no schema-level enum concept. Pushing `enum` to a Postgres-pack contribution moves the parser regex out of the framework layer where it doesn't structurally belong.

## Context from prior discussions (preserved for posterity)

The decision to defer this work to a follow-up project was made during the PR2 design discussion. Original user framing (Saturday May 16, 2026, 4:25 PM UTC+2):

> "[The framework parser hole] is a massive hole that the first PR was supposed to cover. Everything downstream of this project relies on being able to register new PSL block types: RLS, roles, etc. However, namespace is genuinely a framework-level concept that deserves representation in PSL, but whether it is permitted in a particular target depends on the target. I suppose that can be modeled with validation, and for now we gloss over it by making the PSL parser accept namespace declarations, no matter the target. This is not a target-contributed concept in the PSL parser, but an interpreter of the story. We will need an additional task in this project to add the target-contributed Postgres block feature and migrate enum support to it."

Original sequencing (proposed during PR2 design):

1. **PR1 (merged)** — Target-extensible IR + namespace foundation.
2. **PR2 (TML-2520, in flight)** — Namespace exemplar + cross-namespace FK references.
3. **PR3 (this project)** — Target-contributed PSL block registry; migrate `enum`.
4. **PR4 (DROPPED)** — Originally proposed: migrate `namespace { … }` from framework-parsed to pack-contributed. Dropped because `namespace` is a framework concept that every multi-storage target needs; pushing it to packs gains no semantic clarity and costs the framework's "namespace is a primitive" stance. Per-target *semantic interpretation* of namespace blocks (which targets reject explicit blocks, which targets reserve `unbound`, etc.) is already handled by per-family interpreters per PR2's FR16c — no parser-level pushdown is necessary.

Decision recorded in `projects/target-extensible-ir/spec.md` Non-goals and `plan.md` "PR2 forward concerns".

## Architectural setting

Two extensibility mechanisms exist in tree today; this project adds the third:

| Layer | Mechanism today | Status |
|---|---|---|
| **IR (Contract IR + Schema IR)** | 3-layer polymorphic class hierarchy (framework interface → family abstract base → target concrete class) | PR1 shipped |
| **Semantic lowering (PSL AST → IR)** | M3.5 `entityTypes` contribution mechanism (target packs ship factories keyed by `kind` discriminator) | PR1 shipped |
| **PSL parsing (source text → AST)** | Framework-parser hardcoded; no extension surface | **This project ships** |

The parsing-layer extension is structurally parallel to the M3.5 mechanism but operates at a different layer: M3.5 lets a pack contribute the *factory that constructs the IR-class instance from an already-parsed AST node*; this project lets a pack contribute the *parser function that recognises a new top-level keyword and produces the AST node in the first place*.

## Functional requirements

### Parser registry

- **FR1.** Target packs (or any pack participating in `AuthoringContributions`) can contribute new top-level PSL block parsers via a new `pslBlocks` namespace on the contribution surface — structurally parallel to today's `entityTypes`. Each contribution declares: the keyword (`policy`, `role`, `enum`, …), a parser function (consumes the token stream + a block scope, produces an AST node), and the AST node's `kind` discriminator (matches the corresponding `entityTypes` factory's `discriminator` field so the existing lowering registry routes the parsed AST node through the right factory).

- **FR2.** The framework parser's top-level dispatch is extended with a registry lookup: when the parser encounters an unknown top-level identifier, it consults the registered `pslBlocks` keywords before failing. Built-in keywords (`model`, `type`, `types`, `namespace`) continue to be framework-parsed directly — the registry is purely additive at the front of the dispatch.

- **FR3.** Pack-contributed PSL block keywords are **target-scoped**: a contract authored for the SQLite target does not see Postgres-pack-contributed keywords. The framework parser is constructed per-contract with the resolved `AuthoringContributions` for that contract's target + extension packs; only keywords contributed by packs in scope are accepted. Out-of-scope keywords surface the same "unknown top-level identifier" diagnostic they surface today — a contract that uses `policy` on a SQLite target gets a clear "this target does not contribute the `policy` block" error pointing at the keyword span.

- **FR4.** Contributed parser functions follow a small framework SPI: they receive a parser-context handle (the current token cursor, the diagnostic sink, helpers for parsing common sub-shapes like field lists / attribute lists / brace-delimited bodies) and return either an AST node (consumed by downstream consumers) or a diagnostic (recorded in the parser's diagnostic stream). The contributed parser does not own diagnostic formatting or recovery logic — those live in the framework parser.

### `enum` migration (proof-of-concept)

- **FR5.** `enum { … }` parsing moves from the framework parser to the Postgres pack's `pslBlocks` contribution. The Postgres pack contributes both the parser function (the existing framework-level `parseEnumBlock` logic, lifted to a pack-contributed function) and the `entityTypes.enum` factory (already shipped by M4 / M7 — unchanged). The framework parser no longer knows the `enum` keyword.

- **FR6.** SQLite and Mongo contracts that use the `enum` keyword surface the same "unknown top-level identifier" diagnostic they would get for `policy` or `role` on those targets. The diagnostic names the target and points at the keyword span. (Today's behaviour: SQLite + Mongo *do* accept `enum` blocks at parse time but emit lowering-time diagnostics because no `entityTypes.enum` factory exists for those targets — a worse failure mode than parse-time rejection. The migration improves SQLite/Mongo UX.)

- **FR7.** Postgres contracts continue to parse `enum { … }` blocks identically to today — same syntax, same AST shape, same lowering behaviour. The migration is transparent to Postgres users and to any contracts authored against any extension pack that contributes `entityTypes.enum` (none today besides Postgres, but the migration preserves the surface for future packs that might).

### Interaction with the M3.5 mechanism

- **FR8.** Pack-contributed PSL blocks and pack-contributed `entityTypes` use the **same `discriminator` field** to route AST nodes through the lowering registry. The `pslBlocks` contribution names the discriminator on its AST node; the `entityTypes` contribution names the discriminator on its factory. The framework parser tags each parsed AST node with its discriminator; the family-layer interpreter dispatches through the existing registry built from `entityTypes` contributions. No new lowering surface is introduced — only the parsing-layer entry point is new.

- **FR9.** A pack that contributes a top-level PSL block (`pslBlocks`) must also contribute the corresponding `entityTypes` factory with matching `discriminator` (otherwise the parse succeeds but the lowering errors with "no factory registered for discriminator X"). Framework-level validation surfaces this as a pack-load-time diagnostic, not a per-contract runtime error.

### Out-of-scope namespace migration (decision record)

- **FR10.** **The `namespace { … }` block stays framework-parsed.** Even after this project lands, `namespace` is not pushed to a pack contribution. Rationale: `namespace` is a primitive every multi-storage target needs; per-target *semantic interpretation* (which targets reject explicit blocks, which targets reserve `unbound`, etc.) is sufficient and is already handled by per-family interpreters per the target-extensible-ir project's FR16c. Pushing the parser to packs would add complexity (every target ships the same `namespace` block parser) without buying semantic clarity. This is a deliberate decision and any future proposal to revisit it must justify the symmetry cost.

## Acceptance criteria

- [ ] **AC1.** `AuthoringContributions` exposes a new `pslBlocks` namespace structurally parallel to `entityTypes`. Type-system surface is end-to-end-strong: a pack's contributed parser's return type narrows to the AST node shape its factory consumes.

- [ ] **AC2.** The framework parser's top-level dispatch consults the `pslBlocks` registry for unknown identifiers. A pack-contributed parser that produces an AST node with discriminator `X` and an `entityTypes` factory with discriminator `X` end-to-end-round-trips through parse → lower → IR-class instance → serialize → hydrate → IR-class instance.

- [ ] **AC3.** A Postgres contract using `enum { … }` parses, lowers, emits, and verifies identically to today. No user-visible change for Postgres users. (Verified by the existing enum test suite continuing to pass against the post-migration substrate.)

- [ ] **AC4.** A SQLite contract using `enum { … }` surfaces a parse-time "unknown top-level identifier `enum`; this target does not contribute the keyword" diagnostic pointing at the keyword span. Same for Mongo.

- [ ] **AC5.** A synthetic "fake-target" test that contributes a `pslBlocks.demoBlock` parser + `entityTypes.demoBlock` factory demonstrates the registry mechanism end-to-end. The fake-target test does not depend on Postgres-specific surface; it exercises only the framework SPI.

- [ ] **AC6.** Framework parser test coverage: (a) registered keyword parses correctly; (b) unregistered keyword surfaces the expected diagnostic; (c) pack-load-time validation surfaces a clear error when a `pslBlocks` contribution has no matching `entityTypes` factory.

- [ ] **AC7.** The framework parser no longer imports `enum`-specific parsing code. The `enum` keyword does not appear in framework-parser source files. (Verified by an `rg` gate.)

- [ ] **AC8.** Architecture documentation captures the parsing-layer extensibility mechanism alongside the existing M3.5 semantic-lowering mechanism. ADR or docs/architecture-docs entry that names the three extension layers (IR, semantic lowering, parsing) and the discriminator convention that ties parsing to lowering.

## Non-goals

- **Multi-keyword / compound top-level block grammars.** A pack-contributed block parser handles one top-level keyword. Compound shapes like `if X then Y else Z` at the top level (not a real example, just illustrating) are not in scope; existing block parsers handle bodies of arbitrary complexity via the same helpers framework block parsers use.

- **Custom attribute parsers.** This project covers top-level *blocks* only — pack-contributed field/model attributes (`@policy(...)`, `@auth(...)`) follow a different extension shape and are out of scope. Tracked separately.

- **Pluggable expression grammar.** PSL's expression grammar (used in attribute arguments, default values, etc.) stays framework-owned. Adding expression-grammar extension points is a much larger design question; out of scope.

- **Migrating `namespace` to pack-contributed.** Per FR10 — deliberate decision, not deferred. The `namespace { … }` block is a framework primitive.

- **Migrating `model`, `type`, `types` to pack-contributed.** Same rationale as `namespace` — these are framework primitives every target needs. Not migrated, not deferred.

- **Backwards compatibility for non-Postgres contracts that currently use `enum`.** Per FR6, the SQLite/Mongo migration is a clean break — those contracts currently fail at lowering time with a worse diagnostic; the migration moves the failure to parse time with a clearer diagnostic. No deprecation window; no compatibility shim. Anyone affected can either move to Postgres (where `enum` works) or use the equivalent column-level constraint shape their target supports.

## Dependencies

- **Blocked by:** PR2 (TML-2520) merging. Rationale: PR2 ships substantial PSL parser changes (the `namespace { … }` block + the dot-qualified-type-fallback regex + the Reading D collapse of `PslDocumentAst.models` into `PslDocumentAst.namespaces`). Landing PR3 against an unmerged PR2 would force PR3 to re-derive its understanding of the parser's current shape mid-flight. PR3 starts after PR2 merges to main; no parallel-track.

- **Blocks (post-this-project):**
  - **Postgres RLS** (`projects/postgres-rls/`) — wants `policy { … }` blocks. The `policy` block is the first real downstream consumer of the registry mechanism beyond the enum proof-of-concept.
  - **Postgres roles** (post-RLS) — wants `role { … }` blocks.
  - **Postgres-specific entity types** (domains, etc.) — uses the same mechanism.

## Open questions

These are flagged for the implementer to resolve during pre-implementation reconnaissance (or to surface back to the project owner if architectural):

1. **Parser SPI shape.** How much of the framework parser's helper surface (token cursor, diagnostic sink, common sub-shape parsers like field lists / attribute lists / brace-delimited bodies) does a pack-contributed parser need access to? Likely answer: enough to make the `enum` migration mechanical (the existing `parseEnumBlock` lifts directly), no more. The SPI shape is a load-bearing design choice — too narrow and packs reimplement parsing primitives; too wide and the parser internals become framework SPI.

2. **Registry construction timing.** When is the `pslBlocks` registry built — at descriptor-build time (parallel to the `entityTypes` registry, FR8e of target-extensible-ir) or at parse-call time? Likely answer: descriptor-build time, mirroring the lowering registry. This keeps the parser construction zero-overhead per-contract once the descriptor is built.

3. **Multi-pack contributions.** If two packs contribute the same keyword, what happens? Likely answer: a pack-load-time validation error naming both packs (mirroring the existing duplicate-`entityTypes` check). No silent precedence rules.

4. **Documentation surface.** Should the contributed parsers self-document via JSDoc / structured metadata so a downstream "generate PSL grammar reference" tool can consume them? Likely answer: yes, but not in this project's scope — flag for a future docs-tooling project.

## Risk register

- **R1. Mechanical-rename scope.** The enum migration touches Postgres enum test fixtures + the framework parser's enum tests + the SQLite/Mongo "enum is unsupported" diagnostic test sites. Estimated mid-double-digit file count. The PR2 R1 experience (32 fixture files regenerated for one IR constant rename) is instructive: the implementer should pre-flight the fixture surface before committing to a single-commit migration.
- **R2. Parser SPI shape mismatch.** If the parser SPI is too narrow, the contributed `enum` parser re-implements primitives the framework parser already has, and the resulting pack-side parser is harder to maintain than the original framework-side code. Mitigation: the implementer's first round should be a thin-vertical-slice spike — lift `enum` to a pack contribution with the SPI shape the lift naturally suggests, and let RLS / roles surface any SPI gaps when they consume it next. Don't over-design the SPI for hypothetical future consumers.
- **R3. SQLite/Mongo UX regression for users who currently get a lowering-time enum diagnostic.** Today they get "no factory registered for kind `sql-enum-type`" or similar — bad UX but a known surface. After this project ships, they get "unknown top-level identifier `enum`; this target does not contribute the keyword" — better, but the diagnostic text needs to clearly direct the user to the right action (use a different column type, or switch to Postgres). Mitigation: the diagnostic copy gets a docs link to the target's "what's supported" reference.
- **R4. Tooling that walks the framework parser's known-keyword set may break.** Mitigation: surface as part of the pre-implementation reconnaissance (PR2's M5a R2 audit is a good template) — enumerate consumers of the framework parser's keyword set and check they tolerate the migration.

## Relationship to ADR 211 (target-extensible IR) and the M3.5 ADR

This project closes a gap that those two ADRs implicitly assumed away: that pack contributions reach the system *only after parsing*. The reality is that some contributions (like `enum`, like future `policy` / `role`) need to participate at the parsing layer too. The ADR layer this project drafts (per AC8) names the three extension layers explicitly:

1. **IR layer** — 3-layer polymorphic class hierarchy (ADR 211).
2. **Semantic lowering layer** — M3.5 `entityTypes` mechanism + registry-driven hydration.
3. **Parsing layer** — `pslBlocks` mechanism + discriminator-tied dispatch (this project).

Each layer is independently extensible by a pack; the discriminator (`kind` field on the AST node = `discriminator` field on the `entityTypes` factory = `discriminator` field on the `pslBlocks` contribution) is the load-bearing convention that ties them together.
