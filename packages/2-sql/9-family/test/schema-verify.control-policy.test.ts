import { describe, expect, it } from 'vitest';
import { verifySqlSchema } from '../src/core/schema-verify/verify-sql-schema';
import {
  createContractTable,
  createMockPostgresComponent,
  createSchemaTable,
  createTestContract,
  createTestSchemaIR,
  emptyTypeMetadataRegistry,
} from './schema-verify.helpers';

const verifyOpts = {
  strict: true,
  typeMetadataRegistry: emptyTypeMetadataRegistry,
  frameworkComponents: [createMockPostgresComponent()],
};

function userTable(controlPolicy?: 'managed' | 'tolerated' | 'external' | 'observed') {
  return createContractTable(
    {
      id: { nativeType: 'int4', nullable: false },
      email: { nativeType: 'text', nullable: true },
    },
    controlPolicy !== undefined ? { control: controlPolicy } : undefined,
  );
}

function userSchema(extra?: { extra_column?: { nativeType: string; nullable: boolean } }) {
  return createSchemaTable('user', {
    id: { nativeType: 'int4', nullable: false },
    email: { nativeType: 'text', nullable: true },
    ...extra,
  });
}

describe('verifySqlSchema control policy', () => {
  it('fails on any drift under managed', () => {
    const contract = createTestContract({ user: userTable('managed') });
    const schema = createTestSchemaIR({
      user: userSchema({ extra_column: { nativeType: 'text', nullable: true } }),
    });
    const result = verifySqlSchema({ contract, schema, ...verifyOpts });
    expect(result.ok).toBe(false);
    expect(result.schema.counts.fail).toBeGreaterThan(0);
  });

  it('suppresses extra columns but fails missing declared under tolerated', () => {
    const contract = createTestContract({ user: userTable('tolerated') });
    const schema = createTestSchemaIR({
      user: userSchema({ extra_column: { nativeType: 'text', nullable: true } }),
    });
    const withExtra = verifySqlSchema({ contract, schema, ...verifyOpts });
    expect(withExtra.ok).toBe(true);
    expect(withExtra.schema.issues.some((i) => i.kind === 'extra_column')).toBe(false);

    const missingEmail = verifySqlSchema({
      contract,
      schema: createTestSchemaIR({
        user: createSchemaTable('user', { id: { nativeType: 'int4', nullable: false } }),
      }),
      ...verifyOpts,
    });
    expect(missingEmail.ok).toBe(false);
    expect(missingEmail.schema.issues).toContainEqual(
      expect.objectContaining({ kind: 'missing_column', column: 'email' }),
    );
  });

  it('suppresses extra columns and indexes under external', () => {
    const contract = createTestContract({
      user: createContractTable(
        { id: { nativeType: 'int4', nullable: false } },
        { control: 'external' },
      ),
    });
    const schema = createTestSchemaIR({
      user: createSchemaTable(
        'user',
        {
          id: { nativeType: 'int4', nullable: false },
          extra_column: { nativeType: 'text', nullable: true },
        },
        {
          indexes: [{ columns: ['id'], unique: false, name: 'user_id_idx' }],
        },
      ),
    });
    const result = verifySqlSchema({ contract, schema, ...verifyOpts });
    expect(result.ok).toBe(true);
    expect(result.schema.issues.some((i) => i.kind === 'extra_column')).toBe(false);
    expect(result.schema.issues.some((i) => i.kind === 'extra_index')).toBe(false);
  });

  it('fails a native-type mismatch under external (exact equality)', () => {
    const contract = createTestContract({
      user: createContractTable(
        { email: { nativeType: 'character varying(255)', nullable: true } },
        { control: 'external' },
      ),
    });
    const schema = createTestSchemaIR({
      user: createSchemaTable('user', {
        email: { nativeType: 'text', nullable: true },
      }),
    });
    const result = verifySqlSchema({ contract, schema, ...verifyOpts });
    expect(result.ok).toBe(false);
    expect(result.schema.issues).toContainEqual(
      expect.objectContaining({ kind: 'type_mismatch', column: 'email' }),
    );
  });

  it('fails a type-mismatched declared column under tolerated', () => {
    const contract = createTestContract({
      user: createContractTable(
        { email: { nativeType: 'character varying(255)', nullable: true } },
        { control: 'tolerated' },
      ),
    });
    const schema = createTestSchemaIR({
      user: createSchemaTable('user', { email: { nativeType: 'text', nullable: true } }),
    });
    const result = verifySqlSchema({ contract, schema, ...verifyOpts });
    expect(result.ok).toBe(false);
    expect(result.schema.issues).toContainEqual(
      expect.objectContaining({ kind: 'type_mismatch', column: 'email' }),
    );
  });

  it('ignores an extra live table under external', () => {
    const contract = createTestContract({ user: userTable() }, {}, undefined, {
      defaultControlPolicy: 'external',
    });
    const schema = createTestSchemaIR({
      user: userSchema(),
      audit_log: createSchemaTable('audit_log', { id: { nativeType: 'int4', nullable: false } }),
    });
    const result = verifySqlSchema({ contract, schema, ...verifyOpts });
    expect(result.ok).toBe(true);
    expect(result.schema.issues.some((i) => i.kind === 'extra_table')).toBe(false);
  });

  it('downgrades every divergence to warn under observed', () => {
    const contract = createTestContract({ user: userTable('observed') });
    const schema = createTestSchemaIR({
      user: userSchema({ extra_column: { nativeType: 'text', nullable: true } }),
    });
    const result = verifySqlSchema({ contract, schema, ...verifyOpts });
    expect(result.ok).toBe(true);
    expect(result.schema.counts.fail).toBe(0);
    expect(result.schema.counts.warn).toBeGreaterThan(0);
    expect(result.schema.issues.some((i) => i.kind === 'extra_column')).toBe(true);
  });
});
