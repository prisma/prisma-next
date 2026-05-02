import type { CodecLookup } from '@prisma-next/framework-components/codec';
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

const targetTypesByCodecId: Record<string, readonly string[]> = {
  'pg/text@1': ['text'],
  'pg/bool@1': ['bool'],
  'pg/int4@1': ['int4'],
  'cipherstash/string@1': ['eql_v2_encrypted'],
};

const codecLookup: CodecLookup = {
  get: (id: string) => {
    const targetTypes = targetTypesByCodecId[id];
    if (!targetTypes) return undefined;
    return { id, targetTypes } as ReturnType<CodecLookup['get']>;
  },
};

function interpret(schema: string) {
  return interpretPslDocumentToSqlContract({
    document: parsePslDocument({ schema, sourceId: 'schema.prisma' }),
    target: postgresTarget,
    scalarTypeDescriptors: postgresScalarTypeDescriptors,
    composedExtensionPacks: [cipherstashControl.id],
    authoringContributions: { type: cipherstashPack.authoring.type, field: {} },
    codecLookup,
  });
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
    expect(result.value.storage.tables['user']?.columns['email']).toMatchObject({
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
    expect(result.value.storage.tables['user']?.columns['notes']).toMatchObject({
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
    expect(result.value.storage.tables['user']?.columns['username']).toMatchObject({
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
    expect(result.value.storage.types?.SearchableEmail).toMatchObject({
      codecId: 'cipherstash/string@1',
      nativeType: 'eql_v2_encrypted',
      typeParams: { equality: true, freeTextSearch: false },
    });
    expect(result.value.storage.tables['user']?.columns['email']).toMatchObject({
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

    const aliasNamedType = aliasResult.value.storage.types?.SearchableEmail;
    const inlineCol = inlineResult.value.storage.tables['user']?.columns['email'] as Record<
      string,
      unknown
    >;

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
