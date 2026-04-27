import type { ExecutionPlan } from '@prisma-next/framework-components/runtime';
import type { AnyMongoWireCommand } from '@prisma-next/mongo-wire';

/**
 * Mongo-domain execution plan: a query lowered to the wire-command shape
 * that a Mongo driver can run.
 *
 * The plan carries:
 * - `command` — the wire command (e.g. `InsertOneWireCommand`,
 *   `AggregateWireCommand`) produced by `MongoAdapter.lower(plan)`
 * - `meta` — family-agnostic plan metadata (target, lane, hashes, ...)
 * - `_row` — phantom row type, propagated from the originating
 *   `MongoQueryPlan`
 *
 * Extends the framework-level `ExecutionPlan<Row>` marker so generic SPIs
 * (`RuntimeExecutor<MongoExecutionPlan>`,
 * `RuntimeMiddleware<MongoExecutionPlan>`) can be parameterized over it.
 *
 * Lives in the runtime layer (alongside `MongoRuntime`) because the wire
 * command shape lives in the transport layer (`@prisma-next/mongo-wire`),
 * which the lanes layer (`mongo-query-ast`, where `MongoQueryPlan` lives)
 * cannot depend on. M1 establishes this type; `MongoRuntime.execute` does
 * not yet accept it as input — that adoption lands in M4.
 */
export interface MongoExecutionPlan<Row = unknown> extends ExecutionPlan<Row> {
  readonly command: AnyMongoWireCommand;
}
