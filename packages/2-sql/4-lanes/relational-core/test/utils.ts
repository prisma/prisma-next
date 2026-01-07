import { createOperationRegistry } from '@prisma-next/operations';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { SqlOperationSignature } from '@prisma-next/sql-operations';
import type { Adapter, CodecRegistry, LoweredStatement, SelectAst } from '../src/exports/ast.ts';
import { createCodecRegistry } from '../src/exports/ast.ts';
import type { QueryLaneContext } from '../src/exports/query-lane-context.ts';

/**
 * Creates a stub adapter for testing.
 * This helper DRYs up the common pattern of adapter creation in tests.
 */
export function createStubAdapter(): Adapter<SelectAst, SqlContract<SqlStorage>, LoweredStatement> {
  return {
    profile: {
      id: 'stub-profile',
      target: 'postgres',
      capabilities: {},
      codecs() {
        return createCodecRegistry();
      },
    },
    lower(ast: SelectAst, ctx: { contract: SqlContract<SqlStorage>; params?: readonly unknown[] }) {
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

/**
 * Creates a QueryLaneContext for testing.
 * This helper DRYs up the common pattern of context creation in tests.
 * Note: This creates a QueryLaneContext (not RuntimeContext), so it doesn't include an adapter.
 *
 * @param contract - The SQL contract
 * @param adapter - Optional adapter (for backward compatibility with old test code, but not used)
 * @param options - Optional extensions to register operations and codecs
 */
export function createTestContext<TContract extends SqlContract<SqlStorage>>(
  contract: TContract,
  _adapter?: Adapter<SelectAst, SqlContract<SqlStorage>, LoweredStatement>,
  options?: {
    extensions?: ReadonlyArray<Extension>;
  },
): QueryLaneContext<TContract> {
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
  };
}
