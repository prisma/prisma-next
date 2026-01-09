import type { OperationRegistry } from '@prisma-next/operations';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { CodecRegistry } from './ast/codec-types';

/**
 * Registry of initialized type helpers from storage.types.
 * Each key is a type name from storage.types, and the value is the initialized helper
 * (or validated typeParams if no init hook was provided).
 */
export type TypeHelperRegistry = Record<string, unknown>;

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
  /**
   * Optional type helper registry for parameterized types.
   * When present, schema() will expose these helpers via schema.types.
   */
  readonly types?: TypeHelperRegistry;
}
