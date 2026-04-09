# Summary

Port two real-world MongoDB Industry Solutions applications — an e-commerce platform ([retail-store-v2](https://github.com/mongodb-industry-solutions/retail-store-v2)) and a predictive maintenance system ([Leafy-Predictive-Maintenance](https://github.com/mongodb-industry-solutions/Leafy-Predictive-Maintenance)) — to Prisma Next's MongoDB support. These live as example apps in this repo, consuming framework packages directly, to validate that the PN Mongo implementation holds up under real industry conditions.

# Description

The MongoDB PoC validated the architecture with toy schemas. Before shipping, we need confidence that the implementation handles real-world data models with real-world complexity — embedded documents, referenced relations, polymorphic types, vector search indexes, change streams, update operators, aggregation pipelines, and schema migrations.

The MongoDB Industry Solutions org maintains ~84 open-source demo apps across industries. Two were selected for their complementary feature coverage:

1. **retail-store-v2** — A Next.js e-commerce platform with products, orders, customers, inventory, an agentic RAG chatbot, omnichannel ordering, personalized recommendations (via vector embeddings), and complex event processing via change streams. This exercises the widest range of PN Mongo features: embedded documents, referenced relations, multiple index types, vector search, change streams, and update operators.

2. **Leafy-Predictive-Maintenance** — A Next.js predictive maintenance system for manufacturing, using Atlas Vector Search for repair manual search and equipment criticality analysis, Atlas Stream Processing for real-time failure detection, and ML model storage. This specifically stress-tests vector search as a core feature, time-series data patterns, and exotic BSON types.

Both apps live as example projects under `examples/` in this repo on this branch. They consume PN framework packages directly via workspace dependencies, which keeps the framework code visible to agents working on the ports and ensures the examples stay up to date as the framework evolves.

# Requirements

## Functional Requirements

### App 1: Retail Store (retail-store-v2)

1. **Contract definition**: Author the retail domain contract in both PSL and TypeScript DSL — products, orders, customers, inventory, carts, recommendations — with embedded documents (order line items, addresses, cart items), referenced relations (customer ↔ orders, product ↔ category), and polymorphic types where the original data model uses them. Both authoring surfaces must produce equivalent `contract.json` output.
2. **Schema migrations**: The contract produces schema migrations that create the necessary MongoDB collections, indexes (unique, compound, text, vector), and JSON Schema validators. The migration runner applies them against a real MongoDB instance.
3. **ORM queries**: Replace raw MongoDB driver calls with PN ORM queries — `findMany`, `findFirst`, `create`, `update`, `delete` — using the fluent chaining API. Relation loading via `$lookup` works for referenced relations. Embedded documents are inlined in query results.
4. **Update operators**: Cart and inventory mutations use Mongo-native update operators (`$inc`, `$push`, `$pull`, `$set`) through the PN mutation surface.
5. **Vector search**: Product recommendation queries use the PN vector search extension pack to perform similarity searches against embedding vectors stored in the product/recommendation collections.
6. **Change streams**: The customer retention CEP feature subscribes to collection changes through the PN runtime's streaming interface.
7. **Data migrations**: At least one data migration (e.g. a product catalog restructuring or field rename) runs through the PN migration graph.

### App 2: Predictive Maintenance (Leafy-Predictive-Maintenance)

8. **Contract definition**: Author the maintenance domain contract in both PSL and TypeScript DSL — machines, sensor readings, failure predictions, ML models, repair manuals, maintenance history — with appropriate embedded documents and referenced relations. Both authoring surfaces must produce equivalent `contract.json` output.
9. **Schema migrations**: The contract produces schema migrations that create collections with vector search indexes (multiple embedding dimensions: 1024 for Cohere, 1536 for OpenAI) and filtered indexes.
10. **Vector search (core)**: Repair manual search and equipment criticality analysis use PN's vector search extension pack as their primary query mechanism, not a bolt-on.
11. **ORM queries**: Replace raw MongoDB driver calls with PN ORM queries for CRUD operations on machines, failures, and maintenance history.
12. **Time-series patterns**: Sensor data ingestion and failure prediction queries work through the PN runtime, validating how PN handles high-volume insert and time-ordered query patterns.

## Non-Functional Requirements

1. **In-repo examples**: Both apps live under `examples/` with workspace dependencies on PN packages. They do not use published npm packages.
2. **Runnable against mongodb-memory-server**: Both apps can run their data access layer against `mongodb-memory-server` for local development and CI, without requiring Atlas. Atlas-specific features (Atlas Vector Search, Atlas Stream Processing) are exercised via optional integration tests that require Atlas credentials.
3. **Contract-first**: Each app has a committed `contract.json` and `contract.d.ts`. The contract is the source of truth for the data model, not ad-hoc driver calls.
4. **Type safety**: All queries are fully typed — the ORM infers row types from the contract, including embedded document fields, relation includes, and polymorphic narrowing.
5. **Block on framework, never paper over**: If a PN feature required by the port is not yet implemented, the port blocks until the framework delivers it. The purpose of this project is to uncover gaps in the framework, not to work around them with raw driver calls or hand-rolled solutions. Every gap discovered is a signal that the framework needs work — file it, fix it in the framework, then continue the port.

## Non-goals

- **Full UI port**: The goal is porting the data access layer, not rewriting the frontend. The UI can remain unchanged or be simplified.
- **Production deployment**: These are local example apps for validation, not production-ready deployments.
- **Atlas-exclusive features as hard requirements**: Atlas Stream Processing and Atlas Vector Search are tested via optional integration tests. The core data access layer works without Atlas.
- **Porting non-JS microservices**: The Python inference script in Leafy-Predictive-Maintenance is out of scope. Only the Node.js/Next.js data access layer is ported.
- **Performance benchmarking**: We're validating correctness and API coverage, not measuring throughput.

# Acceptance Criteria

## Contract & Schema

- [ ] Each app has a PN contract authored in both PSL and TypeScript DSL
- [ ] Both authoring surfaces produce equivalent `contract.json` for each app
- [ ] Each contract emits valid `contract.json` and `contract.d.ts` artifacts
- [ ] Schema migrations create the correct MongoDB collections, indexes, and validators
- [ ] The migration runner applies schema migrations against a real MongoDB instance

## ORM & Queries

- [ ] All CRUD operations in both apps use the PN ORM, not raw driver calls
- [ ] Embedded documents appear inline in query results (no separate `include` needed)
- [ ] Referenced relations load via `$lookup` through the ORM's `include` method
- [ ] Query results are fully typed — the TypeScript compiler catches type errors in query consumption code

## MongoDB-Specific Features

- [ ] At least one mutation in the retail app uses Mongo-native update operators (`$inc`, `$push`, or `$pull`) through the PN mutation surface
- [ ] Vector search queries work in both apps via the PN extension pack
- [ ] At least one data migration runs through the PN migration graph in the retail app
- [ ] Change stream subscription works through the PN runtime in the retail app (optional: requires Atlas or replica set)

## Validation

- [ ] Both apps run their data access layer against `mongodb-memory-server` in CI
- [ ] Both apps demonstrate at least 3 distinct MongoDB idioms each (from: embedded docs, referenced relations, polymorphism, vector search, update operators, aggregation pipelines, change streams, time-series patterns)

# Other Considerations

## Security

Not applicable — these are local example apps with no authentication or multi-tenancy concerns. The original apps' auth patterns are out of scope for the port.

## Cost

Zero incremental infrastructure cost. Both apps run against `mongodb-memory-server` locally. Atlas integration tests run against a shared development Atlas cluster if credentials are available.

## Observability

Not applicable beyond standard test output. The PN runtime's built-in telemetry plugin can be demonstrated if useful.

## Data Protection

Not applicable — all data is synthetic/demo data from the original repos.

## Analytics

Not applicable.

# References

- [retail-store-v2](https://github.com/mongodb-industry-solutions/retail-store-v2) — source repo (JavaScript, Next.js)
- [Leafy-Predictive-Maintenance](https://github.com/mongodb-industry-solutions/Leafy-Predictive-Maintenance) — source repo (JavaScript, Next.js)
- [MongoDB Family subsystem doc](../../docs/architecture%20docs/subsystems/10.%20MongoDB%20Family.md)
- [MongoDB User Promise](../../docs/reference/mongodb-user-promise.md) — the developer experience we're validating against
- [MongoDB Feature Support Priorities](../../docs/reference/mongodb-feature-support-priorities.md) — the MongoDB team's feature priority list
- [MongoDB Status Update](../../docs/planning/mongo-target/mongodb-status-update.md) — current implementation status
- ADRs 170, 172-180 — architecture decisions governing the implementation
- [April milestone WS4](../../docs/planning/april-milestone.md) — the broader workstream these examples validate

# Open Questions

_All initial questions resolved._

## Resolved

1. **Contract authoring surface** — Author contracts in both PSL and TypeScript DSL. Both surfaces must produce equivalent output. Do not use hand-crafted JSON.

2. **Scope of the retail app port** — Port the core e-commerce data model (products, orders, customers, inventory) plus recommendations (vector search) and CEP (change streams). The chatbot integration is out of scope (it validates Dataworkz, not PN).

3. **Vector search implementation timing** — Block on the PN Mongo vector search implementation. Do not use raw aggregation pipelines as a workaround. This applies generally: if a PN feature is not ready, wait until it is.

4. **Directory layout** — Two separate directories: `examples/retail-store/` and `examples/predictive-maintenance/`.
