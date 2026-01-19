import type { OperationRegistry } from '@prisma-next/operations';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { CodecRegistry } from './ast/codec-types';

/**
 * Registry of initialized type helpers from storage.types.
 * Each key is a type name from storage.types, and the value is:
 * - The result of the codec's init hook (if provided), or
 * - The full StorageTypeInstance metadata (codecId, nativeType, typeParams) if no init hook
 */
export type TypeHelperRegistry = Record<string, unknown>;

/**
 * Minimal context interface for SQL query lanes.
 *
 * Lanes only need contract, operations, and codecs to build typed ASTs and attach
 * operation builders. This interface explicitly excludes runtime concerns like
 * adapters, connection management, and transaction state.
 */
export interface ExecutionContext<
  TContract extends SqlContract<SqlStorage> = SqlContract<SqlStorage>,
> {
  readonly contract: TContract;
  readonly operations: OperationRegistry;
  readonly codecs: CodecRegistry;
  /**
   * Type helper registry for parameterized types.
   * Schema builders expose these helpers via schema.types.
   */
  readonly types: TypeHelperRegistry;
}

export type QueryLaneContext<TContract extends SqlContract<SqlStorage> = SqlContract<SqlStorage>> =
  ExecutionContext<TContract>;
