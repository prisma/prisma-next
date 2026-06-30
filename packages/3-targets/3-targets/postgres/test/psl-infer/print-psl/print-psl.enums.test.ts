import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import { inferPslAstFromFlat as sqlSchemaIrToPslAst } from '../fixtures';

describe('inferPostgresPslContract — native enum diagnostic', () => {
  it('throws when the schema contains a nativeEnumTypeNames annotation', () => {
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
          nativeEnumTypeNames: ['user_role'],
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
          nativeEnumTypeNames: ['deployment_status', 'another_enum'],
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
          nativeEnumTypeNames: ['Role'],
        },
      },
    };

    expect(() => sqlSchemaIrToPslAst(schemaIR)).toThrow(/pg\/text@1/);
  });
});
