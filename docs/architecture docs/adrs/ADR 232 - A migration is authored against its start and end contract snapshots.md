# ADR 232 — A migration is authored against its start and end contract snapshots

## At a glance

A migration takes the two contract snapshots it moves between as its inputs. It assigns them to the base class and writes its operations; it states nothing else about the transition:

```ts
import endContract from './end-contract.json' with { type: 'json' };
import type { Contract as End } from './end-contract';

class M extends Migration<never, End> {
  override readonly endContractJson = endContract;
  override get operations() {
    return [ createCollection('carts', { validator: { $jsonSchema: { /* … */ } } }), /* … */ ];
  }
}
```

From those snapshots the base supplies the two things every migration needs: the transition's identity, and typed access to the contract by name.

```ts
this.endContract.collection.carts.validator   // typed; no namespace sentinel / entries / kind spelled
```

## Decision

A migration is the step that moves a database from one contract to the next. The state it starts from and the state it produces are what define it, so a migration takes those two contracts — its **start** and **end** snapshots — as its inputs. Each migration directory carries them as committed, immutable artifacts (`start-contract.json` / `end-contract.json` and their `.d.ts` types); the migration assigns them to `startContractJson` / `endContractJson`.

Two things follow from holding the snapshots, and the base owns both:

1. **Identity.** `describe()` returns `{ to: endContractJson.storage.storageHash, from: startContractJson?.storage.storageHash ?? null }`. A migration's from/to identity is a property of the two states it names, read from them directly.
2. **Typed access.** The family bases (`MongoMigration`, `SqliteMigration`, `PostgresMigration`) expose lazy, memoized `startContract` / `endContract` getters — a `ContractView` over each snapshot — so hand-written migration logic reaches entities by name.

A migration that carries no contract — an extension-install migration that only issues DDL, say — overrides `describe()` directly and sets no snapshot fields.

## Identity is read from the snapshot

`storage.storageHash` is a property of any contract, target-independent, so identity derivation lives on the framework `Migration` base. The runner consumes a migration through `origin` / `destination`, each `{ storageHash }`, and those project straight from the snapshots the migration ships. There is a single source for a migration's identity — the snapshots in its own directory — so its declared transition and the contracts it carries cannot disagree.

## Typed access: the `ContractView`

A snapshot is the raw contract: a faithful mirror of the serialized form, with entities at their full storage coordinate, `storage.namespaces.<id>.entries.<kind>.<name>`. That coordinate is exact but not an authoring surface — it spells a namespace-binding sentinel, an `entries` dictionary, and a kind key, none of which carry meaning for someone writing a migration.

`ContractView` presents the same entities by name. It is a **superset of the contract** — usable anywhere the contract is — constructed by a `from` / `fromJson` factory, and it unwraps each target's default namespace:

| Target | Access | Namespace handling |
| --- | --- | --- |
| Mongo | `view.collection.<name>` | single namespace unwrapped to the root |
| SQLite | `view.table.<name>`, `view.valueSet.<name>` | single namespace unwrapped to the root |
| Postgres | `view.namespace.<schema>.table.<name>` | schemas addressed under a fixed `namespace` member |

The ergonomics live on the view; the contract type stays raw. Because the view is a projection computed from whatever contract it is given, the emitter and serializers own no part of it — nothing about the accessor is baked into the emitted artifact.

### Schemas are addressed under a member, not the contract root

The view shares one namespace projection with the runtime `enums` surface: a namespace-keyed map, `view.namespace.<schema>`, with the default namespace unwrapped for single-namespace targets. A multi-namespace target keeps the schema as a coordinate under the fixed `namespace` member. Schema names are user-chosen, so a schema named like a contract field (`storage`, `domain`) placed at the contract root would shadow that field, invisibly to the type system. Addressing schemas under `namespace` makes the collision impossible, while a single-namespace target still reads its entities flat.

## Generated schema, hand-authored transforms

Schema operations are a pure function of the contract diff, so the migration generator emits them in full and reads nothing from the contract at author time. The snapshots are on the class for the two things a diff cannot produce: the base's identity derivation, and hand-written logic.

That second case — a data migration, such as a backfill — is the `ContractView`'s home. Its logic cannot be synthesized from a schema diff; an author writes it, and `this.endContract` is where that code reads entity metadata by name. The view is a convenience exactly where authoring happens by hand, not over coordinates that generated code never spells.

## Consequences

- A migration's identity is read from the contract snapshots in its own directory; there is no separate hash for an author to keep in step.
- A migration's authored scaffold is a function of its snapshots and its operations, so re-emitting the scaffold leaves the migration's behaviour — its `ops.json` / `migration.json` — unchanged.
- Every migration has typed contract access; the type flows from the per-migration `end-contract.d.ts` through the family base's view getter.
- The base carries optional snapshot fields and a concrete `describe()` that a subclass may override, so a migration with no contract is still a valid migration.

## Alternatives considered

- **A hand-written `describe()` carrying the from/to hashes as literals.** The identity restated as strings beside the file that already holds the contracts those strings summarize — two sources for one fact, kept in step by the author. Rejected.
- **An accessor method on the contract type.** The author-facing contract is data-only — its emitted `.d.ts` declares no methods — so a getter there is invisible to author code, and it would couple the emitter to a convenience concern. Rejected in favour of a separate view.
- **Denormalised accessor data emitted into the contract artifact.** Duplicates every entity in the canonical artifact and invites drift between the copies. Rejected.
- **A view with schema names at the contract root.** A schema named like a contract field silently shadows it, uncaught by the type system. Rejected in favour of addressing schemas under a `namespace` member.
- **Free helper functions over the contract** (`tables(contract)`, `collections(contract)`). Workable, but scatters the surface and gives the projection no single home. Rejected in favour of one view object.

## References

- ADR 224 — Namespace concretions address entities by coordinate (the raw coordinate the view projects from).
- ADR 225 — Three-layer extensibility for pack-contributed entity kinds (the `entries` dictionary the view reads).
- ADR 223 — Target-owned default namespace (the default-namespace sentinel the view unwraps).
- [`docs/architecture docs/patterns/interface-plus-factory.md`](../patterns/interface-plus-factory.md) — the `from` / `fromJson` factory shape.
