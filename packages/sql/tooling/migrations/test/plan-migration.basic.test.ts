import {
  col,
  contract,
  fk,
  index,
  pk,
  storage,
  table,
  unique,
} from '@prisma-next/sql-contract/factories';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import type { SqlColumnIR, SqlSchemaIR, SqlTableIR } from '@prisma-next/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import { SqlMigrationPlanningError } from '../src/errors';
import type { MigrationPolicy } from '../src/ir';
import { planMigration } from '../src/plan-migration';

/**
 * Creates an empty SQL contract for testing.
 */
function createEmptyContract(target = 'postgres'): SqlContract<SqlStorage> {
  return contract({
    target,
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

/**
 * Creates a schema IR with a table for testing.
 */
function createSchemaIRWithTable(
  tableName: string,
  columns: Record<string, SqlColumnIR>,
  options?: {
    primaryKey?: { readonly columns: readonly string[]; readonly name?: string };
    uniques?: readonly { readonly columns: readonly string[]; readonly name?: string }[];
    indexes?: readonly {
      readonly columns: readonly string[];
      readonly name?: string;
      readonly unique?: boolean;
    }[];
    foreignKeys?: readonly {
      readonly columns: readonly string[];
      readonly referencedTable: string;
      readonly referencedColumns: readonly string[];
      readonly name?: string;
    }[];
  },
): SqlSchemaIR {
  const table: SqlTableIR = {
    name: tableName,
    columns,
    ...(options?.primaryKey && { primaryKey: options.primaryKey }),
    uniques: options?.uniques ?? [],
    indexes: (options?.indexes ?? []).map((idx) => ({
      ...idx,
      unique: idx.unique ?? false,
    })),
    foreignKeys: options?.foreignKeys ?? [],
  };
  return {
    tables: { [tableName]: table },
    extensions: [],
  };
}

describe('planMigration', () => {
  const initPolicy: MigrationPolicy = {
    mode: 'init',
    allowedOperationClasses: ['additive', 'widening'],
  };

  describe('empty database (Case 1)', () => {
    it('plans full create table operation for single table', () => {
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
                uniques: [unique('email')],
              },
            ),
          }),
        }),
      );
      const liveSchema = createEmptySchemaIR();

      const plan = planMigration({
        fromContract,
        toContract,
        liveSchema,
        policy: initPolicy,
      });

      expect(plan.operations.length).toBe(1);
      expect(plan.operations[0]).toMatchObject({
        kind: 'createTable',
        table: 'user',
        columns: {
          id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
          email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
        },
        primaryKey: { columns: ['id'] },
        uniques: [{ columns: ['email'] }],
      });
    });

    it('plans create table with all constraints and indexes', () => {
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
                uniques: [unique('email')],
                indexes: [index('email')],
              },
            ),
            post: table(
              {
                id: col('int4', 'pg/int4@1', false),
                userId: col('int4', 'pg/int4@1', false),
                title: col('text', 'pg/text@1', false),
              },
              {
                pk: pk('id'),
                indexes: [index('userId')],
                fks: [fk(['userId'], 'user', ['id'])],
              },
            ),
          }),
        }),
      );
      const liveSchema = createEmptySchemaIR();

      const plan = planMigration({
        fromContract,
        toContract,
        liveSchema,
        policy: initPolicy,
      });

      expect(plan.operations.length).toBe(2);
      expect(plan.operations[0]).toMatchObject({
        kind: 'createTable',
        table: 'user',
      });
      expect(plan.operations[1]).toMatchObject({
        kind: 'createTable',
        table: 'post',
        foreignKeys: [{ columns: ['userId'], references: { table: 'user', columns: ['id'] } }],
      });
    });
  });

  describe('subset database (Case 2)', () => {
    it('plans only missing columns', () => {
      const fromContract = createEmptyContract();
      const toContract = validateContract<SqlContract<SqlStorage>>(
        contract({
          target: 'postgres',
          coreHash: 'sha256:test',
          storage: storage({
            user: table({
              id: col('int4', 'pg/int4@1', false),
              email: col('text', 'pg/text@1', false),
              name: col('text', 'pg/text@1', true),
            }),
          }),
        }),
      );
      const liveSchema = createSchemaIRWithTable('user', {
        id: { name: 'id', nativeType: 'int4', nullable: false },
        email: { name: 'email', nativeType: 'text', nullable: false },
      });

      const plan = planMigration({
        fromContract,
        toContract,
        liveSchema,
        policy: initPolicy,
      });

      expect(plan.operations.length).toBe(1);
      expect(plan.operations[0]).toMatchObject({
        kind: 'addColumn',
        table: 'user',
        column: 'name',
        definition: { nativeType: 'text', codecId: 'pg/text@1', nullable: true },
      });
    });

    it('plans missing primary key, unique, index, and foreign key', () => {
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
                uniques: [unique('email')],
                indexes: [index('email')],
              },
            ),
            post: table(
              {
                id: col('int4', 'pg/int4@1', false),
                userId: col('int4', 'pg/int4@1', false),
              },
              {
                pk: pk('id'),
                indexes: [index('userId')],
                fks: [fk(['userId'], 'user', ['id'])],
              },
            ),
          }),
        }),
      );
      const liveSchema = createSchemaIRWithTable('user', {
        id: { name: 'id', nativeType: 'int4', nullable: false },
        email: { name: 'email', nativeType: 'text', nullable: false },
      });
      liveSchema.tables['post'] = {
        name: 'post',
        columns: {
          id: { name: 'id', nativeType: 'int4', nullable: false },
          userId: { name: 'userId', nativeType: 'int4', nullable: false },
        },
        primaryKey: undefined,
        foreignKeys: [],
        uniques: [],
        indexes: [],
      };

      const plan = planMigration({
        fromContract,
        toContract,
        liveSchema,
        policy: initPolicy,
      });

      expect(plan.operations.length).toBeGreaterThan(0);
      const operationKinds = plan.operations.map((op) => op.kind);
      expect(operationKinds).toContain('addPrimaryKey');
      expect(operationKinds).toContain('addUniqueConstraint');
      expect(operationKinds).toContain('addIndex');
      expect(operationKinds).toContain('addForeignKey');
    });
  });

  describe('superset database (Case 3)', () => {
    it('plans no operations when all required structures exist', () => {
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
                uniques: [unique('email')],
              },
            ),
          }),
        }),
      );
      const liveSchema = createSchemaIRWithTable(
        'user',
        {
          id: { name: 'id', nativeType: 'int4', nullable: false },
          email: { name: 'email', nativeType: 'text', nullable: false },
        },
        {
          primaryKey: { columns: ['id'] },
          uniques: [{ columns: ['email'] }],
        },
      );
      // Add extra column not in contract
      liveSchema.tables['user'].columns['extra'] = {
        name: 'extra',
        nativeType: 'text',
        nullable: true,
      };

      const plan = planMigration({
        fromContract,
        toContract,
        liveSchema,
        policy: initPolicy,
      });

      expect(plan.operations.length).toBe(0);
      expect(plan.summary).toContain('No operations needed');
    });

    it('tolerates extra tables not in contract', () => {
      const fromContract = createEmptyContract();
      const toContract = validateContract<SqlContract<SqlStorage>>(
        contract({
          target: 'postgres',
          coreHash: 'sha256:test',
          storage: storage({
            user: table({
              id: col('int4', 'pg/int4@1', false),
            }),
          }),
        }),
      );
      const liveSchema = createSchemaIRWithTable('user', {
        id: { name: 'id', nativeType: 'int4', nullable: false },
      });
      // Add extra table not in contract
      liveSchema.tables['extra'] = {
        name: 'extra',
        columns: {
          id: { name: 'id', nativeType: 'int4', nullable: false },
        },
        foreignKeys: [],
        uniques: [],
        indexes: [],
      };

      const plan = planMigration({
        fromContract,
        toContract,
        liveSchema,
        policy: initPolicy,
      });

      expect(plan.operations.length).toBe(0);
    });
  });

  describe('conflict database (Case 4)', () => {
    it('throws error for incompatible column type', () => {
      const fromContract = createEmptyContract();
      const toContract = validateContract<SqlContract<SqlStorage>>(
        contract({
          target: 'postgres',
          coreHash: 'sha256:test',
          storage: storage({
            user: table({
              id: col('int4', 'pg/int4@1', false),
              email: col('text', 'pg/text@1', false),
            }),
          }),
        }),
      );
      const liveSchema = createSchemaIRWithTable('user', {
        id: { name: 'id', nativeType: 'int4', nullable: false },
        email: { name: 'email', nativeType: 'int8', nullable: false }, // Wrong type
      });

      expect(() => {
        planMigration({
          fromContract,
          toContract,
          liveSchema,
          policy: initPolicy,
        });
      }).toThrow(SqlMigrationPlanningError);
    });

    it('throws error for incompatible nullability (contract requires non-null, schema has nullable)', () => {
      const fromContract = createEmptyContract();
      const toContract = validateContract<SqlContract<SqlStorage>>(
        contract({
          target: 'postgres',
          coreHash: 'sha256:test',
          storage: storage({
            user: table({
              id: col('int4', 'pg/int4@1', false),
              email: col('text', 'pg/text@1', false), // Contract requires non-null
            }),
          }),
        }),
      );
      const liveSchema = createSchemaIRWithTable('user', {
        id: { name: 'id', nativeType: 'int4', nullable: false },
        email: { name: 'email', nativeType: 'text', nullable: true }, // Schema has nullable
      });

      expect(() => {
        planMigration({
          fromContract,
          toContract,
          liveSchema,
          policy: initPolicy,
        });
      }).toThrow(SqlMigrationPlanningError);
    });

    it('throws error for conflicting primary key', () => {
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
      const liveSchema = createSchemaIRWithTable(
        'user',
        {
          id: { name: 'id', nativeType: 'int4', nullable: false },
          email: { name: 'email', nativeType: 'text', nullable: false },
        },
        {
          primaryKey: { columns: ['email'] }, // Different PK
        },
      );

      expect(() => {
        planMigration({
          fromContract,
          toContract,
          liveSchema,
          policy: initPolicy,
        });
      }).toThrow(SqlMigrationPlanningError);
    });

    it('throws error when contracts have different targets', () => {
      const fromContract = createEmptyContract('postgres');
      const toContract = validateContract<SqlContract<SqlStorage>>(
        contract({
          target: 'mysql', // Different target
          coreHash: 'sha256:test',
          storage: storage({
            user: table({
              id: col('int4', 'pg/int4@1', false),
            }),
          }),
        }),
      );
      const liveSchema = createEmptySchemaIR();

      expect(() => {
        planMigration({
          fromContract,
          toContract,
          liveSchema,
          policy: initPolicy,
        });
      }).toThrow(SqlMigrationPlanningError);
    });
  });

  describe('extension operations', () => {
    it('plans extension creation when extension is enabled but missing', () => {
      const fromContract = createEmptyContract();
      const toContract = validateContract<SqlContract<SqlStorage>>(
        contract({
          target: 'postgres',
          coreHash: 'sha256:test',
          storage: storage({
            user: table({
              id: col('int4', 'pg/int4@1', false),
            }),
          }),
          extensions: {
            pgvector: { enabled: true },
          },
        }),
      );
      const liveSchema = createEmptySchemaIR();

      const plan = planMigration({
        fromContract,
        toContract,
        liveSchema,
        policy: initPolicy,
      });

      const extensionOps = plan.operations.filter((op) => op.kind === 'extensionOperation');
      expect(extensionOps.length).toBeGreaterThan(0);
      expect(extensionOps[0]).toMatchObject({
        kind: 'extensionOperation',
        extensionId: 'pgvector',
        operationId: 'createExtension',
      });
    });

    it('plans no extension operation when extension already exists', () => {
      const fromContract = createEmptyContract();
      const toContract = validateContract<SqlContract<SqlStorage>>(
        contract({
          target: 'postgres',
          coreHash: 'sha256:test',
          storage: storage({
            user: table({
              id: col('int4', 'pg/int4@1', false),
            }),
          }),
          extensions: {
            pgvector: { enabled: true },
          },
        }),
      );
      const liveSchema: SqlSchemaIR = {
        tables: {},
        extensions: ['vector'], // Extension already exists
      };

      const plan = planMigration({
        fromContract,
        toContract,
        liveSchema,
        policy: initPolicy,
      });

      const extensionOps = plan.operations.filter((op) => op.kind === 'extensionOperation');
      expect(extensionOps.length).toBe(0);
    });
  });

  describe('policy enforcement', () => {
    it('throws error when additive operations are not allowed', () => {
      const fromContract = createEmptyContract();
      const toContract = validateContract<SqlContract<SqlStorage>>(
        contract({
          target: 'postgres',
          coreHash: 'sha256:test',
          storage: storage({
            user: table({
              id: col('int4', 'pg/int4@1', false),
            }),
          }),
        }),
      );
      const liveSchema = createEmptySchemaIR();

      const restrictivePolicy: MigrationPolicy = {
        mode: 'init',
        allowedOperationClasses: [], // No operations allowed
      };

      expect(() => {
        planMigration({
          fromContract,
          toContract,
          liveSchema,
          policy: restrictivePolicy,
        });
      }).toThrow(SqlMigrationPlanningError);
    });
  });
});
