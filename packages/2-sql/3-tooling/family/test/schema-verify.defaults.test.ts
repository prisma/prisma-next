import type { ColumnDefault } from '@prisma-next/contract/types';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import { describe, expect, it } from 'vitest';
import type { DefaultNormalizer } from '../src/core/schema-verify/verify-sql-schema';
import { verifySqlSchema } from '../src/core/schema-verify/verify-sql-schema';
import {
  createContractTable,
  createSchemaTable,
  createTestContract,
  createTestSchemaIR,
  emptyTypeMetadataRegistry,
} from './schema-verify.helpers';

/**
 * Simple test normalizer that mimics Postgres default parsing.
 * In production, this would be `parsePostgresDefault` from adapter-postgres.
 */
const testNormalizer: DefaultNormalizer = (rawDefault: string): ColumnDefault | undefined => {
  const trimmed = rawDefault.trim();

  // now() / CURRENT_TIMESTAMP
  if (/^(now\s*\(\s*\)|CURRENT_TIMESTAMP)$/i.test(trimmed)) {
    return { kind: 'function', expression: 'now()' };
  }

  // Boolean literals
  if (/^true$/i.test(trimmed)) {
    return { kind: 'literal', value: true };
  }
  if (/^false$/i.test(trimmed)) {
    return { kind: 'literal', value: false };
  }

  // Numeric literals
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return { kind: 'literal', value: Number(trimmed) };
  }

  // String literals: 'value'::type or just 'value'
  // Strip the ::type cast so the normalized value matches what contract authors write.
  const stringMatch = trimmed.match(/^'((?:[^']|'')*)'(?:::(?:"[^"]+"|[\w\s]+)(?:\(\d+\))?)?$/);
  if (stringMatch?.[1] !== undefined) {
    const unescaped = stringMatch[1].replace(/''/g, "'");
    try {
      return { kind: 'literal', value: JSON.parse(unescaped) };
    } catch {
      return { kind: 'literal', value: unescaped };
    }
  }

  // Fallback
  return { kind: 'function', expression: trimmed };
};

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
      normalizeDefault: testNormalizer,
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
          default: { kind: 'literal', value: 'draft' },
        },
      }),
    });

    const schema = createTestSchemaIR({
      user: createSchemaTable('user', {
        status: {
          nativeType: 'text',
          nullable: false,
          // Raw Postgres default - will be normalized to "'published'::text"
          default: "'published'::text",
        },
      }),
    });

    const result = verifySqlSchema({
      contract,
      schema,
      strict: false,
      typeMetadataRegistry: emptyTypeMetadataRegistry,
      frameworkComponents: [],
      normalizeDefault: testNormalizer,
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
          default: { kind: 'literal', value: 'draft' },
        },
      }),
    });

    const schema = createTestSchemaIR({
      user: createSchemaTable('user', {
        created_at: {
          nativeType: 'timestamptz',
          nullable: false,
          // Raw Postgres returns with different whitespace
          default: ' NOW ( ) ',
        },
        label: {
          nativeType: 'text',
          nullable: false,
          // Raw Postgres default with type cast — normalizer strips ::text
          default: "  'draft'::text  ",
        },
      }),
    });

    const result = verifySqlSchema({
      contract,
      schema,
      strict: false,
      typeMetadataRegistry: emptyTypeMetadataRegistry,
      frameworkComponents: [],
      normalizeDefault: testNormalizer,
    });

    expect(result.ok).toBe(true);
    expect(result.schema.issues).toHaveLength(0);
  });

  it('treats JSON defaults as equal when schema normalizer returns string literals', () => {
    const contract = createTestContract({
      literal_defaults: createContractTable({
        metadata: {
          nativeType: 'jsonb',
          nullable: false,
          default: { kind: 'literal', value: { key: 'default' } },
        },
      }),
    });

    const schema = createTestSchemaIR({
      literal_defaults: createSchemaTable('literal_defaults', {
        metadata: {
          nativeType: 'jsonb',
          nullable: false,
          default: '\'{"key": "default"}\'::jsonb',
        },
      }),
    });

    const result = verifySqlSchema({
      contract,
      schema,
      strict: false,
      typeMetadataRegistry: emptyTypeMetadataRegistry,
      frameworkComponents: [],
      normalizeDefault: testNormalizer,
    });

    expect(result.ok).toBe(true);
    expect(result.schema.issues).toHaveLength(0);
  });

  it('matches JSONB default that looks like a tagged bigint', () => {
    const contract = createTestContract({
      literal_defaults: createContractTable({
        payload: {
          nativeType: 'jsonb',
          nullable: false,
          default: { kind: 'literal', value: { $type: 'bigint', value: '42' } },
        },
      }),
    });

    const schema = createTestSchemaIR({
      literal_defaults: createSchemaTable('literal_defaults', {
        payload: {
          nativeType: 'jsonb',
          nullable: false,
          default: '\'{"$type":"bigint","value":"42"}\'::jsonb',
        },
      }),
    });

    const result = verifySqlSchema({
      contract,
      schema,
      strict: false,
      typeMetadataRegistry: emptyTypeMetadataRegistry,
      frameworkComponents: [],
      normalizeDefault: testNormalizer,
    });

    expect(result.ok).toBe(true);
    expect(result.schema.issues).toHaveLength(0);
  });

  it('falls back to string comparison when no normalizer is provided', () => {
    const contract = createTestContract({
      user: createContractTable({
        status: {
          nativeType: 'text',
          nullable: false,
          // Contract default value
          default: { kind: 'literal', value: 'draft' },
        },
      }),
    });

    const schema = createTestSchemaIR({
      user: createSchemaTable('user', {
        status: {
          nativeType: 'text',
          nullable: false,
          // Raw schema default - must match stringified value without normalizer
          default: "'draft'",
        },
      }),
    });

    // Without normalizer, comparison is direct string match on the literal value
    const result = verifySqlSchema({
      contract,
      schema,
      strict: false,
      typeMetadataRegistry: emptyTypeMetadataRegistry,
      frameworkComponents: [],
      // No normalizer provided
    });

    expect(result.ok).toBe(true);
    expect(result.schema.issues).toHaveLength(0);
  });

  it('ignores generated defaults during verification', () => {
    const baseContract = createTestContract({
      user: createContractTable({
        id: {
          nativeType: 'text',
          nullable: false,
        },
      }),
    });
    const contract = {
      ...baseContract,
      execution: {
        mutations: {
          defaults: [
            {
              ref: { table: 'user', column: 'id' },
              onCreate: { kind: 'generator', id: 'uuidv4' },
            },
          ],
        },
      },
    } satisfies SqlContract<SqlStorage>;

    const schema = createTestSchemaIR({
      user: createSchemaTable('user', {
        id: { nativeType: 'text', nullable: false },
      }),
    });

    const result = verifySqlSchema({
      contract,
      schema,
      strict: false,
      typeMetadataRegistry: emptyTypeMetadataRegistry,
      frameworkComponents: [],
      normalizeDefault: testNormalizer,
    });

    expect(result.ok).toBe(true);
    expect(result.schema.issues).toHaveLength(0);
  });
});

describe('verifySqlSchema - string literal defaults with type casts', () => {
  it('matches contract literal without cast to DB literal with ::text cast', () => {
    const contract = createTestContract({
      Environment: createContractTable({
        provisionStatus: {
          nativeType: 'text',
          nullable: false,
          default: { kind: 'literal', value: 'ready' },
        },
      }),
    });

    const schema = createTestSchemaIR({
      Environment: createSchemaTable('Environment', {
        provisionStatus: {
          nativeType: 'text',
          nullable: false,
          default: "'ready'::text",
        },
      }),
    });

    const result = verifySqlSchema({
      contract,
      schema,
      strict: false,
      typeMetadataRegistry: emptyTypeMetadataRegistry,
      frameworkComponents: [],
      normalizeDefault: testNormalizer,
    });

    expect(result.ok).toBe(true);
    expect(result.schema.issues).toHaveLength(0);
  });

  it('matches contract literal without cast to DB literal with ::character varying cast', () => {
    const contract = createTestContract({
      user: createContractTable({
        role: {
          nativeType: 'character varying',
          nullable: false,
          default: { kind: 'literal', value: 'member' },
        },
      }),
    });

    const schema = createTestSchemaIR({
      user: createSchemaTable('user', {
        role: {
          nativeType: 'character varying',
          nullable: false,
          default: "'member'::character varying",
        },
      }),
    });

    const result = verifySqlSchema({
      contract,
      schema,
      strict: false,
      typeMetadataRegistry: emptyTypeMetadataRegistry,
      frameworkComponents: [],
      normalizeDefault: testNormalizer,
    });

    expect(result.ok).toBe(true);
    expect(result.schema.issues).toHaveLength(0);
  });

  it('matches contract literal without cast to DB literal with quoted enum cast', () => {
    const contract = createTestContract({
      Environment: createContractTable({
        kind: {
          nativeType: 'EnvironmentModelKind',
          nullable: false,
          default: { kind: 'literal', value: 'production' },
        },
      }),
    });

    const schema = createTestSchemaIR({
      Environment: createSchemaTable('Environment', {
        kind: {
          nativeType: 'EnvironmentModelKind',
          nullable: false,
          default: '\'production\'::"EnvironmentModelKind"',
        },
      }),
    });

    const result = verifySqlSchema({
      contract,
      schema,
      strict: false,
      typeMetadataRegistry: emptyTypeMetadataRegistry,
      frameworkComponents: [],
      normalizeDefault: testNormalizer,
    });

    expect(result.ok).toBe(true);
    expect(result.schema.issues).toHaveLength(0);
  });

  it('matches contract literal without cast to DB literal with escaped quotes and cast', () => {
    const contract = createTestContract({
      post: createContractTable({
        title: {
          nativeType: 'text',
          nullable: false,
          default: { kind: 'literal', value: "it's a default" },
        },
      }),
    });

    const schema = createTestSchemaIR({
      post: createSchemaTable('post', {
        title: {
          nativeType: 'text',
          nullable: false,
          default: "'it''s a default'::text",
        },
      }),
    });

    const result = verifySqlSchema({
      contract,
      schema,
      strict: false,
      typeMetadataRegistry: emptyTypeMetadataRegistry,
      frameworkComponents: [],
      normalizeDefault: testNormalizer,
    });

    expect(result.ok).toBe(true);
    expect(result.schema.issues).toHaveLength(0);
  });

  it('matches boolean literal true despite DB returning raw true', () => {
    const contract = createTestContract({
      Environment: createContractTable({
        allowRemoteDatabases: {
          nativeType: 'bool',
          nullable: false,
          default: { kind: 'literal', value: true },
        },
      }),
    });

    const schema = createTestSchemaIR({
      Environment: createSchemaTable('Environment', {
        allowRemoteDatabases: {
          nativeType: 'bool',
          nullable: false,
          default: 'true',
        },
      }),
    });

    const result = verifySqlSchema({
      contract,
      schema,
      strict: false,
      typeMetadataRegistry: emptyTypeMetadataRegistry,
      frameworkComponents: [],
      normalizeDefault: testNormalizer,
    });

    expect(result.ok).toBe(true);
    expect(result.schema.issues).toHaveLength(0);
  });

  it('still detects actual value mismatch when both have casts', () => {
    const contract = createTestContract({
      Environment: createContractTable({
        status: {
          nativeType: 'text',
          nullable: false,
          default: { kind: 'literal', value: 'active' },
        },
      }),
    });

    const schema = createTestSchemaIR({
      Environment: createSchemaTable('Environment', {
        status: {
          nativeType: 'text',
          nullable: false,
          default: "'inactive'::text",
        },
      }),
    });

    const result = verifySqlSchema({
      contract,
      schema,
      strict: false,
      typeMetadataRegistry: emptyTypeMetadataRegistry,
      frameworkComponents: [],
      normalizeDefault: testNormalizer,
    });

    expect(result.ok).toBe(false);
    expect(result.schema.issues).toContainEqual(
      expect.objectContaining({
        kind: 'default_mismatch',
        table: 'Environment',
        column: 'status',
      }),
    );
  });

  it('matches contract literal with empty string default and ::text cast', () => {
    const contract = createTestContract({
      config: createContractTable({
        value: {
          nativeType: 'text',
          nullable: false,
          default: { kind: 'literal', value: '' },
        },
      }),
    });

    const schema = createTestSchemaIR({
      config: createSchemaTable('config', {
        value: {
          nativeType: 'text',
          nullable: false,
          default: "''::text",
        },
      }),
    });

    const result = verifySqlSchema({
      contract,
      schema,
      strict: false,
      typeMetadataRegistry: emptyTypeMetadataRegistry,
      frameworkComponents: [],
      normalizeDefault: testNormalizer,
    });

    expect(result.ok).toBe(true);
    expect(result.schema.issues).toHaveLength(0);
  });

  it('matches when contract includes enum cast and DB also returns enum cast', () => {
    const contract = createTestContract({
      Organization: createContractTable({
        billingState: {
          nativeType: 'BillingState',
          nullable: false,
          default: { kind: 'literal', value: 'atRisk' },
        },
      }),
    });

    const schema = createTestSchemaIR({
      Organization: createSchemaTable('Organization', {
        billingState: {
          nativeType: 'BillingState',
          nullable: false,
          default: '\'atRisk\'::"BillingState"',
        },
      }),
    });

    const result = verifySqlSchema({
      contract,
      schema,
      strict: false,
      typeMetadataRegistry: emptyTypeMetadataRegistry,
      frameworkComponents: [],
      normalizeDefault: testNormalizer,
    });

    expect(result.ok).toBe(true);
    expect(result.schema.issues).toHaveLength(0);
  });

  it('matches when contract has cast-free literal but DB returns enum cast', () => {
    const contract = createTestContract({
      Organization: createContractTable({
        billingState: {
          nativeType: 'BillingState',
          nullable: false,
          default: { kind: 'literal', value: 'atRisk' },
        },
      }),
    });

    const schema = createTestSchemaIR({
      Organization: createSchemaTable('Organization', {
        billingState: {
          nativeType: 'BillingState',
          nullable: false,
          default: '\'atRisk\'::"BillingState"',
        },
      }),
    });

    const result = verifySqlSchema({
      contract,
      schema,
      strict: false,
      typeMetadataRegistry: emptyTypeMetadataRegistry,
      frameworkComponents: [],
      normalizeDefault: testNormalizer,
    });

    expect(result.ok).toBe(true);
    expect(result.schema.issues).toHaveLength(0);
  });

  it('matches when contract has enum cast but DB returns cast-free literal', () => {
    const contract = createTestContract({
      Organization: createContractTable({
        billingState: {
          nativeType: 'BillingState',
          nullable: false,
          default: { kind: 'literal', value: 'atRisk' },
        },
      }),
    });

    const schema = createTestSchemaIR({
      Organization: createSchemaTable('Organization', {
        billingState: {
          nativeType: 'BillingState',
          nullable: false,
          default: "'atRisk'",
        },
      }),
    });

    const result = verifySqlSchema({
      contract,
      schema,
      strict: false,
      typeMetadataRegistry: emptyTypeMetadataRegistry,
      frameworkComponents: [],
      normalizeDefault: testNormalizer,
    });

    expect(result.ok).toBe(true);
    expect(result.schema.issues).toHaveLength(0);
  });

  it('detects value mismatch even when both have enum casts', () => {
    const contract = createTestContract({
      Organization: createContractTable({
        billingState: {
          nativeType: 'BillingState',
          nullable: false,
          default: { kind: 'literal', value: 'active' },
        },
      }),
    });

    const schema = createTestSchemaIR({
      Organization: createSchemaTable('Organization', {
        billingState: {
          nativeType: 'BillingState',
          nullable: false,
          default: '\'suspended\'::"BillingState"',
        },
      }),
    });

    const result = verifySqlSchema({
      contract,
      schema,
      strict: false,
      typeMetadataRegistry: emptyTypeMetadataRegistry,
      frameworkComponents: [],
      normalizeDefault: testNormalizer,
    });

    expect(result.ok).toBe(false);
    expect(result.schema.issues).toContainEqual(
      expect.objectContaining({
        kind: 'default_mismatch',
        table: 'Organization',
        column: 'billingState',
      }),
    );
  });
});
