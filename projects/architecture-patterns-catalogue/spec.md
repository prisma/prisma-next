# Summary

Prisma Next has accumulated a stable set of architectural patterns — the recurring shapes the codebase uses to solve cross-cutting structural problems. These patterns are captured today as one-off ADRs (ADR 195's frozen-class IR, ADR 192's JSON-canonical round-trip, ADR 185's SPI placement, ADR 005's thin-core/fat-targets, ADR 016's adapter SPI, etc.), as scattered prose in [`docs/reference/typescript-patterns.md`](../../docs/reference/typescript-patterns.md), and as Cursor rules under [`.cursor/rules/`](../../.cursor/rules/). There is no single place an architect (human or agent) can consult to learn "what shapes does this codebase already commit to?" before making a structural decision.

This project creates that single place: a curated **architecture pattern catalogue** under [`docs/architecture docs/patterns/`](../../docs/architecture%20docs/), with one short doc per pattern. Each catalogue entry pins intent, structure, when-to-use boundaries, and reference implementations in the codebase; ADRs continue to record _decisions_ and link forward to the patterns they instantiate. The architect persona ([`.agents/skills/drive-agent-personas/personas/architect.md`](../../.agents/skills/drive-agent-personas/personas/architect.md)) gains a "Patterns to know" section that points at the catalogue as the architect's working library.

# Context

> **Note to the implementer.** This spec is intentionally self-contained. You do not need any prior conversation context. Every claim is grounded in concrete files cited inline; every pattern listed for v1 has at least one reference implementation in the codebase. If a claim does not match what you find on disk, prefer the codebase and surface the discrepancy back through the spec.

## Why this catalogue exists

The Prisma Next codebase has reached a size where the same architectural shape recurs in multiple places. A non-exhaustive list:

- **Frozen-class AST + visitor**, used in at least four places: Postgres `OpFactoryCall` IR ([`packages/3-targets/3-targets/postgres/src/core/migrations/op-factory-call.ts`](../../packages/3-targets/3-targets/postgres/src/core/migrations/op-factory-call.ts)), Mongo `OpFactoryCall` IR ([`packages/3-mongo-target/1-mongo-target/src/core/op-factory-call.ts`](../../packages/3-mongo-target/1-mongo-target/src/core/op-factory-call.ts)), Mongo schema IR ([`packages/2-mongo-family/3-tooling/mongo-schema-ir/src/schema-node.ts`](../../packages/2-mongo-family/3-tooling/mongo-schema-ir/src/schema-node.ts)), Mongo filter expressions / aggregation expressions / query stages / wire commands (`packages/2-mongo-family/4-query/query-ast/src/`, `packages/2-mongo-family/6-transport/mongo-wire/src/`).

- **JSON-canonical / class-in-memory round-trip**, codified by ADR 192 (`docs/architecture docs/adrs/ADR 192 - ops.json is the migration contract.md`) and ADR 196 (`ADR 196 - In-process emit for class-flow targets.md`); applied first to migration `ops.json` and now being extended to Contract IR and Schema IR by the in-flight [`target-extensible-ir`](../target-extensible-ir/spec.md) project.

- **SPI / dependency inversion at the lowest consuming layer**, codified by ADR 185 (`ADR 185 - SPI types live at the lowest consuming layer.md`); the canonical example is `EmissionSpi` in `packages/1-framework/1-core/framework-components/src/emission/`. The pattern is being applied next to schema verifier and contract hydrator interfaces by the `target-extensible-ir` project.

- **Interface + factory function for stateful services**, currently the strongest instance of explicit pattern documentation: [`docs/reference/typescript-patterns.md`](../../docs/reference/typescript-patterns.md) § "Interface-Based Design with Factory Functions". Examples: `Runtime → createRuntime()`, `PostgresAdapter → createPostgresAdapter()`, `ColumnRegistry → createColumnRegistry()`.

- **Adapter SPI / thin core, fat targets**, codified by ADR 005 (`ADR 005 - Thin Core Fat Targets.md`), ADR 016 (`ADR 016 - Adapter SPI for Lowering.md`), ADR 198 (`ADR 198 - Runner decoupled from driver via visitor SPIs.md`).

- **Capability gating**, codified across ADR 005, ADR 031 (capability discovery & negotiation), ADR 065 (capability schema v1), ADR 117 (capability profile), ADR 207 (family-instance capability views). Documented in [`docs/reference/capabilities.md`](../../docs/reference/capabilities.md).

- **Branch on adapter, not on target**, captured as a Cursor rule: [`.cursor/rules/no-target-branches.mdc`](../../.cursor/rules/no-target-branches.mdc).

- **Package layering: domains × layers × planes**, codified in [`docs/architecture docs/Package-Layering.md`](../../docs/architecture%20docs/Package-Layering.md), enforced by `architecture.config.json` and `scripts/check-imports.mjs` (`pnpm lint:deps`).

These shapes recur because they solve recurring structural problems. They are also load-bearing: when a contributor reaches for a pattern that the codebase has already settled differently, the result is conceptual debt — the architect persona's Priority 4 ("conceptual integrity") and Priority 5 ("conceptual minimality") flag it, but only if the reviewer happens to know the codebase's existing answer.

The gap is discovery. Today, learning "what shapes does this codebase commit to?" requires:

- Reading every ADR and remembering which describe a pattern (recurrent shape) vs. which describe a one-off decision (single-instance choice). The current ADR set has 100+ entries; the patterns are buried.
- Reading [`docs/reference/typescript-patterns.md`](../../docs/reference/typescript-patterns.md), which mixes language-level patterns ("generic parameter defaults") with codebase-level patterns ("interface-based design") at the same depth.
- Browsing [`.cursor/rules/`](../../.cursor/rules/) (69 rules, mostly tactical).
- Spelunking the codebase for examples.

The architect persona's job — keep the system's structure coherent over time — depends on knowing the codebase's existing structural commitments. There is no working library for an architect to consult before approving or rejecting a new shape. This project creates one.

## What "pattern" means in this catalogue

A pattern, in this catalogue, is a **recurring structural shape** — a recipe for how to solve a class of architectural problems that the codebase has already settled for. It is distinct from:

- **A decision** (an ADR): a one-time choice, possibly the seed for a future pattern but recorded as a decision regardless of recurrence.
- **A rule** (a Cursor rule): a tactical do/don't, scoped narrower than a structural pattern.
- **A reference doc** (`docs/reference/`): how-to / guide content for a specific subsystem or task.

The catalogue is the place a pattern earns once it has at least **two reference implementations** _and_ is structural enough that an architect must check it before approving a new shape. Single-instance shapes stay as ADRs; tactical do/don'ts stay as rules; subsystem how-tos stay as reference docs. The catalogue cross-links into all three but does not duplicate them.

## Promotion criteria (when a new pattern earns its place)

A future pattern joins the catalogue when, broadly:

1. **It is recurrent.** At least two reference implementations exist in the codebase (or are explicitly committed to land via an in-flight project). One-off shapes stay as ADRs.
2. **It crosses subsystem boundaries.** Patterns that fit inside a single subsystem are usually better captured in that subsystem's doc; the catalogue is for shapes that any contributor working anywhere in the codebase might need.
3. **It is structural, not tactical.** "How to lay out an AST node" is structural; "use `pathe` for paths" is tactical and lives as a Cursor rule.
4. **It earns its keep against the architect persona's conceptual-minimality lens.** A speculative-future pattern with no current adopter does not belong in the catalogue — wait for the second instance.

The promotion process: copy [`docs/architecture docs/patterns/_template.md`](../../docs/architecture%20docs/) (created by this project), fill it in, link from the catalogue index, cross-link from any newly-affected ADR. The architect persona owns the bar; tech-lead arbitrates if there is disagreement.

## Where the catalogue lives

```
docs/architecture docs/
├── ADR-INDEX.md                  # existing
├── adrs/                          # existing — decisions, link forward to patterns
├── subsystems/                    # existing — subsystem deep-dives
├── Package-Layering.md            # existing — already pattern-shaped
└── patterns/                      # NEW — created by this project
    ├── README.md                 # catalogue index, links every pattern
    ├── _template.md              # copy this for new patterns
    ├── frozen-class-ast.md
    ├── json-canonical-class-in-memory.md
    ├── three-layer-polymorphic-ir.md
    ├── spi-at-lowest-consuming-layer.md
    ├── interface-plus-factory.md
    ├── adapter-spi.md
    ├── capability-gating.md
    └── package-layering.md       # short doc that points at Package-Layering.md
```

File names are kebab-case slugs of the pattern title. The exact slugs above are recommendations; the implementer may pick clearer ones.

# Approach

## Pattern doc template

Every catalogue entry is a single Markdown file following this template. Keep entries short and dense — one-screen-sized when possible, never longer than the longest ADR. The reader is consulting the catalogue to confirm a shape, not to learn a subsystem.

```markdown
# Pattern: <Title>

**Status:** Stable | Emerging
**Maintainer:** <persona/team — usually "architect">

## Intent

<1–3 sentences. What problem does this pattern solve? What does adopting it commit you to?>

## When to use

<Bullets. The conditions under which this pattern is the right fit. State them concretely enough that a reader can verify their case matches.>

## When NOT to use

<Bullets. Cases where another pattern is the right fit, with a pointer to which one. This section is critical — patterns without a clearly-stated "not this case" tend to over-apply.>

## Structure

<The shape. Types, layers, interfaces, contracts — whichever language fits. Keep it abstract; concrete code goes in "Reference implementations". Diagrams welcome but optional.>

## Reference implementations

<Table or bullet list. Each entry: name, file path (repo-relative link), one-sentence note on what it demonstrates.>

| Implementation | Path | Demonstrates |
|---|---|---|
| ... | [...](...) | ... |

## Related ADRs

<Bullets. ADRs that decided to adopt this pattern, ADRs that codified its boundaries, ADRs whose decision is an instance of this pattern.>

## Related patterns

<Bullets. Patterns that compose with this one (link to other catalogue entries), patterns that are alternatives, patterns this one supersedes.>

## Cautions / common mistakes

<Optional but recommended. The mistakes the architect persona has seen this pattern attract. Surface them so reviewers can check.>
```

The template is itself shipped under `docs/architecture docs/patterns/_template.md` so contributors can copy it.

## v1 patterns to write

The implementer writes these eight patterns for v1. Each is grounded in concrete reference implementations and at least one ADR. The notes per pattern are the seed material — read them, verify against the codebase, then write the catalogue entry.

### 1. Frozen-class AST + visitor

**Slug:** `frozen-class-ast.md`
**Intent:** A discriminated AST is implemented as an abstract base class plus concrete classes per node kind, frozen at construction, with an `accept(visitor)` method for narrow exhaustive dispatch and (where useful) a separate `rewrite(rewriter)` method for transforming walks. Public class instances are the AST; the visitor interface is the consumption contract for kind-narrow operations.
**Reference implementations:**
- Postgres migration ops: [`packages/3-targets/3-targets/postgres/src/core/migrations/op-factory-call.ts`](../../packages/3-targets/3-targets/postgres/src/core/migrations/op-factory-call.ts)
- Mongo migration ops: [`packages/3-mongo-target/1-mongo-target/src/core/op-factory-call.ts`](../../packages/3-mongo-target/1-mongo-target/src/core/op-factory-call.ts)
- Mongo schema IR: [`packages/2-mongo-family/3-tooling/mongo-schema-ir/src/schema-node.ts`](../../packages/2-mongo-family/3-tooling/mongo-schema-ir/src/schema-node.ts) and siblings (`schema-ir.ts`, `schema-collection.ts`, `schema-index.ts`, `visitor.ts`)
- Mongo filter expressions: [`packages/2-mongo-family/4-query/query-ast/src/filter-expressions.ts`](../../packages/2-mongo-family/4-query/query-ast/src/filter-expressions.ts) (also demonstrates the visitor + rewriter dual interface)
- Mongo aggregation expressions / stages / wire commands: [`packages/2-mongo-family/4-query/query-ast/src/aggregation-expressions.ts`](../../packages/2-mongo-family/4-query/query-ast/src/aggregation-expressions.ts), `stages.ts`, [`packages/2-mongo-family/6-transport/mongo-wire/src/wire-commands.ts`](../../packages/2-mongo-family/6-transport/mongo-wire/src/wire-commands.ts)

**Related ADRs:** ADR 195 (Planner IR with two renderers), ADR 187 (MongoDB schema representation for migration diffing), ADR 188 (MongoDB migration operation model), ADR 193 (Class-flow as the canonical migration authoring strategy).
**When to use:** target-extensible IRs; any tree where consumers need exhaustive kind dispatch and the tree round-trips through JSON.
**When NOT to use:** stateful services (use _Interface + factory_); single-instance value objects; trees that never need polymorphic dispatch.

### 2. JSON-canonical / class-in-memory round-trip

**Slug:** `json-canonical-class-in-memory.md`
**Intent:** The canonical persistent artifact is JSON; the canonical in-memory form is a class hierarchy whose plain readonly fields serialize via `JSON.stringify` without a custom `toJSON()`. Hydration validates JSON shape (arktype) then constructs class instances. Identity, attestation, and audit key off the JSON; in-memory consumers walk class instances polymorphically.
**Reference implementations:**
- Migration `ops.json`: produced by `OpFactoryCall` classes; consumed by lowering and runner. See ADRs 192 and 196.
- (Forthcoming, in-flight via `target-extensible-ir`) Contract IR and Schema IR.

**Related ADRs:** ADR 192 (ops.json is the migration contract), ADR 196 (In-process emit for class-flow targets), ADR 097 (Tooling runs on canonical JSON only), ADR 098 (Runtime accepts contract object or JSON).
**When to use:** any IR or contract where (a) machine readability and reproducibility require a stable JSON form, _and_ (b) in-memory consumers benefit from polymorphic dispatch / typed class instances.
**When NOT to use:** transient values that don't persist; configuration objects with no polymorphism.
**Cautions:** class fields must stay JSON-clean (no `Map`, `Set`, `Date`, methods on properties). The architect persona should flag any class field that isn't a plain readonly value.

### 3. Three-layer polymorphic IR (framework → family → target)

**Slug:** `three-layer-polymorphic-ir.md`
**Intent:** IRs that cross the framework/target boundary are layered as **framework interfaces and abstract bases → family abstract bases → target concrete classes**. The framework declares the minimum every target must satisfy; the family refines for SQL-shaped or document-shaped persistence; the target ships concrete classes _and_ target-only kinds with no family parent.
**Status note:** **Emerging** — formally introduced and codified by the in-flight [`target-extensible-ir`](../target-extensible-ir/spec.md) project. Migration ops already follow it (framework `OpFactoryCall` interface in [`packages/1-framework/1-core/framework-components/src/control/control-migration-types.ts`](../../packages/1-framework/1-core/framework-components/src/control/control-migration-types.ts), target abstract base + concrete classes in the Postgres / Mongo files cited above). The pattern entry should reflect both the established reference (migration ops) and the emerging convention (Contract IR / Schema IR per the `target-extensible-ir` spec).
**Related ADRs:** ADR 195, ADR 005 (Thin Core Fat Targets) — and the ADR(s) that the `target-extensible-ir` project produces at close-out.
**When to use:** any IR that targets must extend with kinds the framework cannot anticipate (Postgres schemas, RLS policies, custom functions, MySQL databases, etc.).
**When NOT to use:** IRs that are inherently target-uniform (e.g. the unified Plan model in ADR 011 — every target lowers _into_ this; no target extends it).

### 4. SPI at the lowest consuming layer

**Slug:** `spi-at-lowest-consuming-layer.md`
**Intent:** When a lower layer needs to call a higher-layer implementation (dependency inversion), the SPI _interface_ is declared at the lowest layer whose types the SPI depends on; the implementer lives higher up; both the caller and the implementer depend on the abstraction, never on each other.
**Reference implementations:**
- `EmissionSpi`: declared in `packages/1-framework/1-core/framework-components/src/emission/`; implemented by `sqlEmission`, `mongoEmission`. The emitter (lower layer, tooling) defines and calls it; family-level emission packages implement it.

**Related ADRs:** ADR 185 (SPI types live at the lowest consuming layer). Also ADR 198 (Runner decoupled from driver via visitor SPIs) for the visitor-as-SPI variant.
**When to use:** any cross-layer dispatch where the framework / lower layer needs target-specific behaviour without knowing the target.
**When NOT to use:** when the framework can model the variation directly via abstract methods on a class hierarchy (then use _Three-layer polymorphic IR_).

### 5. Interface + factory function (stateful services)

**Slug:** `interface-plus-factory.md`
**Intent:** Stateful services (registries, runtimes, adapters, drivers) are exposed as an exported `interface` plus a factory function (`createXxx()`); the implementing class is private. Consumers depend on the interface; the implementation is hidden.
**Reference implementations:**
- `Runtime → createRuntime()`
- `PostgresAdapter → createPostgresAdapter()`
- `ColumnRegistry → createColumnRegistry()`
- `PostgresDriver → postgresRuntimeDriverDescriptor.create() + connect(binding)`

**Existing documentation to migrate:** [`docs/reference/typescript-patterns.md`](../../docs/reference/typescript-patterns.md) § "Interface-Based Design with Factory Functions" is the most fully-developed prose for this pattern. The catalogue entry condenses it; the reference doc keeps the language-level patterns ("generic parameter defaults") and points at the catalogue for the architectural one. See § "Migration of existing reference docs" below.
**Related ADRs:** ADR 007 (Types Only Emission) — the pattern aligns with no-runtime-class-export.
**When to use:** stateful services where the consumer holds an opaque handle and does not need to construct the implementation by hand.
**When NOT to use:** AST/IR nodes that need polymorphic dispatch and JSON round-trip — those use _Frozen-class AST + visitor_ + _JSON-canonical / class-in-memory round-trip_. See `target-extensible-ir/spec.md` § "Codifying the convention" for the explicit service-vs-AST distinction this catalogue codifies.

### 6. Adapter SPI for target-specific behaviour

**Slug:** `adapter-spi.md`
**Intent:** Target-specific behaviour (dialect emission, capability discovery, type expansion, default rendering, error mapping) is encapsulated behind an adapter interface that the framework consumes uniformly. The framework never branches on `target === 'postgres'`; targets register adapters and the framework dispatches.
**Reference implementations:**
- `PostgresAdapter` (the canonical example), `SQLiteAdapter`, the Mongo target's adapter analog. Codec hooks, type expansion hooks, default normalization hooks all flow through this surface.
- ADR 198's runner-decoupled-from-driver visitor SPI applies the same pattern at the runtime layer.

**Related ADRs:** ADR 005 (Thin Core Fat Targets), ADR 016 (Adapter SPI for Lowering), ADR 031 (Adapter capability discovery & negotiation), ADR 065 (Adapter capability schema v1), ADR 198 (Runner decoupled from driver via visitor SPIs).
**Related rule:** [`.cursor/rules/no-target-branches.mdc`](../../.cursor/rules/no-target-branches.mdc) — the rule is the tactical enforcement; the pattern entry is the structural rationale.
**When to use:** any framework code that needs target-specific behaviour at runtime.
**When NOT to use:** code that is genuinely target-agnostic — don't introduce an adapter call that always returns the same answer.

### 7. Capability gating

**Slug:** `capability-gating.md`
**Intent:** Optional or target-varying features are declared as capabilities in the contract, verified against the database (or adapter) at runtime, and gated at every consumption site. The framework never assumes a feature is available; it asks the capability profile and degrades gracefully if not.
**Reference implementations:**
- Capability profile structure: see `packages/1-framework/1-core/framework-components/src/control/control-capabilities.ts` and the family-instance views per ADR 207.
- Examples of gated features: `includeMany`, `returning()`, prepared statements (ADR 210), `RETURNING` on `INSERT … ON CONFLICT`, etc.

**Related ADRs:** ADR 005, ADR 031 (capability discovery & negotiation), ADR 065 (capability schema v1), ADR 117 (capability profile and `profileHash`), ADR 207 (Family-instance capability views).
**Related reference docs:** [`docs/reference/capabilities.md`](../../docs/reference/capabilities.md) — the catalogue entry condenses the pattern; the reference doc keeps the catalogue of actual capabilities. The pattern entry should link forward to the reference doc rather than duplicate its contents.
**Related rule:** [`.cursor/rules/capabilities-ownership.mdc`](../../.cursor/rules/capabilities-ownership.mdc).
**When to use:** any feature that is target-optional, target-varying, or version-dependent on the live database.
**When NOT to use:** features that are universally supported across all targets the framework currently models — gating them adds noise without value.

### 8. Package layering: domains × layers × planes

**Slug:** `package-layering.md`
**Intent:** Packages are organized along three orthogonal axes — **domains** (Framework, SQL, Document, Targets, Extensions), **layers** (Core → Authoring → Tooling → Lanes → Runtime → Adapters), and **planes** (Migration, Runtime, Shared). Imports flow downward and outward only; cross-axis violations are caught by `pnpm lint:deps`.
**Reference implementations / sources of truth:**
- [`docs/architecture docs/Package-Layering.md`](../../docs/architecture%20docs/Package-Layering.md) — the existing canonical doc.
- `architecture.config.json` — the machine-readable mapping.
- `scripts/check-imports.mjs` — the enforcement (run via `pnpm lint:deps`).

**Catalogue entry strategy:** the existing `Package-Layering.md` already plays the role a catalogue entry would play. The catalogue ships a short pattern entry that summarizes the shape, links to `Package-Layering.md` for the full mapping, and cross-references the rule at [`.cursor/rules/import-validation.mdc`](../../.cursor/rules/import-validation.mdc). Do _not_ duplicate `Package-Layering.md`'s content; treat it as the canonical reference.
**Related ADRs:** ADR 140 (Package Layering & Target-Family Namespacing), ADR 005 (Thin Core Fat Targets), ADR 150 (Family-Agnostic CLI and Pack Entry Points).
**Related rules:** [`.cursor/rules/import-validation.mdc`](../../.cursor/rules/import-validation.mdc), [`.cursor/rules/no-barrel-files.mdc`](../../.cursor/rules/no-barrel-files.mdc), [`.cursor/rules/multi-plane-packages.mdc`](../../.cursor/rules/multi-plane-packages.mdc), [`.cursor/rules/multi-plane-entrypoints.mdc`](../../.cursor/rules/multi-plane-entrypoints.mdc).

## Catalogue index (`patterns/README.md`)

The catalogue index is the entry point. It must:

- Open with a 1-paragraph statement of what the catalogue is and how it differs from ADRs, rules, and reference docs (use § "What 'pattern' means in this catalogue" above as source material).
- List every catalogue entry as a table with columns: **Pattern**, **Slug** (linked), **Intent (one-line)**, **Status** (Stable / Emerging).
- Include a "How to add a new pattern" section that captures the promotion criteria from § "Promotion criteria" above and points at `_template.md`.
- Cross-link forward to `ADR-INDEX.md`, `Package-Layering.md`, and `docs/reference/`.

## Architect persona update

The architect persona at [`.agents/skills/drive-agent-personas/personas/architect.md`](../../.agents/skills/drive-agent-personas/personas/architect.md) needs a new section, suggested heading `## Patterns to know`, placed after `## Probes` and before `## Vocabulary cues`. Recommended content:

> The catalogue at [`docs/architecture docs/patterns/`](../../docs/architecture%20docs/) records the structural shapes the codebase has settled for. Before approving a new shape — or recommending an alternative — consult the catalogue:
>
> - If the change instantiates an existing pattern, name the pattern in your review and check whether the change follows it cleanly.
> - If the change introduces a shape the catalogue does not record _and_ you can find at least one prior instance, surface the recurrence: the codebase is committing to a pattern, and the catalogue should learn it (see "How to add a new pattern" in the catalogue index).
> - If the change introduces a shape the catalogue records under "When NOT to use", surface that explicitly — the architect persona's job is to catch the divergence before it lands.
>
> Patterns to read first: _Frozen-class AST + visitor_, _JSON-canonical / class-in-memory round-trip_, _Three-layer polymorphic IR_, _SPI at the lowest consuming layer_, _Interface + factory function_, _Adapter SPI_, _Capability gating_, _Package layering_.

The implementer should adapt the wording to match the persona file's voice (cold, surface-the-defect register).

## Migration of existing reference docs

[`docs/reference/typescript-patterns.md`](../../docs/reference/typescript-patterns.md) currently mixes:

- **Language-level TypeScript patterns** ("Generic Parameter Defaults", "Default generic parameters") — these stay in the reference doc; they are not architectural.
- **Codebase-level architectural patterns** ("Interface-Based Design with Factory Functions") — this section is one of the v1 catalogue entries. The reference doc should retain a short stub linking to the catalogue entry, with the rationale: "This pattern is documented in the architecture pattern catalogue under [`patterns/interface-plus-factory.md`](...). The catalogue is the source of truth; this reference doc covers TypeScript-level patterns specifically."
- **TypeScript-mechanical guidance for the pattern** (the "Exception: Classes with Private Properties in Exported Types" subsection) — this stays in the reference doc; it is TypeScript mechanics, not pattern definition.

[`docs/reference/capabilities.md`](../../docs/reference/capabilities.md) is _not_ migrated: it catalogues actual capabilities (a domain reference), not the capability-gating _pattern_. The catalogue entry links forward to it.

[`docs/reference/modular-refactoring-patterns.md`](../../docs/reference/modular-refactoring-patterns.md): the implementer should read it and decide. If it documents a recurring structural pattern, it is a v1 candidate (or a v2 pattern). If it documents a one-off refactor recipe, it stays as reference. **Default assumption: stays as reference; flag as a candidate during execution if the implementer's read of it disagrees.**

## Cross-referencing strategy

For each v1 pattern:

- The catalogue entry links to its **related ADRs** (forward links in the catalogue → ADRs).
- The catalogue entry links to its **reference implementations** (forward links to code files).
- The catalogue entry links to **related rules** in [`.cursor/rules/`](../../.cursor/rules/) where applicable.
- Existing ADRs are **not retroactively updated** to add backward links to the catalogue. Instead, going forward, _new_ ADRs that instantiate a catalogue pattern should link to it (this expectation should be added to [`.cursor/rules/adr-writing.mdc`](../../.cursor/rules/adr-writing.mdc) as part of close-out — see Open Questions for the "do we update adr-writing rule" question).
- The catalogue index links to `ADR-INDEX.md` so the two indexes are reachable from each other.

## What this project is _not_

- **Not a refactor of existing code.** The patterns describe what is already there; no production code changes.
- **Not new ADRs.** The implementer does not write ADRs; the patterns reference existing ADRs and let those ADRs continue to do their job.
- **Not a rewrite of the rules under `.cursor/rules/`.** The rules stay tactical; the catalogue entries cross-link to them.
- **Not exhaustive.** v1 ships eight patterns. v2+ patterns are added by future contributors via the promotion process the catalogue itself documents.

# Requirements

## Functional Requirements

### Catalogue structure

- **FR1.** A new directory exists at `docs/architecture docs/patterns/`.
- **FR2.** The directory contains `README.md` (catalogue index) and `_template.md` (pattern doc template). The template is the one defined in § "Pattern doc template" above.
- **FR3.** The directory contains a Markdown file per v1 pattern (eight files; see § "v1 patterns to write"). File names are kebab-case slugs of the pattern title.
- **FR4.** The catalogue index lists every v1 entry with: pattern name (linked), slug, one-line intent, status (Stable / Emerging).
- **FR5.** The catalogue index includes a "How to add a new pattern" section reflecting the promotion criteria in § "Promotion criteria".

### Pattern doc shape

- **FR6.** Every v1 pattern doc follows the template in § "Pattern doc template" — Intent, When to use, When NOT to use, Structure, Reference implementations, Related ADRs, Related patterns, optional Cautions.
- **FR7.** Every v1 pattern doc cites at least one reference implementation in the codebase by file path. Paths are repo-relative Markdown links.
- **FR8.** Every v1 pattern doc cites at least one ADR. ADR links use the existing `docs/architecture docs/adrs/` filenames, URL-encoded for spaces.
- **FR9.** Each pattern doc includes a "When NOT to use" section that names at least one alternative pattern (or the case where no pattern applies) and links to it.

### Architect persona

- **FR10.** The architect persona at [`.agents/skills/drive-agent-personas/personas/architect.md`](../../.agents/skills/drive-agent-personas/personas/architect.md) gains a "Patterns to know" section linking the catalogue and naming the v1 patterns. Wording adapts the suggested prose to the persona file's existing register.

### Migration of existing reference docs

- **FR11.** [`docs/reference/typescript-patterns.md`](../../docs/reference/typescript-patterns.md) § "Interface-Based Design with Factory Functions" is condensed to a stub linking to the catalogue entry. The TypeScript-mechanical guidance ("Exception: Classes with Private Properties in Exported Types") stays in the reference doc.
- **FR12.** No other reference docs are migrated as part of v1. (`docs/reference/capabilities.md` is referenced from the catalogue but not moved; `modular-refactoring-patterns.md` is left alone unless the implementer flags it as a v1 candidate.)

### Cross-references

- **FR13.** The catalogue index has a "Related indexes" section linking forward to `docs/architecture docs/ADR-INDEX.md`, `docs/architecture docs/Package-Layering.md`, and `docs/reference/README.md` (or the closest equivalent if no `README.md` exists).
- **FR14.** Each v1 pattern doc with a related Cursor rule includes a "Related rules" section linking the rule files under [`.cursor/rules/`](../../.cursor/rules/) by relative path.
- **FR15.** Existing ADRs are not retroactively edited to add backward links to the catalogue.

## Non-Functional Requirements

- **NFR1.** Each pattern doc is concise — readable in under five minutes by a contributor who already knows the codebase. Long prose moves to the related ADR or subsystem doc.
- **NFR2.** Every link in the catalogue resolves. Verified by manual click-through or a Markdown link checker before close-out.
- **NFR3.** The catalogue follows the [markdown-no-artificial-line-wraps](../../.claude/skills/markdown-no-artificial-line-wraps/SKILL.md) skill — no fixed-column hard wraps in prose.
- **NFR4.** The catalogue entries adopt the doc-maintenance discipline: prefer links to canonical docs over inlined duplicates; keep code examples short and grounded in real reference implementations.
- **NFR5.** No claim in any catalogue entry is unsupported by either a cited reference implementation, a cited ADR, or a cited rule. The architect persona's own bar — "earns its keep" — applies to the catalogue itself.

## Non-goals

- **Migrating ADRs.** ADRs continue to live where they are; the catalogue links forward only.
- **Migrating Cursor rules.** Rules stay where they are; the catalogue links forward only.
- **Documenting language-level TypeScript patterns** ("generic parameter defaults", arktype usage). These are not structural patterns; they stay as reference docs and rules.
- **Creating a backward-reference web** from existing ADRs into the catalogue. Going forward, _new_ ADRs link forward; existing ADRs are not bulk-edited.
- **Producing v2+ patterns.** The eight v1 patterns are the floor; further patterns are added by future contributors via the documented promotion process.
- **Refactoring any production code** to match patterns the catalogue records.

# Acceptance Criteria

- [ ] **AC1.** `docs/architecture docs/patterns/` exists, containing `README.md`, `_template.md`, and the eight v1 pattern files (or reasonable equivalents — the implementer may rename slugs).
- [ ] **AC2.** Each of the eight v1 pattern files conforms to the template in § "Pattern doc template": Intent, When to use, When NOT to use, Structure, Reference implementations, Related ADRs, Related patterns. Each cites at least one reference implementation and at least one ADR by working repo-relative link.
- [ ] **AC3.** The catalogue index (`README.md`) lists every v1 entry, includes the "How to add a new pattern" section, and links forward to `ADR-INDEX.md`, `Package-Layering.md`, and `docs/reference/`.
- [ ] **AC4.** The architect persona at [`.agents/skills/drive-agent-personas/personas/architect.md`](../../.agents/skills/drive-agent-personas/personas/architect.md) carries a "Patterns to know" section pointing at the catalogue and naming the v1 patterns.
- [ ] **AC5.** [`docs/reference/typescript-patterns.md`](../../docs/reference/typescript-patterns.md) § "Interface-Based Design with Factory Functions" is condensed to a stub that links forward to the catalogue's `interface-plus-factory.md` entry; the TypeScript-mechanical "Exception" subsection is retained.
- [ ] **AC6.** A spot-check by the architect persona on three random v1 entries confirms (a) the cited reference implementations exist and demonstrate the claim; (b) the cited ADRs are real and relevant; (c) the "When NOT to use" section names a concrete alternative.
- [ ] **AC7.** Every link in the catalogue resolves (no 404s on `docs/architecture docs/adrs/...`, no broken file paths to packages).
- [ ] **AC8.** No production code is modified by this project. The diff is doc-only (plus the persona update).
- [ ] **AC9.** A fresh contributor — given only the catalogue index and one randomly-chosen v1 entry — can articulate the pattern's intent and find at least one reference implementation in the codebase within five minutes. (This is a usability check: the implementer should self-test or ask a teammate.)

# Other Considerations

## Security

No new user data flows or external surfaces. Doc-only project.

## Cost

Internal documentation effort only. The implementer's time, scoped to the catalogue scaffolding plus eight v1 entries.

## Observability

Not applicable.

## Data Protection

Not applicable.

## Analytics

Not applicable.

## Maintenance

The catalogue's promotion process is its maintenance plan: future contributors add new entries via the template and the criteria documented in the catalogue index. The architect persona owns the bar; tech-lead arbitrates if a contributor and the architect persona disagree on whether a pattern is ready.

# References

## Project-internal

- [`projects/target-extensible-ir/spec.md`](../target-extensible-ir/spec.md) — sibling in-flight project; the canonical example of a project actively codifying multiple patterns this catalogue records (frozen-class AST, JSON-canonical/class round-trip, three-layer polymorphic IR, SPI at lowest layer). The `target-extensible-ir` spec's § "Codifying the convention" section contains the most-developed prose for several v1 patterns; the implementer should read it before writing the corresponding catalogue entries.
- [`projects/README.md`](../README.md) — project workflow expectations (project artifacts are transient; close-out migrates long-lived docs into `docs/`).

## Codebase entry points (read these first)

- [`docs/Architecture Overview.md`](../../docs/Architecture%20Overview.md) — the high-level guiding principles. Understand "Thin core, fat targets", "Compose, don't configure", "Modular, composable packages" before writing pattern entries that instantiate them.
- [`docs/architecture docs/ADR-INDEX.md`](../../docs/architecture%20docs/ADR-INDEX.md) — index of all ADRs. Use it to find the right ADR(s) to cite per pattern.
- [`docs/architecture docs/Package-Layering.md`](../../docs/architecture%20docs/Package-Layering.md) — the existing canonical doc for the package-layering pattern.
- [`docs/architecture docs/subsystems/`](../../docs/architecture%20docs/subsystems/) — subsystem deep-dives. Several reference patterns this catalogue records.
- [`docs/reference/typescript-patterns.md`](../../docs/reference/typescript-patterns.md) — existing reference doc; the most-developed prose for the _Interface + factory function_ pattern.
- [`AGENTS.md`](../../AGENTS.md) / [`CLAUDE.md`](../../CLAUDE.md) — the agent onboarding doc. Line 93's "Interface-Based Design" rule is currently broad; the in-flight `target-extensible-ir` project will split it. Keep the catalogue's framing consistent with the post-split rule.

## ADRs cited per v1 pattern

(The implementer adds more as needed; this is the floor.)

- ADR 005 — Thin Core Fat Targets — informs _Adapter SPI_, _Capability gating_, _Three-layer polymorphic IR_.
- ADR 016 — Adapter SPI for Lowering — _Adapter SPI_.
- ADR 031 — Adapter capability discovery & negotiation — _Capability gating_.
- ADR 065 — Adapter capability schema v1 — _Capability gating_.
- ADR 097 — Tooling runs on canonical JSON only — _JSON-canonical / class-in-memory round-trip_.
- ADR 098 — Runtime accepts contract object or JSON — _JSON-canonical / class-in-memory round-trip_.
- ADR 117 — capability profile — _Capability gating_.
- ADR 140 — Package Layering & Target-Family Namespacing — _Package layering_.
- ADR 150 — Family-Agnostic CLI and Pack Entry Points — _Package layering_.
- ADR 185 — SPI types live at the lowest consuming layer — _SPI at the lowest consuming layer_.
- ADR 187 — MongoDB schema representation for migration diffing — _Frozen-class AST_.
- ADR 188 — MongoDB migration operation model — _Frozen-class AST_.
- ADR 192 — ops.json is the migration contract — _JSON-canonical / class-in-memory round-trip_.
- ADR 193 — Class-flow as the canonical migration authoring strategy — _Frozen-class AST_.
- ADR 195 — Planner IR with two renderers — _Frozen-class AST_, _Three-layer polymorphic IR_.
- ADR 196 — In-process emit for class-flow targets — _JSON-canonical / class-in-memory round-trip_.
- ADR 198 — Runner decoupled from driver via visitor SPIs — _Adapter SPI_, _SPI at the lowest consuming layer_ (visitor variant).
- ADR 207 — Family-instance capability views for the framework CLI — _Capability gating_.

## Reference implementations to verify against

- [`packages/3-targets/3-targets/postgres/src/core/migrations/op-factory-call.ts`](../../packages/3-targets/3-targets/postgres/src/core/migrations/op-factory-call.ts)
- [`packages/3-mongo-target/1-mongo-target/src/core/op-factory-call.ts`](../../packages/3-mongo-target/1-mongo-target/src/core/op-factory-call.ts)
- [`packages/2-mongo-family/3-tooling/mongo-schema-ir/src/schema-node.ts`](../../packages/2-mongo-family/3-tooling/mongo-schema-ir/src/schema-node.ts)
- [`packages/2-mongo-family/4-query/query-ast/src/filter-expressions.ts`](../../packages/2-mongo-family/4-query/query-ast/src/filter-expressions.ts)
- [`packages/2-mongo-family/4-query/query-ast/src/aggregation-expressions.ts`](../../packages/2-mongo-family/4-query/query-ast/src/aggregation-expressions.ts)
- [`packages/2-mongo-family/4-query/query-ast/src/stages.ts`](../../packages/2-mongo-family/4-query/query-ast/src/stages.ts)
- [`packages/2-mongo-family/6-transport/mongo-wire/src/wire-commands.ts`](../../packages/2-mongo-family/6-transport/mongo-wire/src/wire-commands.ts)
- [`packages/1-framework/1-core/framework-components/src/control/control-migration-types.ts`](../../packages/1-framework/1-core/framework-components/src/control/control-migration-types.ts)
- `packages/1-framework/1-core/framework-components/src/emission/` — `EmissionSpi`
- `packages/1-framework/1-core/framework-components/src/control/control-capabilities.ts`

## Cursor rules cited per v1 pattern

- [`.cursor/rules/no-target-branches.mdc`](../../.cursor/rules/no-target-branches.mdc) — _Adapter SPI_
- [`.cursor/rules/import-validation.mdc`](../../.cursor/rules/import-validation.mdc) — _Package layering_
- [`.cursor/rules/no-barrel-files.mdc`](../../.cursor/rules/no-barrel-files.mdc) — _Package layering_
- [`.cursor/rules/multi-plane-packages.mdc`](../../.cursor/rules/multi-plane-packages.mdc) — _Package layering_
- [`.cursor/rules/multi-plane-entrypoints.mdc`](../../.cursor/rules/multi-plane-entrypoints.mdc) — _Package layering_
- [`.cursor/rules/capabilities-ownership.mdc`](../../.cursor/rules/capabilities-ownership.mdc) — _Capability gating_
- [`.cursor/rules/interface-factory-pattern.mdc`](../../.cursor/rules/interface-factory-pattern.mdc) — _Interface + factory function_
- [`.cursor/rules/typescript-patterns.mdc`](../../.cursor/rules/typescript-patterns.mdc) — _Interface + factory function_
- [`.cursor/rules/adr-writing.mdc`](../../.cursor/rules/adr-writing.mdc) — meta; consider updating to expect new ADRs to link forward to catalogue patterns where applicable (see Open Question 3).

# Open Questions

These are residual decisions for execution. None require re-opening Context.

1. **Slug naming.** Recommended slugs are listed per pattern (`frozen-class-ast.md`, `interface-plus-factory.md`, etc.). The implementer may pick clearer ones; the architect persona should sanity-check the final list against the discriminator-completeness probe (each slug should clearly differ from every other).

2. **Status of the "three-layer polymorphic IR" entry.** The pattern is _emerging_ — codified by the in-flight `target-extensible-ir` project but not yet shipped beyond migration ops. Two options: (a) ship the catalogue entry now with status **Emerging** and the explicit caveat that Contract IR / Schema IR adoption is in flight; (b) hold the entry until `target-extensible-ir` lands. **Default assumption: (a) — ship now with Emerging status**, because the architect persona benefits from knowing the pattern exists even before it's universally adopted. Flag if the implementer disagrees after reading both projects' specs.

3. **Should `adr-writing.mdc` be updated** to expect new ADRs that instantiate a catalogue pattern to link forward to it? Probably yes (the rule already exists at [`.cursor/rules/adr-writing.mdc`](../../.cursor/rules/adr-writing.mdc); this is a one-line addition). **Default assumption: yes, include this rule update in the project's diff.** Flag if the rule's existing wording resists the addition cleanly.

4. **`modular-refactoring-patterns.md` disposition.** [`docs/reference/modular-refactoring-patterns.md`](../../docs/reference/modular-refactoring-patterns.md) may or may not document a recurring structural pattern. The implementer reads it during execution and decides whether it qualifies as a v1 catalogue candidate. **Default assumption: leave as reference doc**; flag if the read suggests otherwise.

5. **Interface + factory function vs. Frozen-class AST tension.** The two patterns are _both_ in v1 and they explicitly cover different cases (services vs. AST nodes). The catalogue's value depends on stating the boundary cleanly in each entry's "When NOT to use" section. The implementer should pay particular attention to this pair and have the architect persona spot-check the boundary statements.

6. **Pattern depth / brevity.** Aim is short (one-screen per entry). The implementer should self-check after writing two or three entries whether the chosen depth carries useful information; adjust the rest accordingly. NFR1 is the floor; entries that need to be longer should still aim for "minimum viable depth", with detail pushed to the cited ADRs.

7. **Whether to ship a "Pattern recurrence threshold" sub-rubric** in the catalogue index's promotion section. Today the criterion is "at least two reference implementations." Some patterns may be one-instance-but-load-bearing (e.g. _Three-layer polymorphic IR_ before `target-extensible-ir` lands its second adopter). The catalogue should be honest about Emerging vs. Stable. **Default assumption: include the Status field per pattern, document the Stable / Emerging distinction in the index, and accept Emerging entries that have a credible second adopter committed.**

8. **Plan strategy.** This project is small enough that a stub plan suffices; the implementer can run [`drive-create-plan`](../../.claude/skills/drive-create-plan/SKILL.md) if richer milestoning is wanted. Recommended milestones: (M1) scaffold + template + index; (M2) write the eight v1 entries; (M3) update architect persona + reference-doc stub + close-out checklist. **Default assumption: plan stays a stub; implementer iterates entries one at a time and commits as they go (per [commit-as-you-go](../../.cursor/rules/commit-as-you-go.mdc)).**
