# Pattern: JSON-canonical / class-in-memory round-trip

**Status:** Stable
**Maintainer:** architect

## Intent

The canonical persistent artifact is **JSON**; the canonical in-memory form is a **class hierarchy** whose plain readonly fields serialize through `JSON.stringify` without a custom `toJSON()`. Hydration validates JSON shape (with arktype) then constructs class instances from the `kind` discriminant. Identity, attestation, replay, and audit key off the JSON; in-memory consumers walk class instances polymorphically.

Adopting this pattern commits you to: a single source-of-truth shape per node (no parallel "JSON DTO" / "in-memory class" pair drifting apart), JSON-clean fields on every class (no `Map`, `Set`, `Date`, or methods on properties), and validation at the JSON boundary (the boundary is where untrusted shape becomes trusted instances).

## When to use

- The artifact persists across processes (planner emits, runner consumes; tooling emits, runtime consumes).
- Reproducibility, attestation, or auditability requires a stable byte-level form — for example, content-addressed hashes computed over the JSON.
- In-memory consumers benefit from polymorphic dispatch over a kind-discriminated tree (typically pairs with [Frozen-class AST + visitor](./frozen-class-ast.md)).
- The artifact must be reviewable as data — diffable in PRs, greppable in incidents, parseable by tools that have no TypeScript runtime.

## When NOT to use

- **Transient values that never persist** — a frozen plain object is enough; the JSON contract adds no value.
- **Configuration objects with no polymorphism** — `Record<string, T>` over a typed value is simpler than a class hierarchy.
- **Hot-path runtime structures** where the JSON serialise/parse cost matters (or where field types genuinely need `Map` / `Set` / `Date` semantics) — model the persistent form separately and accept the dual-shape cost as deliberate.
- **Stateful services** — use [Interface + factory function](./interface-plus-factory.md). A service has a lifecycle; this pattern is for data.

## Structure

```
            authoring                      apply / consume
                │                                 ▲
                ▼                                 │
   ┌─────────────────────┐         ┌──────────────────────────┐
   │  class instances    │── JSON.stringify ───►│  ops.json    │
   │  (frozen AST nodes) │                      │  contract.json│
   │  with `kind` field  │◄── arktype validate ──│              │
   └─────────────────────┘         └──────────────────────────┘
            ▲                                 │
            │                                 ▼
       in-memory                     content-addressed,
       polymorphic                   reviewable, replayable
       dispatch                      across processes
```

The classes have **plain readonly fields only** — no methods on properties, no JS types that don't have a stable JSON form. Hydration walks the JSON, switches on `kind`, and calls the matching constructor; the constructor calls `Object.freeze(this)` (per [Frozen-class AST + visitor](./frozen-class-ast.md)). Identity (hashes, attestation) is computed over the canonical JSON, never over the in-memory representation.

## Reference implementations

| Implementation | Path | Demonstrates |
|---|---|---|
| Migration `ops.json` (Mongo) | [`packages/3-mongo-target/1-mongo-target/src/core/op-factory-call.ts`](../../../packages/3-mongo-target/1-mongo-target/src/core/op-factory-call.ts) | `OpFactoryCall` classes serialise via `JSON.stringify` to `ops.json`; the runner rehydrates and walks the same class hierarchy at apply time. |
| Migration `ops.json` (Postgres) | [`packages/3-targets/3-targets/postgres/src/core/migrations/op-factory-call.ts`](../../../packages/3-targets/3-targets/postgres/src/core/migrations/op-factory-call.ts) | Same shape on the SQL side; demonstrates the pattern is target-agnostic. |
| Mongo wire commands | [`packages/2-mongo-family/6-transport/mongo-wire/src/wire-commands.ts`](../../../packages/2-mongo-family/6-transport/mongo-wire/src/wire-commands.ts) | Wire commands round-trip natively because MongoDB commands _are_ JSON; the canonical example of the pattern's "JSON is the contract" property. |

Forthcoming reference implementations (in flight): Contract IR and Schema IR are being moved onto this pattern by the in-flight target-extensible IR work. The pattern entry will gain those references when they ship.

## Related ADRs

- [ADR 192 — ops.json is the migration contract](../adrs/ADR%20192%20-%20ops.json%20is%20the%20migration%20contract.md) — the codifying decision: JSON is what gets attested and replayed; classes are the authoring sugar that emits it.
- [ADR 196 — In-process emit for class-flow targets](../adrs/ADR%20196%20-%20In-process%20emit%20for%20class-flow%20targets.md) — companion decision for the emit half of the round-trip.
- [ADR 097 — Tooling runs on canonical JSON only](../adrs/ADR%20097%20-%20Tooling%20runs%20on%20canonical%20JSON%20only.md) — extends the principle from migrations to the contract.
- [ADR 098 — Runtime accepts contract object or JSON](../adrs/ADR%20098%20-%20Runtime%20accepts%20contract%20object%20or%20JSON.md) — the runtime side of the same boundary.

## Related patterns

- [Frozen-class AST + visitor](./frozen-class-ast.md) — the in-memory half. Almost every adopter of this pattern is also an adopter of that one; the two compose.
- [Three-layer polymorphic IR](./three-layer-polymorphic-ir.md) — the layering pattern that JSON-canonical IRs typically follow when targets extend the framework's kind set.

## Cautions / common mistakes

- **Non-JSON-clean fields.** A `Map`, `Set`, `Date`, or method-on-property field will silently round-trip wrong (a `Date` becomes a string; a `Map` becomes `{}`). Architect-persona check: every class field is a plain readonly value of a type with a stable JSON encoding.
- **Custom `toJSON()`.** Once a class needs a custom `toJSON()` to serialise correctly, the in-memory shape and the JSON shape have diverged — the round-trip is no longer canonical. Surface the divergence rather than papering over it with `toJSON()`.
- **Hashing the in-memory form.** Identity must key off the JSON, not the class instances; in-memory representations can vary by Node version, by frozen-state, by V8 internals. The JSON is the only stable byte stream.
- **Skipping arktype validation at the boundary.** A consumer that constructs class instances from an unverified JSON shape inherits every drift, every renamed field, every off-by-one-version mismatch. Validate at the boundary; trust inside it.
