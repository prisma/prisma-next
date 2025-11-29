import postgresAdapter from '@prisma-next/adapter-postgres/control';
import postgresDriver from '@prisma-next/driver-postgres/control';
import sql from '@prisma-next/family-sql/control';
import { col, contract, pk, storage, table } from '@prisma-next/sql-contract/factories';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import postgres from '@prisma-next/targets-postgres/control';
import { describe, expect, it } from 'vitest';

/**
 * Creates an empty SQL contract for testing.
 */
function createEmptyContract(): SqlContract<SqlStorage> {
  return contract({
    target: 'postgres',
    coreHash: 'sha256:empty',
    storage: storage({}),
  });
}

/**
 * Creates an empty schema IR for testing.
 */
function createEmptySchemaIR(): SqlSchemaIR {
  return {
    tables: {},
    extensions: [],
  };
}

describe('family instance planMigration', () => {
  it('plans migration from empty contract to target contract', () => {
    const familyInstance = sql.create({
      target: postgres,
      adapter: postgresAdapter,
      driver: postgresDriver,
      extensions: [],
    });

    const fromContract = createEmptyContract();
    const toContract = validateContract<SqlContract<SqlStorage>>(
      contract({
        target: 'postgres',
        coreHash: 'sha256:test',
        storage: storage({
          user: table(
            {
              id: col('int4', 'pg/int4@1', false),
              email: col('text', 'pg/text@1', false),
            },
            {
              pk: pk('id'),
            },
          ),
        }),
      }),
    );
    const liveSchema = createEmptySchemaIR();

    const plan = familyInstance.planMigration({
      fromContract,
      toContract,
      liveSchema,
      policy: {
        mode: 'init',
        allowedOperationClasses: ['additive', 'widening'],
      },
    });

    expect(plan.operations.length).toBe(1);
    expect(plan.operations[0]).toMatchObject({
      kind: 'createTable',
      table: 'user',
    });
    expect(plan.mode).toBe('init');
  });

  it('plans no operations when schema already satisfies contract', () => {
    const familyInstance = sql.create({
      target: postgres,
      adapter: postgresAdapter,
      driver: postgresDriver,
      extensions: [],
    });

    const fromContract = createEmptyContract();
    const toContract = validateContract<SqlContract<SqlStorage>>(
      contract({
        target: 'postgres',
        coreHash: 'sha256:test',
        storage: storage({
          user: table(
            {
              id: col('int4', 'pg/int4@1', false),
              email: col('text', 'pg/text@1', false),
            },
            {
              pk: pk('id'),
            },
          ),
        }),
      }),
    );
    const liveSchema: SqlSchemaIR = {
      tables: {
        user: {
          name: 'user',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
            email: { name: 'email', nativeType: 'text', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
      extensions: [],
    };

    const plan = familyInstance.planMigration({
      fromContract,
      toContract,
      liveSchema,
      policy: {
        mode: 'init',
        allowedOperationClasses: ['additive', 'widening'],
      },
    });

    expect(plan.operations.length).toBe(0);
    expect(plan.summary).toContain('No operations needed');
  });
});
