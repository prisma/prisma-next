import type { QueryPlan } from '@prisma-next/framework-components/runtime';
import type { AnyMongoCommand } from './commands';

declare const __mongoQueryPlanRow: unique symbol;

/**
 * Mongo-domain query plan produced by lanes before lowering.
 *
 * Extends the framework-level `QueryPlan<Row>` marker (`meta + _row`) and
 * adds Mongo-specific fields (`collection`, `command`). The unique-symbol
 * phantom is retained alongside the inherited `_row` for backwards
 * compatibility with anything that may have relied on it.
 */
export interface MongoQueryPlan<Row = unknown, Command extends AnyMongoCommand = AnyMongoCommand>
  extends QueryPlan<Row> {
  readonly collection: string;
  readonly command: Command;
  readonly [__mongoQueryPlanRow]?: Row;
}
