import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import { sqlSchemaIrToPslAst } from '../../../src/core/psl-contract-infer/sql-schema-ir-to-psl-ast';

describe('sqlSchemaIrToPslAst — native enum diagnostic', () => {
  it('throws when the schema contains a pg/enum@1 annotation', () => {
    const schemaIR: SqlSchemaIR = {
      tables: {
        user: {
          name: 'user',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
            role: { name: 'role', nativeType: 'user_role', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
      annotations: {
        pg: {
          enumTypes: {
            public: {
              user_role: {
                codecId: 'pg/enum@1',
                nativeType: 'user_role',
                typeParams: { values: ['USER', 'ADMIN', 'MODERATOR'] },
              },
            },
          },
        },
      },
    };

    expect(() => sqlSchemaIrToPslAst(schemaIR)).toThrow(
      /contract infer:.*native Postgres enum type.*user_role.*not adoptable/i,
    );
  });

  it('names every type in the error when multiple native enums are present', () => {
    const schemaIR: SqlSchemaIR = {
      tables: {
        deployment: {
          name: 'deployment',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
            status: { name: 'status', nativeType: 'deployment_status', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
      annotations: {
        pg: {
          enumTypes: {
            public: {
              deployment_status: {
                codecId: 'pg/enum@1',
                nativeType: 'deployment_status',
                typeParams: { values: ['READY', 'in-progress'] },
              },
              another_enum: {
                codecId: 'pg/enum@1',
                nativeType: 'another_enum',
                typeParams: { values: ['A', 'B'] },
              },
            },
          },
        },
      },
    };

    let error: Error | undefined;
    try {
      sqlSchemaIrToPslAst(schemaIR);
    } catch (e) {
      error = e as Error;
    }
    expect(error?.message).toContain('deployment_status');
    expect(error?.message).toContain('another_enum');
  });

  it('mentions the value-set replacement approach in the error', () => {
    const schemaIR: SqlSchemaIR = {
      tables: {
        user: {
          name: 'user',
          columns: { id: { name: 'id', nativeType: 'int4', nullable: false } },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
      annotations: {
        pg: {
          enumTypes: {
            public: {
              Role: {
                codecId: 'pg/enum@1',
                nativeType: 'Role',
                typeParams: { values: ['!!!'] },
              },
            },
          },
        },
      },
    };

    expect(() => sqlSchemaIrToPslAst(schemaIR)).toThrow(/pg\/text@1/);
  });
});
