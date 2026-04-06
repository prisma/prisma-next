import type { Contract } from '@prisma-next/contract/types';
import { createOperationRegistry } from '@prisma-next/operations';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { SqlOperationSignature } from '@prisma-next/sql-operations';
import type { Adapter, CodecRegistry, LoweredStatement, SelectAst } from '../src/exports/ast';
import { createCodecRegistry } from '../src/exports/ast';
import type { ExecutionContext } from '../src/exports/query-lane-context';
import { createQueryOperationRegistry } from '../src/query-operation-registry';

/**
 * Creates a stub adapter for testing.
 * This helper DRYs up the common pattern of adapter creation in tests.
 */
export function createStubAdapter(): Adapter<SelectAst, Contract<SqlStorage>, LoweredStatement> {
  return {
    profile: {
      id: 'stub-profile',
      target: 'postgres',
      capabilities: {},
      codecs() {
        return createCodecRegistry();
      },
    },
    lower(ast: SelectAst, ctx: { contract: Contract<SqlStorage>; params?: readonly unknown[] }) {
      const sqlText = JSON.stringify(ast);
      return {
        profileId: this.profile.id,
        body: Object.freeze({ sql: sqlText, params: ctx.params ? [...ctx.params] : [] }),
      };
    },
  };
}

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
