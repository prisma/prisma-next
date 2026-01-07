import type {
  OperationSignature as CoreOperationSignature,
  OperationRegistry,
} from '@prisma-next/operations';
import { createOperationRegistry } from '@prisma-next/operations';

export interface SqlLoweringSpec {
  readonly targetFamily: 'sql';
  readonly strategy: 'infix' | 'function';
  readonly template: string;
}

export interface SqlOperationSignature extends CoreOperationSignature {
  readonly lowering: SqlLoweringSpec;
}

export type SqlOperationRegistry = OperationRegistry<SqlOperationSignature>;

export function createSqlOperationRegistry(): SqlOperationRegistry {
  return createOperationRegistry<SqlOperationSignature>();
}

export function register(registry: SqlOperationRegistry, signature: SqlOperationSignature): void {
  registry.register(signature);
}
