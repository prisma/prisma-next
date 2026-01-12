import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import { extractEnumsFromContract } from '../src/core/schema-verify/enum-helpers';
import { verifySqlSchema } from '../src/core/schema-verify/verify-sql-schema';
import {
  createContractTable,
  createSchemaTable,
  createTestContract,
  createTestSchemaIR,
  emptyTypeMetadataRegistry,
} from './schema-verify.helpers';

describe('schema verification - enums', () => {
  const contract = createTestContract({
    user: createContractTable({
      id: { nativeType: 'int4', nullable: false },
      role: {
        nativeType: 'Role',
        codecId: 'pg/enum@1',
        nullable: false,
        typeParams: { values: ['USER', 'ADMIN'] },
      },
    }),
  });

  const baseSchemaTable = createSchemaTable('user', {
    id: { nativeType: 'int4', nullable: false },
    role: { nativeType: 'Role', nullable: false },
  });

  it('reports missing enums', () => {
    expect(extractEnumsFromContract(contract)).toEqual({ Role: ['USER', 'ADMIN'] });
    const schema = createTestSchemaIR({ user: baseSchemaTable });

    const result = verifySqlSchema({
      contract,
      schema,
      strict: true,
      typeMetadataRegistry: emptyTypeMetadataRegistry,
      frameworkComponents: [],
    });

    expect(result.ok).toBe(false);
    expect(result.schema.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'enum_missing', enumName: 'Role' })]),
    );
  });

  it('reports append-only enum value differences', () => {
    const schemaEnums: NonNullable<SqlSchemaIR['enums']> = {
      Role: { name: 'Role', values: ['USER'] },
    };
    const schema = { ...createTestSchemaIR({ user: baseSchemaTable }), enums: schemaEnums };

    const result = verifySqlSchema({
      contract,
      schema,
      strict: true,
      typeMetadataRegistry: emptyTypeMetadataRegistry,
      frameworkComponents: [],
    });

    expect(result.schema.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'enum_values_mismatch',
          enumName: 'Role',
          expected: ['USER', 'ADMIN'],
          actual: ['USER'],
        }),
      ]),
    );
  });

  it('passes when enums match', () => {
    const schemaEnums: NonNullable<SqlSchemaIR['enums']> = {
      Role: { name: 'Role', values: ['USER', 'ADMIN'] },
    };
    const schema = { ...createTestSchemaIR({ user: baseSchemaTable }), enums: schemaEnums };

    const result = verifySqlSchema({
      contract,
      schema,
      strict: true,
      typeMetadataRegistry: emptyTypeMetadataRegistry,
      frameworkComponents: [],
    });

    expect(result.ok).toBe(true);
    expect(result.schema.issues.length).toBe(0);
  });
});
