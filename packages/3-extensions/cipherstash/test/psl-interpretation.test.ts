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
 *
 * Sister files cover the other cipherstash constructors:
 *   - `psl-interpretation-numeric.test.ts`
 *     (`EncryptedDouble`, `EncryptedBigInt`)
 *   - `psl-interpretation-other-types.test.ts`
 *     (`EncryptedDate`, `EncryptedBoolean`, `EncryptedJson`)
 */

import { getStorageNamespace, UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { parsePslDocument } from '@prisma-next/psl-parser';
import type { SqlNamespace } from '@prisma-next/sql-contract/types';
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
type NamespaceView = {
  readonly tables: Record<string, { readonly columns: Record<string, Record<string, unknown>> }>;
};
type StorageView = {
  readonly namespaces: Record<string, NamespaceView>;
  readonly types?: Record<string, Record<string, unknown>>;
};
const asStorage = (storage: unknown): StorageView => storage as StorageView;
const unboundTables = (s: StorageView) =>
  getStorageNamespace<SqlNamespace>(s, UNBOUND_NAMESPACE_ID)?.tables ?? {};

describe('PSL interpretation: cipherstash.EncryptedString constructor', () => {
  it('lowers full args to a column with codecId, nativeType, typeParams', () => {
    const result = interpret(`model User {
  id Int @id
  email cipherstash.EncryptedString({ equality: true, freeTextSearch: true, orderAndRange: true })
}
`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(unboundTables(asStorage(result.value.storage))['user']?.columns['email']).toEqual(
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
    expect(unboundTables(asStorage(result.value.storage))['user']?.columns['notes']).toEqual(
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
    expect(unboundTables(asStorage(result.value.storage))['user']?.columns['notes']).toEqual(
      expect.objectContaining({
        codecId: 'cipherstash/string@1',
        nativeType: 'eql_v2_encrypted',
        typeParams: { equality: true, freeTextSearch: true, orderAndRange: true },
        nullable: false,
      }),
    );
  });

  it('lets orderAndRange be explicitly disabled', () => {
    const result = interpret(`model User {
  id Int @id
  notes cipherstash.EncryptedString({ orderAndRange: false })
}
`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(unboundTables(asStorage(result.value.storage))['user']?.columns['notes']).toEqual(
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
    expect(unboundTables(asStorage(result.value.storage))['user']?.columns['notes']).toMatchObject({
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
    expect(unboundTables(asStorage(result.value.storage))['user']?.columns['notes']).toMatchObject({
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
    expect(
      unboundTables(asStorage(result.value.storage))['user']?.columns['username'],
    ).toMatchObject({
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
    expect(unboundTables(storage)['user']?.columns['email']).toMatchObject({
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
    const inlineCol = unboundTables(asStorage(inlineResult.value.storage))['user']?.columns[
      'email'
    ];
    expect(inlineCol).toBeDefined();
    if (!inlineCol) return;

    // The named type's storage descriptor and the inline column's
    // codec/nativeType/typeParams must agree byte-for-byte; the inline
    // column carries `nullable` (and may carry `default`/etc.) which the
    // named-type descriptor does not.
    expect(aliasNamedType).toEqual({
      kind: 'codec-instance',
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
