# MongoDB Family — Package Layering

Design for the package layer structure in `packages/2-mongo-family/`. This addresses the current structural issue where most numbered layer directories contain a single package (the directory IS the package), rather than acting as layer groupings that contain one or more packages.

## Current state

```
packages/2-mongo-family/
├── 1-core/          ← IS the package (mongo-core) — should be a layer containing packages
├── 3-tooling/
│   └── emitter/     ← correct: layer directory containing a package
├── 4-orm/           ← IS the package (mongo-orm)
├── 5-runtime/       ← IS the package (mongo-runtime)
└── 9-family/        ← IS the package (family-mongo)
```

Current layer order in `architecture.config.json`:

```json
"mongo": ["core", "tooling", "orm", "runtime", "family"]
```

Only `3-tooling/` follows the correct convention (layer directory containing `emitter/` as a sub-package). All other numbered directories are the packages themselves.

## Problem

There is no layer for the query AST — the typed representation of MongoDB aggregation queries (filter expressions, read stages, visitors). This is a foundational primitive consumed by:

- The ORM (`MongoCollection` compiles state to AST stages)
- A future pipeline builder (user-facing aggregation DSL)
- The adapter (lowers AST to driver documents)

It cannot live in `mongo-core` — it's a consumer of core types (`MongoValue`, `MongoParamRef`), not a peer. It cannot live in a lanes or ORM layer — those are consumers of the AST, and placing it alongside them would allow upward coupling.

## Target layering

```
Layer        Dir              Packages                         Depends on
─────        ───              ────────                         ──────────
core         1-core/          mongo-core                       (foundation)
query        2-query/         query-ast                        core
tooling      3-tooling/       emitter                          core
lanes        4-lanes/         pipeline-builder (future)        core, query
orm          4-orm/           mongo-orm                        core, query
runtime      5-runtime/       mongo-runtime                    core, query
adapters     (in 3-targets)   mongo-adapter                    core, query
family       9-family/        family-mongo                     core
```

**Layer order** for `architecture.config.json`:

```json
"mongo": ["core", "query", "tooling", "lanes", "orm", "runtime", "family"]
```

### Key relationships

- **`query` is below all query-surface consumers.** The ORM, lanes (future pipeline builder), runtime, and adapter all import from `query-ast`. The AST package cannot import from any of them.
- **`lanes` and `orm` are peers.** Neither can import from the other. Both consume the query AST. This mirrors SQL where the query builder lanes and the ORM (in extensions) are independent surfaces.
- **`tooling` is independent of `query`.** The emitter works with contract/schema types, not query representations. It depends only on `core`.
- **`adapters` live in the targets domain** (`packages/3-mongo-target/`), not the mongo-family domain. They import cross-domain from `mongo` → `query-ast`.

### Directory convention

Each numbered directory is a **layer** containing one or more **packages**:

```
packages/2-mongo-family/
├── 1-core/
│   └── mongo-core/          @prisma-next/mongo-core
├── 2-query/
│   └── query-ast/           @prisma-next/mongo-query-ast
├── 3-tooling/
│   └── emitter/             @prisma-next/mongo-emitter
├── 4-lanes/
│   └── pipeline-builder/    (future) @prisma-next/mongo-pipeline-builder
├── 4-orm/
│   └── mongo-orm/           @prisma-next/mongo-orm
├── 5-runtime/
│   └── mongo-runtime/       @prisma-next/mongo-runtime
└── 9-family/
    └── family-mongo/        @prisma-next/family-mongo
```

### Migration path

Restructuring existing packages (moving `1-core/` contents into `1-core/mongo-core/`, etc.) is **not** in scope for this project. The only structural change is creating `2-query/query-ast/` correctly from the start.

Existing packages that are layer-as-package (`1-core`, `4-orm`, `5-runtime`, `9-family`) will be restructured in a future cleanup. The `architecture.config.json` globs can accommodate both the current flat structure and the target nested structure.

## Comparison with SQL

| Layer | SQL (`packages/2-sql/`) | Mongo (`packages/2-mongo-family/`) |
|---|---|---|
| Core | `1-core/` → `contract/`, `errors/`, `operations/`, `schema-ir/` | `1-core/` → `mongo-core` (currently flat) |
| Query representation | `4-lanes/relational-core/` | `2-query/query-ast/` |
| Tooling | `3-tooling/emitter/` | `3-tooling/emitter/` |
| Query surfaces | `4-lanes/sql-builder/`, `query-builder/` | `4-lanes/pipeline-builder/` (future) |
| ORM | `3-extensions/sql-orm-client/` (extensions domain) | `4-orm/mongo-orm/` |
| Runtime | `5-runtime/` | `5-runtime/mongo-runtime/` |

The SQL AST (`relational-core`) lives at the lanes layer (4), alongside the query builders. This means it's at the same level as its consumers — the layering doesn't prevent coupling between the AST and builder packages. For Mongo, we're placing the query AST at its own layer (2) below all consumers, which is a stricter separation.

## References

- [Milestone 1: Mongo Query AST — Design](./milestone-1-pipeline-ast-design.md)
- [Phase 1: Mongo Collection Spike](./phase-1-mongo-collection-spike.md)
- [`architecture.config.json`](../../../architecture.config.json)
- [Repo Map & Layering](../../../docs/onboarding/Repo-Map-and-Layering.md)
