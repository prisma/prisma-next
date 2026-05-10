# Pattern: Three-layer polymorphic IR (framework → family → target)

**Status:** Emerging
**Maintainer:** architect

> **Status note.** This pattern is currently the convention for migration ops and is being extended to Contract IR and Schema IR by in-flight work. v1 catalogue ships it as **Emerging** because the second-and-third adopters are committed but not yet shipped; promote to **Stable** once Contract IR / Schema IR land.

## Intent

IRs that cross the framework/target boundary are layered as **framework interfaces and abstract bases → family abstract bases → target concrete classes**. The framework declares the minimum every target must satisfy; the family refines for SQL-shaped or document-shaped persistence; the target ships concrete classes _and_ target-only kinds with no family parent. Consumers above the framework layer dispatch through the framework interface; consumers inside a family dispatch through the family abstract base; the target is the only place that knows its own kind set.

Adopting this pattern commits you to: a clear minimum contract at the framework layer (no leaking target-specific concepts upward), a family layer that names the shape's domain (`SqlMigrationOp`, `DocumentMigrationOp`), and a target layer that is free to introduce kinds the framework cannot anticipate (Postgres extensions, MySQL databases, Mongo aggregation stages) without forcing every other target to model them.

## When to use

- The IR is consumed at multiple layers (framework tooling, family-level lowering, target-specific rendering).
- Targets must extend the framework's set of kinds with target-only kinds (e.g. Postgres `CREATE EXTENSION`, Mongo collection options) — the framework cannot enumerate them ahead of time.
- The framework needs a stable contract to walk the IR (validation, hashing, display) without knowing the target's full kind set.
- The IR is already a [Frozen-class AST + visitor](./frozen-class-ast.md) (this pattern is the layering rule for that one when it crosses the framework/target boundary).

## When NOT to use

- **IRs that are inherently target-uniform.** The unified Plan model is the canonical counter-example: every target lowers _into_ this shape; no target extends it. See [ADR 011 — Unified Plan Model](../adrs/ADR%20011%20-%20Unified%20Plan%20Model.md).
- **Framework-only types** with no target-specific extension surface — the family and target layers are dead weight; skip them.
- **Target-internal types** that the framework never touches — keep them inside the target package; this pattern is for shapes that cross layers.
- **Stateful services** — see [Interface + factory function](./interface-plus-factory.md). Layering services this way over-engineers the contract.

## Structure

```
┌─────────────────────────────────────────────────────────────┐
│ framework layer (target-agnostic)                           │
│   interface OpFactoryCall { factoryName; operationClass; …} │
│   — the minimum contract every target must satisfy           │
└────────────────────────────┬────────────────────────────────┘
                             │ extends
┌────────────────────────────▼────────────────────────────────┐
│ family layer (SQL-shaped, document-shaped, …)               │
│   abstract class SqlMigrationOpNode  implements OpFactoryCall│
│   — refines for the family's persistence model               │
└────────────────────────────┬────────────────────────────────┘
                             │ extends
┌────────────────────────────▼────────────────────────────────┐
│ target layer (Postgres, MySQL, Mongo, …)                    │
│   abstract class PostgresOpFactoryCallNode extends … (or     │
│   directly implements the framework interface for             │
│   target-only kinds)                                          │
│   class CreateTableCall extends PostgresOpFactoryCallNode    │
│   class CreateExtensionCall extends PostgresOpFactoryCallNode│
│   — concrete classes; free to add kinds the framework        │
│     cannot anticipate                                         │
└─────────────────────────────────────────────────────────────┘
```

The framework layer's contract is intentionally minimal — `factoryName`, `operationClass`, `label`. Anything richer requires lifting concepts the framework has no business knowing about. Family-specific or target-specific consumers narrow downward to the layer they actually need.

## Reference implementations

| Implementation | Path | Demonstrates |
|---|---|---|
| Framework `OpFactoryCall` interface | [`packages/1-framework/1-core/framework-components/src/control/control-migration-types.ts`](../../../packages/1-framework/1-core/framework-components/src/control/control-migration-types.ts) (search for `export interface OpFactoryCall`) | The minimum contract every target's migration-op IR satisfies. |
| Postgres target concrete classes | [`packages/3-targets/3-targets/postgres/src/core/migrations/op-factory-call.ts`](../../../packages/3-targets/3-targets/postgres/src/core/migrations/op-factory-call.ts) | `PostgresOpFactoryCallNode` abstract base implementing the framework interface; concrete `CreateTableCall`, `AddColumnCall`, etc.; **plus** target-only kinds like `CreateExtensionCall` with no family analog. |
| Mongo target concrete classes | [`packages/3-mongo-target/1-mongo-target/src/core/op-factory-call.ts`](../../../packages/3-mongo-target/1-mongo-target/src/core/op-factory-call.ts) | The same layering on the document side; demonstrates the pattern is family-shaped, not Postgres-shaped. |

Forthcoming reference implementations (in flight): Contract IR and Schema IR are being layered onto this pattern by the in-flight target-extensible IR work. The pattern entry will be promoted to **Stable** and gain those references when they ship.

## Related ADRs

- [ADR 195 — Planner IR with two renderers](../adrs/ADR%20195%20-%20Planner%20IR%20with%20two%20renderers.md) — establishes the IR shape this pattern layers.
- [ADR 005 — Thin Core Fat Targets](../adrs/ADR%20005%20-%20Thin%20Core%20Fat%20Targets.md) — the architecture principle this pattern operationalises.
- [ADR 011 — Unified Plan Model](../adrs/ADR%20011%20-%20Unified%20Plan%20Model.md) — the canonical counter-example: a target-uniform IR that does **not** layer this way.

## Related patterns

- [Frozen-class AST + visitor](./frozen-class-ast.md) — the in-class shape this pattern layers across framework / family / target.
- [JSON-canonical / class-in-memory round-trip](./json-canonical-class-in-memory.md) — the persistence pattern that target-extensible IRs typically also adopt.
- [Adapter SPI for target-specific behaviour](./adapter-spi.md) — the alternative when the variation is _behaviour_ (lowering, error mapping) rather than _data shape_.

## Cautions / common mistakes

- **Lifting target concepts to the framework layer to "share code".** If the framework interface gains a field that only one target uses, the layering is leaking; either move the field to the family layer or accept that the framework's contract is wider than it should be.
- **Family layer as dead weight.** A family layer that adds nothing beyond `extends` is a noise. If the family doesn't refine the contract, drop the layer for that IR.
- **Target-only kinds with no framework parent.** This is **expected**, not a violation — Postgres `CreateExtensionCall` is intentionally a target-only kind. Architect-persona check: target-only kinds should still satisfy the framework interface (`factoryName`, `label`, etc.) so framework-level walks don't have to special-case them.
