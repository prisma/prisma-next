# ADR Extraction Plan

## Goal

Promote validated design decisions from `projects/mongo-schema-migrations/specs/` into durable ADRs under `docs/architecture docs/adrs/`. The remaining implementation-level content migrates to the Migration System subsystem doc.

## Source specs

| Spec | Content |
|---|---|
| `schema-ir.spec.md` | Schema IR representation, content-addressed index identity |
| `operation-ast.spec.md` | DDL command AST, three-phase operation envelope, filter-based checks |
| `ddl-command-dispatch.spec.md` | Visitor dispatch for DDL/inspection commands |
| `operation-envelope.spec.md` | Operation envelope shape, serialization round-trip |
| `planner-runner.spec.md` | Planner diffing algorithm, runner execution loop, CAS marker, ledger |
| `check-evaluator.spec.md` | Client-side filter evaluator implementation |
| `contract-to-schema-and-introspection.spec.md` | `contractToSchema` implementation, future introspection |
| `cli-display.spec.md` | CLI operation display generalization |

## ADRs to write

### ADR 187 — MongoDB schema representation for migration diffing

**Sources:** `schema-ir.spec.md`

**Abstract:** The migration planner needs to compare two snapshots of MongoDB server-side state (collections, indexes, validators, collection options) to determine what changed. This ADR decides how that state is represented in memory. We model it as `MongoSchemaIR` — an immutable, class-based AST following the same frozen-node pattern used by the Mongo query and filter expression ASTs. Index identity is structural (keys, directions, and options), not nominal (name), so two indexes with different names but identical structure are treated as equivalent. The IR is produced from a contract via `contractToSchema()` and, in future milestones, from a live database via introspection.

### ADR 188 — MongoDB migration operation model: data-driven commands and checks

**Sources:** `operation-ast.spec.md`, `ddl-command-dispatch.spec.md`, `operation-envelope.spec.md`

**Abstract:** MongoDB migrations need to express what to check before a schema change, what mutation to perform, and what to verify afterward — and this must serialize to a JSON plan file that a generic runner can execute without operation-specific logic. This ADR decides that each migration operation is a data envelope with three phases (precheck, execute, postcheck) rather than a behavioral class. Execute steps wrap DDL command AST nodes (`CreateIndexCommand`, `DropIndexCommand`); checks pair an inspection command with a `MongoFilterExpr` filter and an expectation (`exists` / `notExists`), reusing the existing query-layer filter AST rather than introducing a purpose-built check vocabulary. DDL commands use visitor-based dispatch (`accept(visitor)`) because they are consumed by multiple independent visitors (executor, CLI formatter, serializer) and adding a new command kind must produce compile-time errors in all consumers. The envelope serializes via `JSON.stringify` and deserializes with Arktype-validated reconstruction of AST nodes from `kind` discriminants.

### ADR 189 — Structural index matching for MongoDB migrations

**Sources:** `planner-runner.spec.md` (planner sections)

**Abstract:** The MongoDB migration planner needs to determine which indexes changed between two contract versions. This ADR decides that indexes are matched by structure (keys, direction, and options like unique, sparse, TTL, partial filter) rather than by name. Two indexes with different names but identical structure are treated as the same index, preventing unnecessary drop-and-create cycles. The trade-off is that intentional name-only changes require a manual migration step. The planner builds a lookup key from structural properties for O(1) comparison.

### ADR 190 — CAS-based concurrency and migration state storage for MongoDB

**Sources:** `planner-runner.spec.md` (runner, marker, and ledger sections)

**Abstract:** The MongoDB migration runner needs concurrency safety when two processes attempt `migration apply` simultaneously, and needs durable storage for migration state. This ADR decides on compare-and-swap via `findOneAndUpdate` (filtering on the expected storage hash) rather than advisory locks, which MongoDB does not support natively. If two runners race, one succeeds and the other receives a clean hash-mismatch error. Both the marker (a singleton document recording the current contract hash) and the append-only migration ledger live in a single `_prisma_migrations` collection, keeping setup and inspection straightforward. The runner applies a generic three-phase loop (precheck, execute, postcheck) with no per-operation dispatch, structurally identical to the SQL runner.

### ADR 191 — Generic three-phase migration operation envelope and family-provided serialization

**Status:** Accepted, not yet implemented.

**Sources:** `operation-envelope.spec.md` (extractability section), `cli-display.spec.md` (future SPI section), `control-migration-types.ts` (current framework types)

**Abstract:** Both SQL and Mongo migration families independently implement the same three-phase operation structure: prechecks, execute steps, and postchecks. The framework's `MigrationPlanOperation` currently carries only display fields (`id`, `label`, `operationClass`), forcing each family to bolt on parallel `precheck[]`/`execute[]`/`postcheck[]` arrays and parallel serializers. This ADR decides to extract the three-phase structure into the framework as `MigrationPlanOperation<TStep, TCheck>`, with a corresponding `MigrationOperationSerializer<TStep, TCheck>` SPI and a `formatOperationStatements` method on `TargetMigrationsCapability`. SQL would instantiate the generic as `MigrationPlanOperation<SqlStep, SqlCheck>`, Mongo as `MigrationPlanOperation<MongoMigrationStep, MongoMigrationCheck>`. This generalizes the pattern validated by M1, eliminates the per-family switch in the CLI, and gives future families a clear contract for migration operations.

## Subsystem doc content (not ADRs)

The following specs describe implementations of the above decisions. Their content migrates to the Migration System subsystem doc (`docs/architecture docs/subsystems/`):

| Spec | Why not an ADR |
|---|---|
| `check-evaluator.spec.md` | Implements the filter-based check decision from ADR 188 |
| `contract-to-schema-and-introspection.spec.md` | Implements the `contractToSchema` function for the IR decided in ADR 187 |
| `cli-display.spec.md` | Extends the existing family-agnostic CLI pattern (ADR 150) to Mongo |

## Cross-references to existing ADRs

| Existing ADR | Relationship |
|---|---|
| ADR 021 (Contract Marker Storage) | ADR 190 is the Mongo implementation; differs in concurrency model (CAS vs advisory locks) |
| ADR 028 (Migration Structure & Operations) | ADR 188 implements the edge/operation model for Mongo |
| ADR 038 (Operation idempotency) | ADR 190's runner follows this idempotency model |
| ADR 044 (Pre/post check vocabulary v1) | ADR 188 takes a different approach (filter expressions vs purpose-built vocabulary) |
| ADR 150 (Family-Agnostic CLI) | CLI display generalization follows this pattern |

## Sequence

1. Write ADR 187 (schema IR) — standalone, no dependencies
2. Write ADR 188 (operation model) — references ADR 187 for the IR it operates on
3. Write ADR 189 (structural matching) — references ADR 187 for the IR representation
4. Write ADR 190 (CAS concurrency) — references ADR 188 for the operation model the runner executes
5. Write ADR 191 (generic envelope extraction) — references ADR 188 for the pattern being generalized
