/**
 * PSL→ColumnTypeDescriptor lowering for the date, boolean, and JSON
 * cipherstash constructors:
 *
 *   - `cipherstash.EncryptedDate`    — `{ equality, orderAndRange }`
 *   - `cipherstash.EncryptedBoolean` — `{ equality }` only;
 *     `orderAndRange` is rejected with `PSL_INVALID_ATTRIBUTE_ARGUMENT`.
 *   - `cipherstash.EncryptedJson`    — `{ searchableJson }`;
 *     `equality` is rejected with `PSL_INVALID_ATTRIBUTE_ARGUMENT`.
 *
 * Empty `{}` (and the no-args form) defaults the codec's flag(s) to
 * `true` in every case.
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
  getStorageNamespace<SqlNamespace>(s, UNBOUND_NAMESPACE_ID)?.tables ?? {};

describe('PSL interpretation: cipherstash.EncryptedDate constructor', () => {
  it('lowers full args to a column with cipherstash/date@1 codec, eql_v2_encrypted nativeType', () => {
    const result = interpret(`model Event {
  id Int @id
  occurredOn cipherstash.EncryptedDate({ equality: true, orderAndRange: true })
}
`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      unboundTables(asStorage(result.value.storage))['event']?.columns['occurredOn'],
    ).toMatchObject({
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
    expect(
      unboundTables(asStorage(result.value.storage))['event']?.columns['occurredOn'],
    ).toMatchObject({
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
    expect(
      unboundTables(asStorage(result.value.storage))['feature']?.columns['enabled'],
    ).toMatchObject({
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
    expect(
      unboundTables(asStorage(result.value.storage))['feature']?.columns['enabled'],
    ).toMatchObject({
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
    expect(
      unboundTables(asStorage(result.value.storage))['audit']?.columns['payload'],
    ).toMatchObject({
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
    expect(
      unboundTables(asStorage(result.value.storage))['audit']?.columns['payload'],
    ).toMatchObject({
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
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
          message: expect.stringContaining('equality'),
        }),
      ]),
    );
  });
});
