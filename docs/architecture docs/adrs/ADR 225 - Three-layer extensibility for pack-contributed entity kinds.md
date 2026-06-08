# ADR 225 — Three-layer extensibility for pack-contributed entity kinds

**Status:** Accepted
**Date:** 2026-06-08

---

## Context

A pack-contributed entity kind — an RLS policy, a Postgres role, a materialised view — must be addressable at three distinct layers:

1. **Contract / Schema IR** — the in-memory class that represents the entity after lowering, carries its data as frozen properties, and hashes deterministically.
2. **Semantic lowering** — the bridge from a parsed source node to the IR class instance.
3. **PSL parse and print** — reading the entity from PSL source text and writing it back.

Each layer has its own extension point. Before this ADR the three layers had no shared vocabulary to tie a contribution across all of them — there was no documented pattern establishing that one string (the `discriminator`) connects all three, or that the three-layer IR hierarchy is the right shape for the IR layer.

## Decision

A pack-contributed entity kind is fully registered when it provides:

1. **An IR class** following the three-layer polymorphic IR pattern ([`three-layer-polymorphic-ir.md`](../patterns/three-layer-polymorphic-ir.md)): the class hierarchy is framework interface → family abstract base → target concrete class, with `freezeNode(this)` (or `Object.freeze(this)`) called in the constructor.

2. **An `entityTypes` factory** in `AuthoringContributions.entityTypes`, keyed by a path in the contribution's namespace. The factory carries the `discriminator` string and an `output.factory: (input, ctx) => IRNode` function that constructs the IR class instance from the lowering input.

3. **A `pslBlockDescriptors` entry** in `AuthoringContributions.pslBlockDescriptors` — an `AuthoringPslBlockDescriptor` carrying the same `discriminator` as the `entityTypes` factory. The framework uses the discriminator to route a parsed `PslExtensionBlock` to the right lowering factory.

The `discriminator` string ties all three together. It is the routing key in both directions:
- Parser → lowering: the `PslExtensionBlock.kind` is set to `descriptor.discriminator`; the lowering machinery looks up the factory by that key.
- IR → PSL: the printer looks up the descriptor by discriminator to reconstruct the PSL block from the IR node.

Convention: `<target-or-family>-<kind>`, e.g. `postgres-policy-select`.

## The three layers in detail

### Layer 1 — IR class (three-layer polymorphic IR)

The IR class follows the three-layer polymorphic IR pattern so framework-level tooling (hashing, walking, serialisation) can process contributed entities generically:

```
framework interface      → minimum contract every entity satisfies
family abstract base     → refines for the family's persistence model
target concrete class    → the contributed entity kind; freezes itself in the constructor
```

The concrete class is frozen at construction (`freezeNode(this)` from the frozen-class-ast pattern, or `Object.freeze(this)` directly). This is part of the [frozen-class-ast pattern](../patterns/frozen-class-ast.md); combined with the three-layer hierarchy it is the [three-layer-polymorphic-ir pattern](../patterns/three-layer-polymorphic-ir.md).

Pack-contributed kinds need not have a family intermediate layer if the family adds nothing for that kind — target-only kinds satisfy the framework interface directly.

### Layer 2 — `entityTypes` factory

The factory is registered on `AuthoringContributions.entityTypes`. It carries:
- `kind: 'entity'` — identifies it as an entity-type descriptor.
- `discriminator` — the shared routing key.
- `output.factory: (input, ctx) => IRNode` — constructs the IR class instance from the lowering input. The framework calls this after the PSL node is parsed (or after the TS DSL helper is invoked).

The factory may also carry an optional `validatorSchema` (an arktype `Type`) that validates the raw input before calling `factory`.

### Layer 3 — `pslBlockDescriptors` entry

The PSL block descriptor is registered on `AuthoringContributions.pslBlockDescriptors` and carries:
- `kind: 'pslBlock'`
- `keyword` — the PSL top-level identifier this descriptor claims.
- `discriminator` — same value as the `entityTypes` factory.
- `name.required` — whether the block must have a name token.
- `parameters` — a map of `PslBlockParam` descriptors (`ref` / `value` / `option` / `list`).

The framework enforces at load time that every `pslBlockDescriptors` entry has a matching `entityTypes` factory with the same discriminator (`assertPslBlocksHaveFactories`). An `entityTypes` factory may exist without a `pslBlockDescriptors` entry (e.g. for kinds only reachable via the TS DSL).

## How the three layers connect at runtime

```
PSL source text
  └─→ generic framework parser
        reads block into PslExtensionBlock { kind: discriminator, name, parameters }
  └─→ generic validator
        checks parameters against the descriptor
  └─→ entityTypes factory (looked up by discriminator)
        constructs the IR class instance
  └─→ IR class instance stored in namespace.entries[discriminator][name]
        (per ADR 224's entries coordinate model)
  └─→ generic printer (for `contract infer`)
        looks up the descriptor by discriminator and reconstructs PSL from the IR node
```

The namespace's `entries[discriminator][name]` path mirrors the IR layer's coordinate model (see [ADR 224](ADR%20224%20-%20Namespace%20concretions%20address%20entities%20by%20coordinate.md)), so a generic walker that reads `entries` structurally reaches both built-in and contributed kinds without knowing their names ahead of time.

## Consequences

**All three layers share one string.** A contribution's `discriminator` is the only piece of information needed to connect the parsed PSL node to the IR class and back to PSL text. Contributions cannot accidentally mismatch layers — the load-time `assertPslBlocksHaveFactories` check catches a descriptor with no matching factory, and the printer fails at dispatch if a discriminator has no descriptor.

**The framework adds no per-kind knowledge.** Generic parser, validator, printer, and walkers handle any contributed kind through structural dispatch on `entries` and discriminator lookup. The framework does not learn new keyword names.

**PSL extension blocks are coordinate-addressable on the same terms as built-in kinds.** `namespace.entries[discriminator][name]` works for `policy_select` exactly as `namespace.entries['model'][name]` works for `model`.

**Adding a kind is additive.** Registering a new `(descriptor, factory, IR class)` triple does not require changes to the framework parser, printer, or walker.

## References

- [Three-layer polymorphic IR pattern](../patterns/three-layer-polymorphic-ir.md)
- [Frozen-class AST + visitor pattern](../patterns/frozen-class-ast.md)
- [JSON-canonical / class-in-memory round-trip pattern](../patterns/json-canonical-class-in-memory.md)
- [ADR 126 — PSL top-level block SPI](ADR%20126%20-%20PSL%20top-level%20block%20SPI.md) — the declarative descriptor SPI this pattern depends on for layer 3
- [ADR 221 — Contract IR two planes with uniform entity coordinate](ADR%20221%20-%20Contract%20IR%20two%20planes%20with%20uniform%20entity%20coordinate%20and%20pack-contributed%20entity%20kinds.md) — the coordinate model
- [ADR 224 — Namespace concretions address entities by coordinate](ADR%20224%20-%20Namespace%20concretions%20address%20entities%20by%20coordinate.md) — `entries[kind][name]` in the IR and PSL AST
