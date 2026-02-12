import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import type {
  Adapter,
  DeleteAst,
  InsertAst,
  LoweredStatement,
  SelectAst,
  UpdateAst,
} from '@prisma-next/sql-relational-core/ast';
import { createCodecRegistry } from '@prisma-next/sql-relational-core/ast';
import { param } from '@prisma-next/sql-relational-core/param';
import { schema } from '@prisma-next/sql-relational-core/schema';
import type { BinaryBuilder } from '@prisma-next/sql-relational-core/types';
import type { SqlRuntimeExtensionDescriptor } from '@prisma-next/sql-runtime';
import { createTestContext } from '@prisma-next/sql-runtime/test/utils';
import { describe, expect, it } from 'vitest';
import { sql } from '../src/sql/builder';

function createStubAdapter(): Adapter<
  SelectAst | InsertAst | UpdateAst | DeleteAst,
  SqlContract<SqlStorage>,
  LoweredStatement
> {
  return {
    profile: {
      id: 'stub-profile',
      target: 'postgres',
      capabilities: {},
      codecs() {
        return createCodecRegistry();
      },
    },
    lower(
      ast: SelectAst | InsertAst | UpdateAst | DeleteAst,
      ctx: { contract: SqlContract<SqlStorage>; params?: readonly unknown[] },
    ) {
      const sqlText = JSON.stringify(ast);
      return {
        profileId: this.profile.id,
        body: Object.freeze({ sql: sqlText, params: ctx.params ? [...ctx.params] : [] }),
      };
    },
  };
}

describe('delete with vector operations', () => {
  const contractWithVector = validateContract<SqlContract<SqlStorage>>({
    target: 'postgres',
    targetFamily: 'sql',
    storageHash: 'sha256:test-storage-hash',
    profileHash: 'sha256:test-profile-hash',
    storage: {
      tables: {
        user: {
          columns: {
            id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
            email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
            vector: { nativeType: 'vector', codecId: 'pg/vector@1', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      },
    },
    models: {},
    relations: {},
    mappings: {},
  });

  const adapterWithOps = createStubAdapter();
  const cosineDistanceOp = {
    forTypeId: 'pg/vector@1' as const,
    method: 'cosineDistance' as const,
    args: [{ kind: 'param' as const }] as const,
    returns: { kind: 'builtin' as const, type: 'number' as const },
    lowering: {
      targetFamily: 'sql' as const,
      strategy: 'infix' as const,
      // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
      template: '${self} <=> ${arg0}',
    },
  };
  const mockVectorExtensionDescriptor: SqlRuntimeExtensionDescriptor<'postgres'> = {
    kind: 'extension' as const,
    id: 'mock-vector-ext',
    version: '0.0.1',
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
    codecs: () => createCodecRegistry(),
    operationSignatures: () => [cosineDistanceOp],
    parameterizedCodecs: () => [],
    create: () => ({
      familyId: 'sql' as const,
      targetId: 'postgres' as const,
      operations: () => [cosineDistanceOp],
    }),
  };
  const contextWithOps = createTestContext(contractWithVector, adapterWithOps, {
    extensionPacks: [mockVectorExtensionDescriptor],
  });
  const tablesWithOps = schema(contextWithOps).tables;
  const userTableWithOps = tablesWithOps['user'];
  if (!userTableWithOps) throw new Error('user table not found');
  const vectorColumn = userTableWithOps.columns['vector'];
  if (!vectorColumn) throw new Error('vector column not found');

  it('builds delete plan with operation in where clause', () => {
    const distance = (
      vectorColumn as unknown as {
        cosineDistance: (arg: unknown) => { eq: (value: unknown) => unknown };
      }
    ).cosineDistance(param('other'));
    const binary = distance.eq(param('threshold')) as BinaryBuilder;

    const plan = sql({ context: contextWithOps })
      .delete(userTableWithOps)
      .where(binary)
      .build({ params: { other: [1, 2, 3], threshold: 0.5 } });

    expect(plan.ast).toMatchObject({
      kind: 'delete',
      table: { name: 'user' },
      where: expect.objectContaining({
        kind: 'bin',
        op: 'eq',
      }),
    });
    expect(plan.params).toContain(0.5);
  });
});
