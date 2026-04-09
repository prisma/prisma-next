# Predictive Maintenance Port

## Summary

Port the [Leafy-Predictive-Maintenance](https://github.com/mongodb-industry-solutions/Leafy-Predictive-Maintenance) manufacturing/IoT application from raw MongoDB driver calls to Prisma Next's MongoDB support. This app stress-tests vector search as a core feature (repair manual RAG, equipment criticality analysis), handles sensor time-series data, and stores ML model binary artifacts. Success means the entire Node.js data access layer uses the PN ORM, vector searches go through the PN extension pack, and schema migrations create the correct vector search indexes.

**Spec:** `projects/mongo-example-apps/spec.md`

## Collaborators

| Role | Person/Team | Context |
|---|---|---|
| Maker | Agent / Engineer | Drives execution |
| Reviewer | Will | Architectural review, framework gap triage |
| Collaborator | WS4 (Mongo) team | Framework features this plan depends on |

## Source Repo Analysis

Leafy-Predictive-Maintenance is a **Next.js Pages Router** JavaScript app with a companion **Express + Socket.IO** alerts server and a **Python** inference module (out of scope). Uses the **native `mongodb` driver** (no Mongoose). Key characteristics:

- **6 collections**: `raw_data`, `transformed_data`, `machine_failures`, `ml_models`, `repair_manuals`, `maintenance_history`
- **Embedded documents**: `source: { filename, page_number }` on RAG chunks; `data: { ... }` nested object on `transformed_data`
- **No cross-collection references via ObjectId**: logical links via `machineID` (string) and `sessionID`
- **No application-defined indexes**: vector search indexes are documented in README for manual Atlas creation (not in code)
- **Vector search is the core feature**: `$vectorSearch` aggregation on `repair_manuals` (1024-dim Cohere / 1536-dim OpenAI embeddings) and `maintenance_history` (with `source.filename` pre-filter)
- **Stream processing**: Atlas Stream Processing transforms `raw_data` → `transformed_data`; Python watches `transformed_data` change stream for inference
- **Update operators**: only `$set` for acknowledging alerts on `machine_failures`
- **ML model storage**: `ml_models` stores compressed pickle binaries in `model_ckpt` field (BinData)
- **Dual embedding fields**: `embeddings` (Cohere) and `embeddings_openai` (OpenAI) on the same documents

## Milestones

### Milestone 1: Project scaffold and contract authoring

Set up the example app as a workspace package and author the contract in both PSL and TypeScript DSL.

**Validates:** dual authoring surface parity, Mongo contract support for vector embedding fields, embedded documents, BSON binary types.

**Tasks:**

- [ ] Create `examples/predictive-maintenance/` with `package.json` (workspace deps on PN packages), `tsconfig.json`, `biome.jsonc`, `vitest.config.ts` — following the `mongo-demo` example structure
- [ ] Clone/download the Leafy source and analyze the full data model: document every collection's fields, embedded structures, and index requirements
- [ ] Author the PSL contract (`schema.psl`) covering all collections:
  - `raw_data`: flat sensor readings (`Product ID`, `Type`, temperatures, speeds, `Tool wear`, `Session ID`)
  - `transformed_data`: `sessionID`, `machineID`, embedded `data` object with typed sensor fields
  - `machine_failures`: `machineID`, `failure` (string), `ts` (DateTime), `isAcknowledged` (boolean), `repairSteps` (string)
  - `ml_models`: `tag` (string), `model_ckpt` (Binary/BinData)
  - `repair_manuals`: `text_chunk`, embedded `source: { filename, page_number }`, `embeddings` (vector array), `embeddings_openai` (vector array)
  - `maintenance_history`: same shape as `repair_manuals`
- [ ] Author the TypeScript DSL contract producing equivalent `contract.json`
- [ ] Write a parity test: emit from both surfaces, assert structural equivalence
- [ ] Generate `contract.json` and `contract.d.ts` via the emitter; commit artifacts

### Milestone 2: Schema migrations

The contract produces schema migrations that create MongoDB collections with vector search indexes (multiple dimensions) and filtered indexes.

**Validates:** Mongo schema migration generation for vector search indexes, multi-dimensional embedding support, filtered indexes, migration runner.

**Blocks on:** PN Mongo schema migration support for vector search indexes.

**Tasks:**

- [ ] Generate schema migrations from the contract
- [ ] Verify migration creates a vector search index on `repair_manuals` for `embeddings` field (1024 dimensions, euclidean similarity)
- [ ] Verify migration creates a vector search index on `repair_manuals` for `embeddings_openai` field (1536 dimensions) — or a single index covering both paths
- [ ] Verify migration creates a filtered vector search index on `maintenance_history` with `source.filename` as a filter field
- [ ] Write integration test: apply migrations against `mongodb-memory-server`, assert collections and vector indexes exist (note: Atlas Vector Search indexes may require Atlas — test creation API, not search functionality)
- [ ] Write integration test: apply migrations idempotently

### Milestone 3: Core ORM — CRUD operations

Replace raw MongoDB driver calls for basic CRUD with PN ORM queries.

**Validates:** `create`, `findMany`, `findFirst`, `update`, `delete` via ORM; embedded document inlining; BSON binary type handling; type safety.

**Tasks:**

- [ ] Create the PN database client (`db.ts`) following the `mongo-demo` pattern
- [ ] Port `raw_data` writes: `create` for sensor data ingestion (high-volume insert pattern from machine simulator)
- [ ] Port `transformed_data` reads: `findFirst` with sort by `_id` descending (latest reading), `findMany` by `sessionID`/`machineID`
- [ ] Port `machine_failures` operations:
  - `create` for inserting failure predictions
  - `findMany` for listing active failures
  - `update` with `$set` for acknowledging alerts (`isAcknowledged: true`, `repairSteps: "..."`)
  - `deleteMany` for clearing failures before simulator run
- [ ] Port `ml_models` reads: `findFirst` by `tag` field (e.g. `"RootCauseClassifier"`) — verify BSON binary field (`model_ckpt`) is handled correctly by the codec
- [ ] Port `repair_manuals` reads: `findMany` for listing chunks (projecting out embedding vectors for display)
- [ ] Port `maintenance_history` reads: `findMany` for listing chunks
- [ ] Write integration tests for each collection's CRUD operations
- [ ] Verify embedded `source: { filename, page_number }` appears inline in query results
- [ ] Verify all query results are fully typed — add negative type tests

### Milestone 4: Vector search — repair manual RAG

Port the core RAG query for repair plan generation to use the PN vector search extension pack.

**Validates:** PN vector search as a primary query mechanism (not a bolt-on); multi-provider embedding support; real-world RAG pipeline.

**Blocks on:** PN Mongo vector search extension pack implementation.

**Tasks:**

- [ ] Add the PN vector search extension pack dependency
- [ ] Port repair plan search: vector search on `repair_manuals` by `embeddings` field (Cohere, 1024-dim), returning top 10 results with 150 candidates
- [ ] Port repair plan search (OpenAI variant): vector search on `repair_manuals` by `embeddings_openai` field (1536-dim), controlled by config/env
- [ ] Verify the PN API supports switching the vector field path based on the AI provider
- [ ] Write integration test: seed `repair_manuals` with embedding vectors, run vector search, assert results returned in relevance order (requires Atlas or test double)

### Milestone 5: Vector search — criticality analysis with pre-filter

Port the criticality analysis RAG query, which adds a pre-filter on `source.filename` to the vector search.

**Validates:** filtered vector search (pre-filter on non-vector fields), compound vector + filter index usage.

**Blocks on:** PN Mongo vector search extension pack with pre-filter support.

**Tasks:**

- [ ] Port criticality analysis search: vector search on `maintenance_history` with `filter: { "source.filename": { $in: selectedDocuments } }`
- [ ] Verify the PN vector search API supports pre-filters alongside vector queries
- [ ] Write integration test: seed `maintenance_history` with multiple source filenames, run filtered vector search, assert only matching source documents are returned
- [ ] Verify the filtered vector search uses the correct index (the one with `source.filename` as a filter field)

### Milestone 6: Sensor data and time-series patterns

Validate that the PN runtime handles the sensor data ingestion and query patterns — high-volume inserts and time-ordered queries.

**Validates:** PN performance with high-volume inserts; sort-by-insertion-order queries; bulk operations.

**Tasks:**

- [ ] Port machine simulator data path: bulk `create` operations for `raw_data` documents (simulating ~2s interval sensor readings)
- [ ] Port "latest reading" query: `findFirst` on `transformed_data` sorted by `_id` descending
- [ ] Port change stream watch on `transformed_data`: subscribe to new inserts for a given `sessionID` (this is the Python inference trigger path — port the subscription, not the Python inference)
- [ ] Write integration test: insert a batch of sensor readings, query latest, assert correct document returned
- [ ] Write integration test: subscribe to `transformed_data` changes, insert documents, assert change events received

### Milestone 7: Close-out

Verify all acceptance criteria, document gaps found, and clean up.

**Tasks:**

- [ ] Run full test suite against `mongodb-memory-server` — all tests pass
- [ ] Run typecheck — no errors
- [ ] Verify all acceptance criteria from the spec are met (checklist below)
- [ ] Document any framework gaps discovered during the port
- [ ] Write a brief README for `examples/predictive-maintenance/` explaining how to run the example

## Test Coverage

| Acceptance Criterion | Test Type | Milestone | Notes |
|---|---|---|---|
| Contract authored in both PSL and TS DSL | Integration (parity) | M1 | Assert equivalent `contract.json` output |
| Both surfaces produce equivalent `contract.json` | Integration (parity) | M1 | Structural comparison test |
| Contract emits valid `contract.json` and `contract.d.ts` | Integration | M1 | Emitter success + typecheck |
| Schema migrations create correct collections and vector indexes | Integration | M2 | Apply against mongodb-memory-server |
| Migration runner applies against real MongoDB | Integration | M2 | mongodb-memory-server test |
| All CRUD operations use PN ORM | Integration | M3 | Per-collection CRUD tests |
| Embedded documents inline in results | Integration | M3 | Assert `source` nested fields present |
| Query results fully typed | Compile-time | M3 | Negative type tests + typecheck |
| Vector search via PN extension pack (repair manuals) | Integration | M4 | Requires Atlas or test double |
| Vector search via PN extension pack (criticality with pre-filter) | Integration | M5 | Requires Atlas or test double |
| Time-series insert and query patterns work | Integration | M6 | Bulk insert + latest query |
| Runs against mongodb-memory-server in CI | CI | M7 | Full suite green |
| Demonstrates 3+ distinct MongoDB idioms | Manual | M7 | Checklist: embedded docs, vector search (core), update ops, time-series, change streams |

## Open Items

- **BSON Binary type support**: `ml_models` stores compressed pickle data as `BinData`. The PN Mongo codec registry needs a `binary` codec. If not available, this blocks M3.
- **Dual embedding fields**: The same documents have both `embeddings` (Cohere, 1024-dim) and `embeddings_openai` (OpenAI, 1536-dim). The contract needs to model both fields, and the vector search API needs to support selecting which field to search at query time.
- **Atlas Vector Search in CI**: Vector search indexes are an Atlas-only feature. Integration tests for M4 and M5 may need to be marked as Atlas-optional, with the core CRUD tests running against `mongodb-memory-server`.
- **Stream Processing**: Atlas Stream Processing transforms `raw_data` → `transformed_data`. This is a server-side pipeline, not application code. The port doesn't replicate it — instead, the port validates that the PN ORM can read/write both collections and subscribe to changes on `transformed_data`.
- **Python inference module**: Out of scope per spec. The Node.js data access layer is ported; the Python ML pipeline remains as-is or is documented as a future port.
- **Field naming conventions**: Source uses string keys with spaces (`"Product ID"`, `"Air temperature [K]"`). These may need to be mapped to valid identifiers in the contract via the `storage.fields` mapping.
