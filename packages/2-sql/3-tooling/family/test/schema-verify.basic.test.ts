import { describe, expect, it } from 'vitest';
import { verifySqlSchema } from '../src/core/schema-verify/verify-sql-schema';
import {
  createContractTable,
  createSchemaTable,
  createTestContract,
  createTestSchemaIR,
  emptyTypeMetadataRegistry,
} from './schema-verify.helpers';

describe('verifySqlSchema - basic', () => {
  describe('matching schema', () => {
    it('returns ok: true when schema matches contract', () => {
      const contract = createTestContract({
        user: createContractTable({
          id: { nativeType: 'int4', nullable: false },
          email: { nativeType: 'text', nullable: false },
        }),
      });

      const schema = createTestSchemaIR({
        user: createSchemaTable('user', {
          id: { nativeType: 'int4', nullable: false },
          email: { nativeType: 'text', nullable: false },
        }),
      });

      const result = verifySqlSchema({
        contract,
        schema,
        strict: false,
        typeMetadataRegistry: emptyTypeMetadataRegistry,
        frameworkComponents: [],
      });

      expect(result.ok).toBe(true);
      expect(result.schema.issues).toHaveLength(0);
    });
  });

  describe('missing table', () => {
    it('returns missing_table issue when contract table is not in schema', () => {
      const contract = createTestContract({
        user: createContractTable({
          id: { nativeType: 'int4', nullable: false },
        }),
      });

      const schema = createTestSchemaIR({});

      const result = verifySqlSchema({
        contract,
        schema,
        strict: false,
        typeMetadataRegistry: emptyTypeMetadataRegistry,
        frameworkComponents: [],
      });

      expect(result.ok).toBe(false);
      expect(result.schema.issues).toContainEqual(
        expect.objectContaining({
          kind: 'missing_table',
          table: 'user',
        }),
      );
    });
  });

  describe('missing column', () => {
    it('returns missing_column issue when contract column is not in schema table', () => {
      const contract = createTestContract({
        user: createContractTable({
          id: { nativeType: 'int4', nullable: false },
          email: { nativeType: 'text', nullable: false },
        }),
      });

      const schema = createTestSchemaIR({
        user: createSchemaTable('user', {
          id: { nativeType: 'int4', nullable: false },
          // email column missing
        }),
      });

      const result = verifySqlSchema({
        contract,
        schema,
        strict: false,
        typeMetadataRegistry: emptyTypeMetadataRegistry,
        frameworkComponents: [],
      });

      expect(result.ok).toBe(false);
      expect(result.schema.issues).toContainEqual(
        expect.objectContaining({
          kind: 'missing_column',
          table: 'user',
          column: 'email',
        }),
      );
    });
  });

  describe('type mismatch', () => {
    it('returns type_mismatch issue when column types differ', () => {
      const contract = createTestContract({
        user: createContractTable({
          id: { nativeType: 'int4', nullable: false },
        }),
      });

      const schema = createTestSchemaIR({
        user: createSchemaTable('user', {
          id: { nativeType: 'int8', nullable: false }, // Different type
        }),
      });

      const result = verifySqlSchema({
        contract,
        schema,
        strict: false,
        typeMetadataRegistry: emptyTypeMetadataRegistry,
        frameworkComponents: [],
      });

      expect(result.ok).toBe(false);
      expect(result.schema.issues).toContainEqual(
        expect.objectContaining({
          kind: 'type_mismatch',
          table: 'user',
          column: 'id',
          expected: 'int4',
          actual: 'int8',
        }),
      );
    });
  });

  describe('nullability mismatch', () => {
    it('returns nullability_mismatch issue when nullability differs', () => {
      const contract = createTestContract({
        user: createContractTable({
          id: { nativeType: 'int4', nullable: false },
        }),
      });

      const schema = createTestSchemaIR({
        user: createSchemaTable('user', {
          id: { nativeType: 'int4', nullable: true }, // Different nullability
        }),
      });

      const result = verifySqlSchema({
        contract,
        schema,
        strict: false,
        typeMetadataRegistry: emptyTypeMetadataRegistry,
        frameworkComponents: [],
      });

      expect(result.ok).toBe(false);
      expect(result.schema.issues).toContainEqual(
        expect.objectContaining({
          kind: 'nullability_mismatch',
          table: 'user',
          column: 'id',
        }),
      );
    });
  });
});
