import { describe, expect, it } from 'vitest';
import { verifySqlSchema } from '../src/core/schema-verify/verify-sql-schema';
import {
  createContractTable,
  createSchemaTable,
  createTestContract,
  createTestSchemaIR,
  emptyTypeMetadataRegistry,
} from './schema-verify.helpers';

describe('verifySqlSchema - enums', () => {
  describe('matching enums', () => {
    it('returns ok: true when schema enums match contract enums', () => {
      const contract = createTestContract(
        {
          user: createContractTable({
            id: { nativeType: 'int4', nullable: false },
          }),
        },
        {},
        {
          role: { values: ['USER', 'ADMIN', 'MODERATOR'] },
        },
      );

      const schema = createTestSchemaIR(
        {
          user: createSchemaTable('user', {
            id: { nativeType: 'int4', nullable: false },
          }),
        },
        [],
        {
          role: { name: 'role', values: ['USER', 'ADMIN', 'MODERATOR'] },
        },
      );

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

  describe('missing enum', () => {
    it('returns enum_missing issue when contract enum is not in schema', () => {
      const contract = createTestContract(
        {
          user: createContractTable({
            id: { nativeType: 'int4', nullable: false },
          }),
        },
        {},
        {
          role: { values: ['USER', 'ADMIN'] },
        },
      );

      const schema = createTestSchemaIR(
        {
          user: createSchemaTable('user', {
            id: { nativeType: 'int4', nullable: false },
          }),
        },
        [],
        {}, // No enums in schema
      );

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
          kind: 'enum_missing',
          enumName: 'role',
        }),
      );
    });
  });

  describe('enum values mismatch', () => {
    it('returns enum_values_mismatch when values differ', () => {
      const contract = createTestContract(
        {
          user: createContractTable({
            id: { nativeType: 'int4', nullable: false },
          }),
        },
        {},
        {
          role: { values: ['USER', 'ADMIN', 'MODERATOR'] },
        },
      );

      const schema = createTestSchemaIR(
        {
          user: createSchemaTable('user', {
            id: { nativeType: 'int4', nullable: false },
          }),
        },
        [],
        {
          role: { name: 'role', values: ['USER', 'ADMIN'] }, // Missing MODERATOR
        },
      );

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
          kind: 'enum_values_mismatch',
          enumName: 'role',
          expected: 'USER, ADMIN, MODERATOR',
          actual: 'USER, ADMIN',
        }),
      );
    });

    it('returns enum_values_mismatch when order differs', () => {
      const contract = createTestContract(
        {
          user: createContractTable({
            id: { nativeType: 'int4', nullable: false },
          }),
        },
        {},
        {
          role: { values: ['USER', 'ADMIN'] },
        },
      );

      const schema = createTestSchemaIR(
        {
          user: createSchemaTable('user', {
            id: { nativeType: 'int4', nullable: false },
          }),
        },
        [],
        {
          role: { name: 'role', values: ['ADMIN', 'USER'] }, // Different order
        },
      );

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
          kind: 'enum_values_mismatch',
          enumName: 'role',
        }),
      );
    });
  });

  describe('multiple enums', () => {
    it('verifies multiple enums correctly', () => {
      const contract = createTestContract(
        {
          user: createContractTable({
            id: { nativeType: 'int4', nullable: false },
          }),
        },
        {},
        {
          role: { values: ['USER', 'ADMIN'] },
          status: { values: ['ACTIVE', 'INACTIVE'] },
        },
      );

      const schema = createTestSchemaIR(
        {
          user: createSchemaTable('user', {
            id: { nativeType: 'int4', nullable: false },
          }),
        },
        [],
        {
          role: { name: 'role', values: ['USER', 'ADMIN'] },
          status: { name: 'status', values: ['ACTIVE', 'INACTIVE'] },
        },
      );

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

    it('reports multiple enum issues', () => {
      const contract = createTestContract(
        {
          user: createContractTable({
            id: { nativeType: 'int4', nullable: false },
          }),
        },
        {},
        {
          role: { values: ['USER', 'ADMIN'] },
          status: { values: ['ACTIVE', 'INACTIVE'] },
        },
      );

      const schema = createTestSchemaIR(
        {
          user: createSchemaTable('user', {
            id: { nativeType: 'int4', nullable: false },
          }),
        },
        [],
        {}, // Both enums missing
      );

      const result = verifySqlSchema({
        contract,
        schema,
        strict: false,
        typeMetadataRegistry: emptyTypeMetadataRegistry,
        frameworkComponents: [],
      });

      expect(result.ok).toBe(false);
      expect(result.schema.issues).toHaveLength(2);
      expect(result.schema.issues).toContainEqual(
        expect.objectContaining({
          kind: 'enum_missing',
          enumName: 'role',
        }),
      );
      expect(result.schema.issues).toContainEqual(
        expect.objectContaining({
          kind: 'enum_missing',
          enumName: 'status',
        }),
      );
    });
  });

  describe('verification tree', () => {
    it('includes enum nodes in verification tree', () => {
      const contract = createTestContract(
        {
          user: createContractTable({
            id: { nativeType: 'int4', nullable: false },
          }),
        },
        {},
        {
          role: { values: ['USER', 'ADMIN'] },
        },
      );

      const schema = createTestSchemaIR(
        {
          user: createSchemaTable('user', {
            id: { nativeType: 'int4', nullable: false },
          }),
        },
        [],
        {
          role: { name: 'role', values: ['USER', 'ADMIN'] },
        },
      );

      const result = verifySqlSchema({
        contract,
        schema,
        strict: false,
        typeMetadataRegistry: emptyTypeMetadataRegistry,
        frameworkComponents: [],
      });

      const enumNode = result.schema.root.children.find(
        (c) => c.kind === 'enum' && c.name.includes('role'),
      );
      expect(enumNode).toBeDefined();
      expect(enumNode?.status).toBe('pass');
    });
  });
});
