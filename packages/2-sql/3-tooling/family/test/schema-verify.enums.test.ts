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

  it('extracts enums from explicit storage.enums definitions', () => {
    const contractWithExplicitEnums = createTestContract({
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
    // Add explicit enum definition
    (
      contractWithExplicitEnums.storage as { enums?: Record<string, { values: readonly string[] }> }
    ).enums = {
      Role: { values: ['USER', 'ADMIN', 'MODERATOR'] },
      Status: { values: ['ACTIVE', 'INACTIVE'] },
    };

    const extracted = extractEnumsFromContract(contractWithExplicitEnums);
    // Explicit enums should be extracted
    expect(extracted['Role']).toEqual(['USER', 'ADMIN', 'MODERATOR']);
    expect(extracted['Status']).toEqual(['ACTIVE', 'INACTIVE']);
  });

  it('prefers explicit enums over column-derived enums when both exist', () => {
    const contractWithBoth = createTestContract({
      user: createContractTable({
        id: { nativeType: 'int4', nullable: false },
        role: {
          nativeType: 'Role',
          codecId: 'pg/enum@1',
          nullable: false,
          typeParams: { values: ['USER', 'ADMIN'] }, // Column-derived
        },
      }),
    });
    // Add explicit enum definition with different values
    (contractWithBoth.storage as { enums?: Record<string, { values: readonly string[] }> }).enums =
      {
        Role: { values: ['USER', 'ADMIN', 'MODERATOR'] }, // Explicit (different)
      };

    const extracted = extractEnumsFromContract(contractWithBoth);
    // Explicit enum should take precedence
    expect(extracted['Role']).toEqual(['USER', 'ADMIN', 'MODERATOR']);
  });
});
