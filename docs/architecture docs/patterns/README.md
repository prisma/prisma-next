# Architecture pattern catalogue

This catalogue is the single place to learn **which structural shapes the Prisma Next codebase has settled for**. Each entry pins a pattern's intent, when it applies (and when it does not), the canonical structure, and reference implementations in the codebase. Consult it before approving — or proposing — a new architectural shape.

The catalogue is distinct from its neighbours:

- **ADRs** ([`../adrs/`](../adrs/)) record one-time decisions. The catalogue records recurring shapes those decisions instantiate.
- **Cursor rules** ([`../../../.cursor/rules/`](../../../.cursor/rules/)) are tactical do/don'ts. The catalogue records the structural rationale a rule enforces.
- **Reference docs** ([`../../reference/`](../../reference/)) are subsystem how-to guides. The catalogue records cross-subsystem shapes; subsystem-specific shapes stay in the reference docs.

## v1 entries

| Pattern | Slug | Intent (one-line) | Status |
|---|---|---|---|
| Frozen-class AST + visitor | [`frozen-class-ast.md`](./frozen-class-ast.md) | Discriminated AST as an abstract base + concrete classes per kind, frozen at construction, with `accept(visitor)` for narrow exhaustive dispatch. | Stable |
| JSON-canonical / class-in-memory round-trip | [`json-canonical-class-in-memory.md`](./json-canonical-class-in-memory.md) | The canonical persistent artifact is JSON; the canonical in-memory form is a class hierarchy whose plain readonly fields serialize without a custom `toJSON()`. | Stable |
| Three-layer polymorphic IR (framework → family → target) | [`three-layer-polymorphic-ir.md`](./three-layer-polymorphic-ir.md) | IRs that cross the framework/target boundary layer as framework interfaces → family abstract bases → target concrete classes. | Emerging |
| SPI at the lowest consuming layer | [`spi-at-lowest-consuming-layer.md`](./spi-at-lowest-consuming-layer.md) | When a lower layer needs to call a higher layer, the SPI interface is declared at the lowest layer whose types it depends on; both sides depend on the abstraction. | Stable |
| Interface + factory function (stateful services) | [`interface-plus-factory.md`](./interface-plus-factory.md) | Stateful services are exposed as an exported `interface` plus a `createXxx()` factory; the implementing class is private. | Stable |
| Adapter SPI for target-specific behaviour | [`adapter-spi.md`](./adapter-spi.md) | Target-specific behaviour is encapsulated behind an adapter interface the framework consumes uniformly; the framework never branches on `target === 'postgres'`. | Stable |
| Capability gating | [`capability-gating.md`](./capability-gating.md) | Optional or target-varying features are declared as capabilities, verified against the database at runtime, and gated at every consumption site. | Stable |
| Package layering: domains × layers × planes | [`package-layering.md`](./package-layering.md) | Packages are organised along three orthogonal axes (domains × layers × planes); imports flow downward and outward only, enforced by `pnpm lint:deps`. | Stable |

The status column reads **Stable** once an entry has at least two reference implementations in the codebase, and **Emerging** when a pattern has one shipped adopter plus a credible second adopter committed. _Three-layer polymorphic IR_ is the only Emerging entry in v1 — migration ops follow it today, and Contract IR / Schema IR adoption is in flight.

## How to add a new pattern

A new entry joins the catalogue when it earns its keep against four criteria:

1. **Recurrent.** At least two reference implementations exist in the codebase, or are explicitly committed to land via an in-flight project. One-off shapes stay as ADRs.
2. **Crosses subsystem boundaries.** Patterns that fit inside a single subsystem belong in that subsystem's doc; the catalogue is for shapes any contributor working anywhere in the codebase might need.
3. **Structural, not tactical.** "How to lay out an AST node" is structural; "use `pathe` for paths" is tactical and belongs as a Cursor rule.
4. **Earns its keep.** A speculative-future pattern with no current adopter does not belong here — wait for the second instance.

The process:

1. Copy [`_template.md`](./_template.md) to a new kebab-case slug.
2. Fill in every section — every claim must cite a reference implementation, an ADR, or a rule.
3. Add a row to the table above and link the slug.
4. Cross-link from any related ADRs, rules, or reference docs.
5. Open a PR. The **architect persona** ([`.agents/skills/drive-agent-personas/personas/architect.md`](../../../.agents/skills/drive-agent-personas/personas/architect.md)) owns the bar; tech-lead arbitrates if there is disagreement on whether the entry is ready.

## Related indexes

- [ADR index](../ADR-INDEX.md) — every architecture decision the codebase has recorded.
- [Package layering](../Package-Layering.md) — the canonical doc for the package-layering pattern; the catalogue's entry summarises and links here.
- [Reference docs](../../reference/) — subsystem how-to guides; the catalogue cross-links here for capability lists, codec authoring, query patterns, etc.
