import type { OperationRegistry } from '@prisma-next/operations';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { CodecRegistry } from './ast/codec-types';

/**
 * Minimal context interface for SQL query lanes.
 *
 * Lanes only need contract, operations, and codecs to build typed ASTs and attach
 * operation builders. This interface explicitly excludes runtime concerns like
 * adapters, connection management, and transaction state.
 */
export interface QueryLaneContext<
  TContract extends SqlContract<SqlStorage> = SqlContract<SqlStorage>,
> {
  readonly contract: TContract;
  readonly operations: OperationRegistry;
  readonly codecs: CodecRegistry;
}
