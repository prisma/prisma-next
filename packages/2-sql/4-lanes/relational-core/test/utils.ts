import type { Contract } from '@prisma-next/contract/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { createSqlOperationRegistry } from '@prisma-next/sql-operations';
import type { Adapter, LoweredStatement, SelectAst } from '../src/exports/ast';
import { createCodecRegistry } from '../src/exports/ast';
import type { ExecutionContext } from '../src/exports/query-lane-context';

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
      readMarkerStatement: () => ({ sql: '', params: [] }),
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

/**
 * Creates an ExecutionContext for testing.
 * This helper DRYs up the common pattern of context creation in tests.
 * Note: This creates an ExecutionContext, so it doesn't include an adapter.
 *
 * @param contract - The SQL contract
 */
export function createTestContext<TContract extends Contract<SqlStorage>>(
  contract: TContract,
): ExecutionContext<TContract> {
  const codecRegistry = createCodecRegistry();

  return {
    contract,
    codecs: codecRegistry,
    queryOperations: createSqlOperationRegistry(),
    types: {},
    applyMutationDefaults: () => [],
  };
}
