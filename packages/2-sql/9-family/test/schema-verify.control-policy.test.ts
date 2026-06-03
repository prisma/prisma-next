import type { ControlPolicy } from '@prisma-next/contract/types';
import type { SchemaVerificationNode } from '@prisma-next/framework-components/control';
import { POSTGRES_ENUM_KIND, type PostgresEnumStorageEntry } from '@prisma-next/sql-contract/types';
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

function enumEntry(
  values: readonly string[],
  controlPolicy?: ControlPolicy,
): PostgresEnumStorageEntry {
  return {
    kind: POSTGRES_ENUM_KIND,
    name: 'role',
    nativeType: 'role',
    values,
    codecId: 'pg/enum@1',
    ...(controlPolicy !== undefined ? { control: controlPolicy } : {}),
  };
}

function findNode(
  node: SchemaVerificationNode,
  predicate: (n: SchemaVerificationNode) => boolean,
): SchemaVerificationNode | undefined {
  if (predicate(node)) return node;
  for (const child of node.children) {
    const found = findNode(child, predicate);
    if (found) return found;
  }
  return undefined;
}

function enumNodeStatus(root: SchemaVerificationNode): string | undefined {
  return findNode(root, (n) => n.kind === 'storageType' && n.name === 'type role')?.status;
}

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

  it('fails incompatible declared types under external without a listed pair', () => {
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
      defaultControl: 'external',
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

describe('verifySqlSchema enum dispatch on control policy', () => {
  const liveEnumValues = ['admin', 'user', 'guest'];
  const resolveExistingEnumValues = () => liveEnumValues;

  it('fails enum value drift under managed', () => {
    const contract = createTestContract({}, {}, undefined, {
      enums: { role: enumEntry(['admin', 'user'], 'managed') },
    });
    const result = verifySqlSchema({
      contract,
      schema: createTestSchemaIR({}),
      ...verifyOpts,
      resolveExistingEnumValues,
    });
    expect(result.ok).toBe(false);
    expect(result.schema.counts.fail).toBeGreaterThan(0);
    expect(enumNodeStatus(result.schema.root)).toBe('fail');
    expect(result.schema.issues.some((i) => i.kind === 'enum_values_changed')).toBe(true);
  });

  it('suppresses enum value drift under external', () => {
    const contract = createTestContract({}, {}, undefined, {
      enums: { role: enumEntry(['admin', 'user'], 'external') },
    });
    const result = verifySqlSchema({
      contract,
      schema: createTestSchemaIR({}),
      ...verifyOpts,
      resolveExistingEnumValues,
    });
    expect(result.ok).toBe(true);
    expect(result.schema.counts.fail).toBe(0);
    expect(enumNodeStatus(result.schema.root)).toBe('pass');
    expect(result.schema.issues.some((i) => i.kind === 'enum_values_changed')).toBe(false);
  });

  it('warns on enum value drift under observed', () => {
    const contract = createTestContract({}, {}, undefined, {
      enums: { role: enumEntry(['admin', 'user'], 'observed') },
    });
    const result = verifySqlSchema({
      contract,
      schema: createTestSchemaIR({}),
      ...verifyOpts,
      resolveExistingEnumValues,
    });
    expect(result.ok).toBe(true);
    expect(result.schema.counts.fail).toBe(0);
    expect(result.schema.counts.warn).toBeGreaterThan(0);
    expect(enumNodeStatus(result.schema.root)).toBe('warn');
    expect(result.schema.issues.some((i) => i.kind === 'enum_values_changed')).toBe(true);
  });

  it('still fails a missing external enum (existence is required)', () => {
    const contract = createTestContract({}, {}, undefined, {
      enums: { role: enumEntry(['admin', 'user'], 'external') },
    });
    const result = verifySqlSchema({
      contract,
      schema: createTestSchemaIR({}),
      ...verifyOpts,
      resolveExistingEnumValues: () => null,
    });
    expect(result.ok).toBe(false);
    expect(enumNodeStatus(result.schema.root)).toBe('fail');
    expect(result.schema.issues.some((i) => i.kind === 'type_missing')).toBe(true);
  });

  it('inherits contract defaultControl for enum drift', () => {
    const contract = createTestContract({}, {}, undefined, {
      defaultControl: 'observed',
      enums: { role: enumEntry(['admin', 'user']) },
    });
    const result = verifySqlSchema({
      contract,
      schema: createTestSchemaIR({}),
      ...verifyOpts,
      resolveExistingEnumValues,
    });
    expect(result.ok).toBe(true);
    expect(enumNodeStatus(result.schema.root)).toBe('warn');
  });
});

describe('verifySqlSchema external columnsCompatible threading', () => {
  const contract = createTestContract({
    user: createContractTable(
      { email: { nativeType: 'character varying(255)', nullable: true } },
      { control: 'external' },
    ),
  });
  const schema = createTestSchemaIR({
    user: createSchemaTable('user', { email: { nativeType: 'text', nullable: true } }),
  });

  it('accepts a relation-compatible type pair', () => {
    const result = verifySqlSchema({
      contract,
      schema,
      ...verifyOpts,
      columnsCompatible: (declared, live) =>
        declared === live || (declared === 'character varying(255)' && live === 'text'),
    });
    expect(result.ok).toBe(true);
    expect(result.schema.issues.some((i) => i.kind === 'type_mismatch')).toBe(false);
  });

  it('fails when the relation rejects the type pair', () => {
    const result = verifySqlSchema({
      contract,
      schema,
      ...verifyOpts,
      columnsCompatible: (declared, live) => declared === live,
    });
    expect(result.ok).toBe(false);
    expect(result.schema.issues).toContainEqual(
      expect.objectContaining({ kind: 'type_mismatch', column: 'email' }),
    );
  });
});
