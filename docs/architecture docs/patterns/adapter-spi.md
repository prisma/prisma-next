# Pattern: Adapter SPI for target-specific behaviour

**Status:** Stable
**Maintainer:** architect

## Intent

Target-specific behaviour (dialect emission, capability discovery, type expansion, default rendering, error mapping, marker reading) is encapsulated behind a single **adapter interface** that the framework consumes uniformly. The framework never branches on `target === 'postgres'`; targets register adapters and the framework dispatches through the adapter's methods. The adapter is the framework's only window onto target specificity.

Adopting this pattern commits you to: a stable adapter interface (every method the framework needs from a target lives on this surface), one adapter implementation per target (no per-feature ad-hoc `if-target` checks), and a registration / lookup mechanism that lets the framework find the adapter for the contract it is consuming.

## When to use

- Framework code needs target-specific behaviour at runtime — lowering an AST, rendering a dialect, mapping an error, checking a capability, reading the contract marker.
- The set of targets is open (more targets land over time) and the framework cannot enumerate them at compile time.
- The behaviour is **per-target**, not per-IR-kind. (Per-IR-kind variation is [Three-layer polymorphic IR](./three-layer-polymorphic-ir.md); per-layer dispatch is [SPI at the lowest consuming layer](./spi-at-lowest-consuming-layer.md).)

## When NOT to use

- **Code that is genuinely target-agnostic** — don't introduce an adapter call that always returns the same answer regardless of target. The adapter exists to capture variation; flat code paths should stay flat.
- **Variation expressible as abstract methods on a class hierarchy** the framework already owns — use [Three-layer polymorphic IR](./three-layer-polymorphic-ir.md). The adapter interface is for behaviour the framework does not (and should not) know how to model itself.
- **One-off branches inside a single subsystem** with no plausible second adopter — gate the branch and surface as debt; an adapter SPI for one target is a misnamed concrete type.

## Structure

```typescript
// framework-defined adapter interface (one adapter per target)
export interface Adapter<Ast, TContract, TBody> {
  readonly profile: AdapterProfile;
  lower(ast: Ast, context: LowererContext<TContract>): TBody;
}

export interface AdapterProfile<TTarget extends string = string> {
  readonly id: string;
  readonly target: TTarget;
  readonly capabilities: Record<string, unknown>;
  readMarkerStatement(): MarkerStatement;
  parseMarkerRow(row: unknown): ContractMarkerRecord;
}

// per-target implementer (target package)
class PostgresAdapterImpl implements Adapter<AnyQueryAst, PostgresContract, PostgresLoweredStatement> {
  // …per-target lowering, marker SQL, capability profile…
}

export function createPostgresAdapter(options?: PostgresAdapterOptions) {
  return Object.freeze(new PostgresAdapterImpl(options));
}
```

The framework code that needs target-specific behaviour calls a method on the `Adapter` (`adapter.lower(ast, ctx)`, `adapter.profile.readMarkerStatement()`, `adapter.profile.capabilities[…]`); it never asks "is this Postgres?". The adapter is exposed via [Interface + factory function](./interface-plus-factory.md), so the implementation class is private.

## Reference implementations

| Implementation | Path | Demonstrates |
|---|---|---|
| Framework `Adapter` interface | [`packages/2-sql/4-lanes/relational-core/src/ast/adapter-types.ts`](../../../packages/2-sql/4-lanes/relational-core/src/ast/adapter-types.ts) | The SQL family's adapter interface; the framework's only contract for SQL targets. |
| `PostgresAdapter` (canonical example) | [`packages/3-targets/6-adapters/postgres/src/core/adapter.ts`](../../../packages/3-targets/6-adapters/postgres/src/core/adapter.ts) | The Postgres implementation; private `PostgresAdapterImpl`, factory-exposed; capability profile, marker SQL, and lowering all live here. |
| Visitor-as-SPI variant | per [ADR 198](../adrs/ADR%20198%20-%20Runner%20decoupled%20from%20driver%20via%20visitor%20SPIs.md) | The runtime layer applies the same shape as a visitor SPI: the runner depends on a visitor interface and the driver implements it. |

## Related ADRs

- [ADR 005 — Thin Core Fat Targets](../adrs/ADR%20005%20-%20Thin%20Core%20Fat%20Targets.md) — the framing principle; targets carry the weight, the framework stays neutral.
- [ADR 016 — Adapter SPI for Lowering](../adrs/ADR%20016%20-%20Adapter%20SPI%20for%20Lowering.md) — the codifying decision for the lowering half of the adapter contract.
- [ADR 031 — Adapter capability discovery & negotiation](../adrs/ADR%20031%20-%20Adapter%20capability%20discovery%20&%20negotiation.md) — the capability half of the adapter contract.
- [ADR 065 — Adapter capability schema & negotiation v1](../adrs/ADR%20065%20-%20Adapter%20capability%20schema%20&%20negotiation%20v1.md) — the v1 capability schema the adapter exposes.
- [ADR 198 — Runner decoupled from driver via visitor SPIs](../adrs/ADR%20198%20-%20Runner%20decoupled%20from%20driver%20via%20visitor%20SPIs.md) — the runtime-layer variant of the same shape.

## Related patterns

- [Capability gating](./capability-gating.md) — capabilities live on the adapter's `profile`; the gating pattern is how consumers consult them.
- [SPI at the lowest consuming layer](./spi-at-lowest-consuming-layer.md) — the adapter is itself an SPI, with a stronger naming convention. The general SPI pattern's layering rules apply.
- [Interface + factory function](./interface-plus-factory.md) — the `Adapter` is exposed as an interface + factory; the two patterns compose.

## Related rules

- [`.cursor/rules/no-target-branches.mdc`](../../../.cursor/rules/no-target-branches.mdc) — the tactical enforcement: never branch on target string in core code; route the variation through an adapter call. The pattern entry is the structural rationale this rule encodes.

## Cautions / common mistakes

- **Smuggling a target check past the adapter.** Code that does `adapter.profile.target === 'postgres'` defeats the pattern — it is `if-target` with an extra hop. Architect-persona check: the framework consumes adapter methods, not adapter identity.
- **Adapter interface that grows by accretion.** Every new framework caller adds a method, the interface bloats, and adapters become hard to implement. Surface as debt and decompose; consider whether the new caller is really framework code or really subsystem code.
- **One-target adapter SPIs.** An adapter interface with a single permanent implementer is over-abstracted; collapse to a concrete type until the second target exists.
- **Branching inside the adapter on target the adapter is for.** A `PostgresAdapter` does not need to ask "is this Postgres?" — it _is_ Postgres. If it asks, the wrong abstraction is in play.
