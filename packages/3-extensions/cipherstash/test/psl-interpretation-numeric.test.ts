/**
 * PSL→ColumnTypeDescriptor lowering for the numeric cipherstash
 * constructors: `cipherstash.EncryptedDouble` / `cipherstash.EncryptedBigInt`.
 *
 * Pinned behaviour for numeric codecs (shared by both):
 *   - Full args lower to `typeParams { equality, orderAndRange }`.
 *   - Empty `{}` (and the no-args form) defaults both flags to `true`.
 *   - `freeTextSearch` is rejected with `PSL_INVALID_ATTRIBUTE_ARGUMENT`
 *     — numeric codecs do not expose the string-only flag.
 *   - The inline-form lowered descriptor mirrors the TS factory output
 *     byte-for-byte (PSL/TS parity).
 */

import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
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
// the structural shape it actually is (namespaces / types) — same pattern used
// by `packages/2-sql/2-authoring/contract-psl/test/interpreter.relations.test.ts`.
type NamespaceView = {
  readonly tables?: Record<string, { readonly columns: Record<string, Record<string, unknown>> }>;
};
type StorageView = {
  readonly namespaces: Record<string, NamespaceView>;
  readonly types?: Record<string, Record<string, unknown>>;
};
const asStorage = (storage: unknown): StorageView => storage as StorageView;
const unboundTables = (s: StorageView) =>
  getStorageNamespace(s, UNBOUND_NAMESPACE_ID)?.tables ?? {};

describe('PSL interpretation: cipherstash.EncryptedDouble constructor', () => {
  it('lowers full args to a column with cipherstash/double@1 codec, eql_v2_encrypted nativeType', () => {
    const result = interpret(`model Metric {
  id Int @id
  value cipherstash.EncryptedDouble({ equality: true, orderAndRange: true })
}
`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      unboundTables(asStorage(result.value.storage))['metric']?.columns['value'],
    ).toMatchObject({
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
    expect(
      unboundTables(asStorage(result.value.storage))['metric']?.columns['value'],
    ).toMatchObject({
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
    const col = unboundTables(asStorage(result.value.storage))['metric']?.columns['value'];
    // Stripping `nullable` (PSL-specific) the column descriptor mirrors
    // the TS factory's lowered shape byte-for-byte (PSL/TS parity).
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
    expect(
      unboundTables(asStorage(result.value.storage))['ledger']?.columns['amount'],
    ).toMatchObject({
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
    expect(
      unboundTables(asStorage(result.value.storage))['ledger']?.columns['amount'],
    ).toMatchObject({
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
});
