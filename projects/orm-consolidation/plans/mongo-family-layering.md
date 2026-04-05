# MongoDB Family — Package Layering

Defines the layer and package structure for `packages/2-mongo-family/`. Each numbered directory is a **layer** (a conceptual category); each sub-directory within a layer is a **package** (a workspace project with its own `package.json`). Layers may contain multiple packages. Packages within the same layer are peers and may import from each other.

## Design principles

1. **Layers are concepts, packages are inhabitants.** A layer name should be a category that accommodates growth — never a single package name.
2. **Package directory = package name.** The directory name matches the `name` field in `package.json` (minus the `@prisma-next/` scope). No indirection — you can identify any package at a glance without opening `package.json`.
3. **Singular names for interface/type packages.** `mongo-codec` (the interface for defining a codec), not `mongo-codecs` (a bag of codec implementations). Concrete collections belong in the `family` or `target` layers.
4. **No name collisions with the target domain.** The target domain (`packages/3-mongo-target/`) owns `adapter-mongo` and `driver-mongo`. Family-domain packages must not shadow those names.
5. **Foundation packages have bounded responsibilities.** Each package name limits what can accumulate in it.
6. **Transport spans both planes.** The adapter and driver operate in both migration (control) and runtime (execution) planes. The transport layer is plane: shared.

## Layer order

```json
"mongo": ["foundation", "authoring", "tooling", "query", "query-builders", "transport", "runtime", "family"]
```

Higher layers may import from lower layers. Same-layer packages may import from each other. Upward imports are forbidden.

## Structure

```
packages/2-mongo-family/

  1-foundation/                         LAYER: foundation
  │  mongo-contract/                      @prisma-next/mongo-contract
  │  │  contract-types.ts                   MongoContract, MongoStorage, MongoModelStorage,
  │  │                                      MongoTypeMaps, InferModelRow
  │  │  contract-schema.ts                  Arktype structural schemas
  │  │  validate-mongo-contract.ts          Validation entry point + indices
  │  │  validate-storage.ts                 Storage-specific validation rules
  │  │  validate-domain.ts                  Re-export of framework domain validation
  │  │
  │  mongo-codec/                         @prisma-next/mongo-codec
  │  │  codecs.ts                           MongoCodec interface, mongoCodec() factory, trait types
  │  │  codec-registry.ts                   MongoCodecRegistry interface + createMongoCodecRegistry()
  │  │  codec-types.ts                      Static codec type map (CodecTypes)
  │  │
  │  mongo-value/                         @prisma-next/mongo-value
  │     values.ts                           MongoValue, Document, RawPipeline, MongoExpr, etc.
  │     param-ref.ts                        MongoParamRef

  2-authoring/                          LAYER: authoring
  │  mongo-contract-psl/                  @prisma-next/mongo-contract-psl

  3-tooling/                            LAYER: tooling
  │  mongo-emitter/                       @prisma-next/mongo-emitter

  4-query/                              LAYER: query
  │  mongo-query-ast/                     @prisma-next/mongo-query-ast
  │                                       AST nodes, filter expressions, read stages,
  │                                       command classes, visitors, MongoReadPlan,
  │                                       MongoQueryPlan (unified)

  5-query-builders/                     LAYER: query-builders
  │  mongo-orm/                           @prisma-next/mongo-orm

  6-transport/                          LAYER: transport (plane: shared)
  │  mongo-wire/                          @prisma-next/mongo-wire
  │  │                                    Wire command classes, result types
  │  │
  │  mongo-lowering/                      @prisma-next/mongo-lowering
  │                                       MongoAdapter i/f, MongoLoweringContext,
  │                                       MongoDriver i/f

  7-runtime/                            LAYER: runtime
  │  mongo-runtime/                       @prisma-next/mongo-runtime

  9-family/                             LAYER: family
  │  family-mongo/                        @prisma-next/family-mongo
```

## Foundation packages

The current `1-core` (`@prisma-next/mongo-core`) splits into three packages with zero cross-dependencies:

| Package | Responsibility | Depends on |
|---|---|---|
| `mongo-contract` | Contract shape and validation | framework contract types, arktype |
| `mongo-codec` | Codec interface, factory, registry | nothing Mongo-specific |
| `mongo-value` | Primitive value types (`MongoValue`, `Document`, `RawPipeline`, `MongoParamRef`) | nothing |

The names bound what each package can accumulate. You wouldn't put wire commands in `mongo-contract`, validation in `mongo-codec`, or adapter interfaces in `mongo-value`.

## Transport packages

The transport layer splits into two packages, separating data structures from behavioral contracts:

| Package | Responsibility | Depends on |
|---|---|---|
| `mongo-wire` | Wire command classes (`InsertOneWireCommand`, etc.), result types (`InsertOneResult`, etc.) | `mongo-value` (wire commands use `Document`) |
| `mongo-lowering` | `MongoAdapter` interface, `MongoDriver` interface, `MongoLoweringContext` | `mongo-wire` (adapter produces wire commands, driver consumes them), `mongo-query-ast` (adapter consumes AST types), `mongo-contract` (lowering context) |

`mongo-wire` is stable vocabulary — pure data structures with no behavioral interfaces. Consumers that only need wire command types (e.g. test stubs) don't pull in the adapter/driver contracts.

## What moves from `1-core`

> **Migration required.** Wire command classes, result types, and the `MongoAdapter`/`MongoDriver` interfaces currently live in `1-core` (`@prisma-next/mongo-core`). They are misplaced there — nothing above the transport boundary needs wire-level types, and the adapter interface can't meaningfully reference query-layer AST types from layer 1 (which is why the `MongoQueryPlanLike` structural shim exists). These items must be migrated to the `transport` layer as part of the layering reorganization.

| Item | From | To | Rationale |
|---|---|---|---|
| `MongoAdapter` interface | `1-core` | `6-transport/mongo-lowering` | Needs to reference AST types (layer 4); can't do that from layer 1 |
| `MongoDriver` interface | `1-core` | `6-transport/mongo-lowering` | Behavioral contract co-located with adapter |
| Wire command classes | `1-core` | `6-transport/mongo-wire` | Adapter output / driver input — belongs at the transport boundary |
| Result types | `1-core` | `6-transport/mongo-wire` | Driver output types |
| `MongoQueryPlanLike` shim | `1-core` | **deleted** | Exists only because adapter can't see real AST types from layer 1; once the adapter interface moves to `transport` (above `query`), it can import `MongoQueryPlan` directly |

## What stays in ORM

`MongoQueryExecutor` stays in `mongo-orm` (query-builders layer). The ORM defines the interface it depends on; the runtime structurally satisfies it. This follows dependency inversion — no move needed.

## Unified query plan

A new `MongoQueryPlan` type is introduced in `4-query/mongo-query-ast` — a discriminated union encompassing both read plans and command AST nodes. This replaces the current bifurcated executor interface (`execute` + `executeCommand`) with a single `execute(plan: MongoQueryPlan)` method. See [unified-mongo-query-plan.md](unified-mongo-query-plan.md).

## Dependency flow

```
9-family ──→ 7-runtime ──→ 6-transport/{lowering, wire} ──→ 4-query ──→ 1-foundation
                │                     │                                      ↑
                │                     └── 1-foundation/{contract, codec, value}
                │                                                            │
                └────────────────────────────────────────────────────────────┘
                                                                             ↑
           5-query-builders/mongo-orm ──→ 4-query ──→ 1-foundation/{contract, value}

           3-tooling/mongo-emitter ──→ 2-authoring ──→ 1-foundation/mongo-contract
```

### Within the transport layer

```
mongo-lowering ──→ mongo-wire ──→ mongo-value (foundation)
      │
      └──→ mongo-query-ast (query layer — AST types for adapter interface)
      └──→ mongo-contract (foundation — lowering context)
```

## Target domain (concretions)

```
packages/3-mongo-target/
  target-mongo/              @prisma-next/target-mongo       target descriptor
  adapter-mongo/             @prisma-next/adapter-mongo      implements MongoAdapter
  driver-mongo/              @prisma-next/driver-mongo       implements MongoDriver
```

The target domain imports from `mongo-lowering` for the interfaces it implements, from `mongo-wire` for wire command types, from `mongo-query-ast` for AST types it pattern-matches during lowering, and from `mongo-value` for value types.

## Room for growth

| Layer | Current packages | Future possibilities |
|---|---|---|
| `foundation` | `mongo-contract`, `mongo-codec`, `mongo-value` | `mongo-error` |
| `authoring` | `mongo-contract-psl` | TS contract authoring |
| `tooling` | `mongo-emitter` | introspection |
| `query` | `mongo-query-ast` | `mongo-query-plan` (if split from AST) |
| `query-builders` | `mongo-orm` | aggregation builder, raw collection builder |
| `transport` | `mongo-wire`, `mongo-lowering` | change-stream transport |
| `runtime` | `mongo-runtime` | plugin packages |
| `family` | `family-mongo` | — |

## Comparison with SQL

| Conceptual layer | SQL | Mongo |
|---|---|---|
| Foundation | `1-core/{contract, errors, operations, schema-ir}` | `1-foundation/{mongo-contract, mongo-codec, mongo-value}` |
| Authoring | `2-authoring/` | `2-authoring/mongo-contract-psl` |
| Tooling | `3-tooling/emitter` | `3-tooling/mongo-emitter` |
| Query | `4-lanes/relational-core` (AST + plan + adapter i/f mixed) | `4-query/mongo-query-ast` (AST + plan + executor i/f) |
| Query builders | `4-lanes/{sql-builder, query-builder}` | `5-query-builders/mongo-orm` |
| Transport | (implicit — SQL string is the wire format) | `6-transport/{mongo-wire, mongo-lowering}` |
| Runtime | `5-runtime/` | `7-runtime/mongo-runtime` |
| Family | `9-family/` (pending task 5.8) | `9-family/family-mongo` |

SQL's `relational-core` bundles AST, plan types, and adapter interface in one package at the lanes layer. The Mongo layering separates these: AST/plan at `query`, transport interfaces at `transport`. This is stricter — the adapter interface can reference AST types (transport is above query) but the query layer has no knowledge of transport concerns.

## References

- [Unified Mongo Query Plan](unified-mongo-query-plan.md) — single plan type and executor interface
- [`architecture.config.json`](../../../architecture.config.json) — layer ordering and import rules
- [Repo Map & Layering](../../../docs/onboarding/Repo-Map-and-Layering.md)
- [Contract Domain Extraction — Task 5.11](../../contract-domain-extraction/plan.md) — foundation layer in framework domain
