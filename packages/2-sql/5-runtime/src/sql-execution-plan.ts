import type { ExecutionPlan } from '@prisma-next/framework-components/runtime';
import type { AnyQueryAst } from '@prisma-next/sql-relational-core/ast';

/**
 * SQL-domain execution plan: an `ExecutionPlan` lowered to the wire-level
 * shape that a SQL driver can run.
 *
 * The plan carries:
 * - `sql` — the rendered SQL text
 * - `params` — the bound parameter list
 * - `ast` — optional pre-lowering AST, retained for telemetry / debugging
 * - `meta` — family-agnostic plan metadata (target, lane, hashes, …)
 * - `_row` — phantom row type, propagated from the originating `SqlQueryPlan`
 *
 * Extends the framework-level `ExecutionPlan<Row>` marker so generic SPIs
 * (`RuntimeExecutor<SqlExecutionPlan>`, `RuntimeMiddleware<SqlExecutionPlan>`)
 * can be parameterized over it.
 */
export interface SqlExecutionPlan<Row = unknown> extends ExecutionPlan<Row> {
  readonly sql: string;
  readonly params: readonly unknown[];
  readonly ast?: AnyQueryAst;
}
