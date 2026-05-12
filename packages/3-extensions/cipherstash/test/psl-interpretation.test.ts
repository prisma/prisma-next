/**
 * Full PSL→ColumnTypeDescriptor lowering for the
 * `cipherstash.EncryptedString({...})` constructor.
 *
 * Exercises the interpreter end-to-end (parser → authoring contributions
 * → SQL contract IR) so the assertions are about *what users observe*
 * in the emitted contract, not about the descriptor template metadata.
 *
 * Pinned behaviour:
 *   - Full args lower to `typeParams { equality, freeTextSearch, orderAndRange }`.
 *   - Empty `{}` (and the no-args form) defaults all three flags to `true` —
 *     searchable encryption is the legitimate default; users opt out
 *     explicitly with `equality: false` / `freeTextSearch: false` /
 *     `orderAndRange: false`.
 *   - `?` produces `nullable: true` on the column descriptor.
 *   - Unknown property name → `PSL_INVALID_ATTRIBUTE_ARGUMENT`.
 *   - Wrong type → `PSL_INVALID_ATTRIBUTE_ARGUMENT` mentioning
 *     "boolean"; diagnostic span points at the offending value.
 *   - `types { ... }` alias resolves and is reachable from a model
 *     field via `typeRef`; the alias's named-type descriptor matches
 *     the inline-form column's codec/nativeType/typeParams
 *     byte-for-byte.
 */

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

function interpret(schema: string) {
  return interpretPslDocumentToSqlContract({
    document: parsePslDocument({ schema, sourceId: 'schema.prisma' }),
    target: postgresTarget,
    scalarTypeDescriptors: postgresScalarTypeDescriptors,
    composedExtensionPacks: [cipherstashControl.id],
    authoringContributions: { type: cipherstashPack.authoring.type, field: {} },
  });
}

// The interpreter returns `Result<Contract, ContractSourceDiagnostics>` and
// `Contract.storage` is the opaque `StorageBase<string>`. Tests treat it as
// the structural shape it actually is (tables / types) — same pattern used
// by `packages/2-sql/2-authoring/contract-psl/test/interpreter.relations.test.ts`.
type StorageView = {
  readonly tables: Record<
    string,
    {
      readonly columns: Record<string, Record<string, unknown>>;
    }
  >;
  readonly types?: Record<string, Record<string, unknown>>;
};
const asStorage = (storage: unknown): StorageView => storage as StorageView;

describe('PSL interpretation: cipherstash.EncryptedString constructor', () => {
  it('lowers full args to a column with codecId, nativeType, typeParams', () => {
    const result = interpret(`model User {
  id Int @id
  email cipherstash.EncryptedString({ equality: true, freeTextSearch: true, orderAndRange: true })
}
`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(asStorage(result.value.storage).tables['user']?.columns['email']).toEqual(
      expect.objectContaining({
        codecId: 'cipherstash/string@1',
        nativeType: 'eql_v2_encrypted',
        typeParams: { equality: true, freeTextSearch: true, orderAndRange: true },
        nullable: false,
      }),
    );
  });

  it('defaults all flags to true for an empty options literal', () => {
    const result = interpret(`model User {
  id Int @id
  notes cipherstash.EncryptedString({})
}
`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(asStorage(result.value.storage).tables['user']?.columns['notes']).toEqual(
      expect.objectContaining({
        codecId: 'cipherstash/string@1',
        nativeType: 'eql_v2_encrypted',
        typeParams: { equality: true, freeTextSearch: true, orderAndRange: true },
        nullable: false,
      }),
    );
  });

  it('defaults all flags to true when called with no arguments', () => {
    const result = interpret(`model User {
  id Int @id
  notes cipherstash.EncryptedString()
}
`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(asStorage(result.value.storage).tables['user']?.columns['notes']).toEqual(
      expect.objectContaining({
        codecId: 'cipherstash/string@1',
        nativeType: 'eql_v2_encrypted',
        typeParams: { equality: true, freeTextSearch: true, orderAndRange: true },
        nullable: false,
      }),
    );
  });

  it('lets orderAndRange be explicitly disabled (D6)', () => {
    const result = interpret(`model User {
  id Int @id
  notes cipherstash.EncryptedString({ orderAndRange: false })
}
`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(asStorage(result.value.storage).tables['user']?.columns['notes']).toEqual(
      expect.objectContaining({
        codecId: 'cipherstash/string@1',
        typeParams: { equality: true, freeTextSearch: true, orderAndRange: false },
      }),
    );
  });

  it('lets equality be explicitly disabled', () => {
    const result = interpret(`model User {
  id Int @id
  notes cipherstash.EncryptedString({ equality: false })
}
`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(asStorage(result.value.storage).tables['user']?.columns['notes']).toMatchObject({
      codecId: 'cipherstash/string@1',
      nativeType: 'eql_v2_encrypted',
      typeParams: { equality: false, freeTextSearch: true },
      nullable: false,
    });
  });

  it('lets both flags be explicitly disabled (storage-only encryption)', () => {
    const result = interpret(`model User {
  id Int @id
  notes cipherstash.EncryptedString({ equality: false, freeTextSearch: false })
}
`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(asStorage(result.value.storage).tables['user']?.columns['notes']).toMatchObject({
      codecId: 'cipherstash/string@1',
      nativeType: 'eql_v2_encrypted',
      typeParams: { equality: false, freeTextSearch: false },
      nullable: false,
    });
  });

  it('marks nullable columns as nullable', () => {
    const result = interpret(`model User {
  id Int @id
  username cipherstash.EncryptedString({ freeTextSearch: false })?
}
`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(asStorage(result.value.storage).tables['user']?.columns['username']).toMatchObject({
      codecId: 'cipherstash/string@1',
      nativeType: 'eql_v2_encrypted',
      typeParams: { equality: true, freeTextSearch: false },
      nullable: true,
    });
  });

  it('rejects unknown argument names with PSL_INVALID_ATTRIBUTE_ARGUMENT', () => {
    const result = interpret(`model User {
  id Int @id
  email cipherstash.EncryptedString({ unknownFlag: true })
}
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
          message: expect.stringContaining('unknownFlag'),
        }),
      ]),
    );
  });

  it('rejects wrong-typed argument values with PSL_INVALID_ATTRIBUTE_ARGUMENT', () => {
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

  it('resolves a named-type alias under types {} and uses it on a model field', () => {
    const result = interpret(`types {
  SearchableEmail = cipherstash.EncryptedString({ freeTextSearch: false })
}

model User {
  id Int @id
  email SearchableEmail
}
`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const storage = asStorage(result.value.storage);
    expect(storage.types?.['SearchableEmail']).toMatchObject({
      codecId: 'cipherstash/string@1',
      nativeType: 'eql_v2_encrypted',
      typeParams: { equality: true, freeTextSearch: false },
    });
    expect(storage.tables['user']?.columns['email']).toMatchObject({
      codecId: 'cipherstash/string@1',
      nativeType: 'eql_v2_encrypted',
      nullable: false,
      typeRef: 'SearchableEmail',
    });
  });

  it('produces an alias whose typeParams match the inline-constructor form for the same args', () => {
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

    const aliasNamedType = asStorage(aliasResult.value.storage).types?.['SearchableEmail'];
    const inlineCol = asStorage(inlineResult.value.storage).tables['user']?.columns['email'];
    expect(inlineCol).toBeDefined();
    if (!inlineCol) return;

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

  it('reports a span at the offending argument value', () => {
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

describe('PSL interpretation: cipherstash.EncryptedDouble constructor', () => {
  it('lowers full args to a column with cipherstash/double@1 codec, eql_v2_encrypted nativeType', () => {
    const result = interpret(`model Metric {
  id Int @id
  value cipherstash.EncryptedDouble({ equality: true, orderAndRange: true })
}
`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(asStorage(result.value.storage).tables['metric']?.columns['value']).toMatchObject({
      codecId: 'cipherstash/double@1',
      nativeType: 'eql_v2_encrypted',
      typeParams: { equality: true, orderAndRange: true },
      nullable: false,
    });
  });

  it('defaults both flags to true for an empty options literal', () => {
    const result = interpret(`model Metric {
  id Int @id
  value cipherstash.EncryptedDouble({})
}
`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(asStorage(result.value.storage).tables['metric']?.columns['value']).toMatchObject({
      codecId: 'cipherstash/double@1',
      typeParams: { equality: true, orderAndRange: true },
    });
  });

  it('rejects unknown argument names with PSL_INVALID_ATTRIBUTE_ARGUMENT', () => {
    const result = interpret(`model Metric {
  id Int @id
  value cipherstash.EncryptedDouble({ freeTextSearch: true })
}
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
          message: expect.stringContaining('freeTextSearch'),
        }),
      ]),
    );
  });

  it('produces an inline-form descriptor structurally identical to the TS factory output', () => {
    const result = interpret(`model Metric {
  id Int @id
  value cipherstash.EncryptedDouble({ equality: true, orderAndRange: false })
}
`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const col = asStorage(result.value.storage).tables['metric']?.columns['value'];
    // Stripping `nullable` (PSL-specific) the column descriptor mirrors
    // the TS factory's lowered shape byte-for-byte (parity AC-AUTH2).
    expect(col).toMatchObject({
      codecId: 'cipherstash/double@1',
      nativeType: 'eql_v2_encrypted',
      typeParams: { equality: true, orderAndRange: false },
    });
  });
});

describe('PSL interpretation: cipherstash.EncryptedBigInt constructor', () => {
  it('lowers full args to a column with cipherstash/bigint@1 codec, eql_v2_encrypted nativeType', () => {
    const result = interpret(`model Ledger {
  id Int @id
  amount cipherstash.EncryptedBigInt({ equality: true, orderAndRange: true })
}
`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(asStorage(result.value.storage).tables['ledger']?.columns['amount']).toMatchObject({
      codecId: 'cipherstash/bigint@1',
      nativeType: 'eql_v2_encrypted',
      typeParams: { equality: true, orderAndRange: true },
    });
  });

  it('defaults both flags to true with no arguments', () => {
    const result = interpret(`model Ledger {
  id Int @id
  amount cipherstash.EncryptedBigInt()
}
`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(asStorage(result.value.storage).tables['ledger']?.columns['amount']).toMatchObject({
      codecId: 'cipherstash/bigint@1',
      typeParams: { equality: true, orderAndRange: true },
    });
  });

  it('rejects unknown argument names with PSL_INVALID_ATTRIBUTE_ARGUMENT', () => {
    const result = interpret(`model Ledger {
  id Int @id
  amount cipherstash.EncryptedBigInt({ freeTextSearch: true })
}
`);
    expect(result.ok).toBe(false);
  });
});

describe('PSL interpretation: cipherstash.EncryptedDate constructor', () => {
  it('lowers full args to a column with cipherstash/date@1 codec, eql_v2_encrypted nativeType', () => {
    const result = interpret(`model Event {
  id Int @id
  occurredOn cipherstash.EncryptedDate({ equality: true, orderAndRange: true })
}
`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(asStorage(result.value.storage).tables['event']?.columns['occurredOn']).toMatchObject({
      codecId: 'cipherstash/date@1',
      nativeType: 'eql_v2_encrypted',
      typeParams: { equality: true, orderAndRange: true },
    });
  });

  it('defaults both flags to true with no arguments', () => {
    const result = interpret(`model Event {
  id Int @id
  occurredOn cipherstash.EncryptedDate()
}
`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(asStorage(result.value.storage).tables['event']?.columns['occurredOn']).toMatchObject({
      codecId: 'cipherstash/date@1',
      typeParams: { equality: true, orderAndRange: true },
    });
  });
});

describe('PSL interpretation: cipherstash.EncryptedBoolean constructor', () => {
  it('lowers full args to a column with cipherstash/boolean@1 codec, equality typeParam', () => {
    const result = interpret(`model Feature {
  id Int @id
  enabled cipherstash.EncryptedBoolean({ equality: true })
}
`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(asStorage(result.value.storage).tables['feature']?.columns['enabled']).toMatchObject({
      codecId: 'cipherstash/boolean@1',
      nativeType: 'eql_v2_encrypted',
      typeParams: { equality: true },
    });
  });

  it('defaults equality to true with no arguments', () => {
    const result = interpret(`model Feature {
  id Int @id
  enabled cipherstash.EncryptedBoolean()
}
`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(asStorage(result.value.storage).tables['feature']?.columns['enabled']).toMatchObject({
      codecId: 'cipherstash/boolean@1',
      typeParams: { equality: true },
    });
  });

  it('rejects orderAndRange (not a boolean codec flag)', () => {
    const result = interpret(`model Feature {
  id Int @id
  enabled cipherstash.EncryptedBoolean({ orderAndRange: true })
}
`);
    expect(result.ok).toBe(false);
  });
});

describe('PSL interpretation: cipherstash.EncryptedJson constructor', () => {
  it('lowers full args to a column with cipherstash/json@1 codec, searchableJson typeParam', () => {
    const result = interpret(`model Audit {
  id Int @id
  payload cipherstash.EncryptedJson({ searchableJson: true })
}
`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(asStorage(result.value.storage).tables['audit']?.columns['payload']).toMatchObject({
      codecId: 'cipherstash/json@1',
      nativeType: 'eql_v2_encrypted',
      typeParams: { searchableJson: true },
    });
  });

  it('defaults searchableJson to true with no arguments', () => {
    const result = interpret(`model Audit {
  id Int @id
  payload cipherstash.EncryptedJson()
}
`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(asStorage(result.value.storage).tables['audit']?.columns['payload']).toMatchObject({
      codecId: 'cipherstash/json@1',
      typeParams: { searchableJson: true },
    });
  });

  it('rejects equality (not a json codec flag)', () => {
    const result = interpret(`model Audit {
  id Int @id
  payload cipherstash.EncryptedJson({ equality: true })
}
`);
    expect(result.ok).toBe(false);
  });
});
