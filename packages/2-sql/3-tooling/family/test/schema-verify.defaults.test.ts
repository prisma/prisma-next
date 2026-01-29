import { describe, expect, it } from 'vitest';
import { verifySqlSchema } from '../src/core/schema-verify/verify-sql-schema';
import {
  createContractTable,
  createSchemaTable,
  createTestContract,
  createTestSchemaIR,
  emptyTypeMetadataRegistry,
} from './schema-verify.helpers';

describe('verifySqlSchema - defaults', () => {
  it('returns default_missing when contract default is absent in schema', () => {
    const contract = createTestContract({
      user: createContractTable({
        id: {
          nativeType: 'int4',
          nullable: false,
          default: { kind: 'function', expression: 'now()' },
        },
      }),
    });

    const schema = createTestSchemaIR({
      user: createSchemaTable('user', {
        id: { nativeType: 'int4', nullable: false },
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
        kind: 'default_missing',
        table: 'user',
        column: 'id',
      }),
    );
  });

  it('returns default_mismatch when defaults differ', () => {
    const contract = createTestContract({
      user: createContractTable({
        status: {
          nativeType: 'text',
          nullable: false,
          default: { kind: 'literal', expression: "'draft'" },
        },
      }),
    });

    const schema = createTestSchemaIR({
      user: createSchemaTable('user', {
        status: {
          nativeType: 'text',
          nullable: false,
          default: { kind: 'literal', expression: "'published'" },
        },
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
        kind: 'default_mismatch',
        table: 'user',
        column: 'status',
      }),
    );
  });

  it('treats normalized defaults as equal', () => {
    const contract = createTestContract({
      user: createContractTable({
        created_at: {
          nativeType: 'timestamptz',
          nullable: false,
          default: { kind: 'function', expression: 'now()' },
        },
        label: {
          nativeType: 'text',
          nullable: false,
          default: { kind: 'literal', expression: "'draft'" },
        },
      }),
    });

    const schema = createTestSchemaIR({
      user: createSchemaTable('user', {
        created_at: {
          nativeType: 'timestamptz',
          nullable: false,
          default: { kind: 'function', expression: ' NOW ( ) ' },
        },
        label: {
          nativeType: 'text',
          nullable: false,
          default: { kind: 'literal', expression: "  'draft'  " },
        },
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
