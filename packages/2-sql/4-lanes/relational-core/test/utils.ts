import type { Contract } from '@prisma-next/contract/types';
import { createOperationRegistry } from '@prisma-next/operations';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { SqlOperationSignature } from '@prisma-next/sql-operations';
import type { CodecRegistry } from '../src/exports/ast';
import { createCodecRegistry } from '../src/exports/ast';
import type { ExecutionContext } from '../src/exports/query-lane-context';
import { createQueryOperationRegistry } from '../src/query-operation-registry';

export interface Extension {
  codecs?(): CodecRegistry;
  operations?(): ReadonlyArray<SqlOperationSignature>;
}

export function createTestContext<TContract extends Contract<SqlStorage>>(
  contract: TContract,
  options?: {
    extensions?: ReadonlyArray<Extension>;
  },
): ExecutionContext<TContract> {
  const codecRegistry = createCodecRegistry();
  const operationRegistry = createOperationRegistry();

  const extensions = options?.extensions ?? [];
  for (const extension of extensions) {
    const extensionCodecs = extension.codecs?.();
    if (extensionCodecs) {
      for (const codec of extensionCodecs.values()) {
        codecRegistry.register(codec);
      }
    }

    const extensionOperations = extension.operations?.();
    if (extensionOperations) {
      for (const operation of extensionOperations) {
        operationRegistry.register(operation);
      }
    }
  }

  return {
    contract,
    codecs: codecRegistry,
    operations: operationRegistry,
    queryOperations: createQueryOperationRegistry(),
    types: {},
    applyMutationDefaults: () => [],
  };
}
