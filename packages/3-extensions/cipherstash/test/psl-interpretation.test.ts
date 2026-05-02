import { parsePslDocument } from '@prisma-next/psl-parser';
import { interpretPslDocumentToSqlContract } from '@prisma-next/sql-contract-psl';
import { describe, expect, it } from 'vitest';
import cipherstashControl from '../src/exports/control';
import cipherstashPack from '../src/exports/pack';

const postgresTarget = {
  kind: 'target' as const,
  familyId: 'sql' as const,
  targetId: 'postgres' as const,
  id: 'postgres',
  version: '0.0.1',
  capabilities: {},
};

const postgresScalarTypeDescriptors = new Map([
  ['String', { codecId: 'pg/text@1', nativeType: 'text' }],
  ['Boolean', { codecId: 'pg/bool@1', nativeType: 'bool' }],
  ['Int', { codecId: 'pg/int4@1', nativeType: 'int4' }],
]);

interface NarrowedStorage {
  readonly tables: Record<string, { readonly columns: Record<string, Record<string, unknown>> }>;
  readonly types?: Record<string, Record<string, unknown>>;
}

function interpret(schema: string) {
  return interpretPslDocumentToSqlContract({
    document: parsePslDocument({ schema, sourceId: 'schema.prisma' }),
    target: postgresTarget,
    scalarTypeDescriptors: postgresScalarTypeDescriptors,
    composedExtensionPacks: [cipherstashControl.id],
    authoringContributions: { type: cipherstashPack.authoring.type, field: {} },
  });
}

function narrowStorage(value: { storage: unknown }): NarrowedStorage {
  // Test-only narrowing: the IR's StorageBase is intentionally weak so
  // family adapters can specialise it; for these tests we know we're
  // working with the SQL family's tables/types projection.
  return value.storage as unknown as NarrowedStorage;
}

function userColumns(value: { storage: unknown }, name: string): Record<string, unknown> {
  const col = narrowStorage(value).tables['user']?.columns[name];
  if (!col) throw new Error(`expected user.${name} column`);
  return col;
}

describe('PSL interpretation: cipherstash.EncryptedString constructor', () => {
  it('lowers full args to a column with codecId, nativeType, typeParams (AC-LOWER1)', () => {
    const result = interpret(`model User {
  id Int @id
  email cipherstash.EncryptedString({ equality: true, freeTextSearch: true })
}
`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(userColumns(result.value, 'email')).toMatchObject({
      codecId: 'cipherstash/string@1',
      nativeType: 'eql_v2_encrypted',
      typeParams: { equality: true, freeTextSearch: true },
      nullable: false,
    });
  });

  it('applies false defaults for an empty options literal (AC-LOWER2)', () => {
    const result = interpret(`model User {
  id Int @id
  notes cipherstash.EncryptedString({})
}
`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(userColumns(result.value, 'notes')).toMatchObject({
      codecId: 'cipherstash/string@1',
      nativeType: 'eql_v2_encrypted',
      typeParams: { equality: false, freeTextSearch: false },
      nullable: false,
    });
  });

  it('marks nullable columns as nullable (AC-LOWER3)', () => {
    const result = interpret(`model User {
  id Int @id
  username cipherstash.EncryptedString({ equality: true })?
}
`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(userColumns(result.value, 'username')).toMatchObject({
      codecId: 'cipherstash/string@1',
      nativeType: 'eql_v2_encrypted',
      typeParams: { equality: true, freeTextSearch: false },
      nullable: true,
    });
  });

  it('rejects unknown argument names with PSL_INVALID_ATTRIBUTE_ARGUMENT (AC-CTOR3)', () => {
    const result = interpret(`model User {
  id Int @id
  email cipherstash.EncryptedString({ orderAndRange: true })
}
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
          message: expect.stringContaining('orderAndRange'),
        }),
      ]),
    );
  });

  it('rejects wrong-typed argument values with PSL_INVALID_ATTRIBUTE_ARGUMENT (AC-CTOR4)', () => {
    const result = interpret(`model User {
  id Int @id
  email cipherstash.EncryptedString({ equality: "yes" })
}
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
          message: expect.stringContaining('boolean'),
        }),
      ]),
    );
  });

  it('resolves a named-type alias under types {} and uses it on a model field (AC-ALIAS1)', () => {
    const result = interpret(`types {
  SearchableEmail = cipherstash.EncryptedString({ equality: true })
}

model User {
  id Int @id
  email SearchableEmail
}
`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const storage = narrowStorage(result.value);
    expect(storage.types?.['SearchableEmail']).toMatchObject({
      codecId: 'cipherstash/string@1',
      nativeType: 'eql_v2_encrypted',
      typeParams: { equality: true, freeTextSearch: false },
    });
    expect(userColumns(result.value, 'email')).toMatchObject({
      codecId: 'cipherstash/string@1',
      nativeType: 'eql_v2_encrypted',
      nullable: false,
      typeRef: 'SearchableEmail',
    });
  });

  it('produces an alias whose typeParams match the inline-constructor form for the same args (AC-ALIAS2)', () => {
    const aliasResult = interpret(`types {
  SearchableEmail = cipherstash.EncryptedString({ equality: true, freeTextSearch: true })
}

model User {
  id Int @id
  email SearchableEmail
}
`);
    const inlineResult = interpret(`model User {
  id Int @id
  email cipherstash.EncryptedString({ equality: true, freeTextSearch: true })
}
`);
    expect(aliasResult.ok).toBe(true);
    expect(inlineResult.ok).toBe(true);
    if (!aliasResult.ok || !inlineResult.ok) return;

    const aliasStorage = narrowStorage(aliasResult.value);
    const aliasNamedType = aliasStorage.types?.['SearchableEmail'];
    const inlineCol = userColumns(inlineResult.value, 'email');

    // The named type's storage descriptor and the inline column's
    // codec/nativeType/typeParams must agree byte-for-byte; the inline
    // column carries `nullable` (and may carry `default`/etc.) which the
    // named-type descriptor does not.
    expect(aliasNamedType).toEqual({
      codecId: inlineCol['codecId'],
      nativeType: inlineCol['nativeType'],
      typeParams: inlineCol['typeParams'],
    });
  });

  it('reports a span at the offending argument value (AC-CTOR4 span requirement)', () => {
    const result = interpret(`model User {
  id Int @id
  email cipherstash.EncryptedString({ equality: 42 })
}
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const diag = result.failure.diagnostics.find(
      (d) => d.code === 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
    );
    expect(diag?.span).toMatchObject({
      start: { line: expect.any(Number), column: expect.any(Number) },
      end: { line: expect.any(Number), column: expect.any(Number) },
    });
  });
});
