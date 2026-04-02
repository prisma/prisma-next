import type {
  OperationDescriptor,
  OperationEntry,
  OperationRegistry,
} from '@prisma-next/operations';
import { createOperationRegistry } from '@prisma-next/operations';

export interface SqlLoweringSpec {
  readonly targetFamily: 'sql';
  readonly strategy: 'infix' | 'function';
  readonly template: string;
}

export interface SqlOperationEntry extends OperationEntry {
  readonly lowering: SqlLoweringSpec;
}

export type SqlOperationDescriptor = OperationDescriptor<SqlOperationEntry>;

export type SqlOperationRegistry = OperationRegistry<SqlOperationEntry>;

export function createSqlOperationRegistry(): SqlOperationRegistry {
  return createOperationRegistry<SqlOperationEntry>();
}
