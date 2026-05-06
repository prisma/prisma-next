/**
 * Integration: PSL `@@index([cols], type: "...", options: { ... })` parses
 * end-to-end through the real paradedb pack and validates against the
 * registered bm25 index-type entry.
 */
import type { Contract } from '@prisma-next/contract/types';
import { paradedbIndexTypes } from '@prisma-next/extension-paradedb/index-types';
import paradedbPack from '@prisma-next/extension-paradedb/pack';
import { emptyCodecLookup } from '@prisma-next/framework-components/codec';
import { parsePslDocument } from '@prisma-next/psl-parser';
import { createIndexTypeRegistry } from '@prisma-next/sql-contract/index-types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { validateContract } from '@prisma-next/sql-contract/validate';
import { interpretPslDocumentToSqlContract } from '@prisma-next/sql-contract-psl';
import postgresPack from '@prisma-next/target-postgres/pack';
import { describe, expect, it } from 'vitest';

const scalarTypeDescriptors = new Map<string, { codecId: string; nativeType: string }>([
  ['Int', { codecId: 'pg/int4@1', nativeType: 'int4' }],
  ['String', { codecId: 'pg/text@1', nativeType: 'text' }],
]);

function interpret(schema: string) {
  return interpretPslDocumentToSqlContract({
    document: parsePslDocument({ schema, sourceId: 'schema.prisma' }),
    target: postgresPack,
    scalarTypeDescriptors,
    composedExtensionPacks: [paradedbPack.id],
    composedExtensionPackRefs: [paradedbPack],
  });
}

describe('PSL @@index type and options — integration with real paradedb pack', () => {
  it('lowers the documented example to a Contract IR index node carrying type, options, and name', () => {
    const result = interpret(`model Doc {
  id Int @id
  body String
  @@index([body], type: "bm25", options: { key_field: "id" }, map: "doc_body_bm25_idx")
}`);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.storage).toMatchObject({
      tables: {
        doc: {
          indexes: [
            {
              columns: ['body'],
              name: 'doc_body_bm25_idx',
              type: 'bm25',
              options: { key_field: 'id' },
            },
          ],
        },
      },
    });
  });

  it('validates the lowered contract against a paradedb-registered index registry', () => {
    const result = interpret(`model Doc {
  id Int @id
  body String
  @@index([body], type: "bm25", options: { key_field: "id" })
}`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const registry = createIndexTypeRegistry();
    for (const entry of paradedbIndexTypes.entries) {
      registry.register(entry);
    }

    expect(() =>
      validateContract<Contract<SqlStorage>>(result.value, emptyCodecLookup, {
        indexTypeRegistry: registry,
      }),
    ).not.toThrow();
  });

  it('the registry rejects a PSL-authored bm25 index whose options miss key_field', () => {
    const result = interpret(`model Doc {
  id Int @id
  body String
  @@index([body], type: "bm25", options: { wrong_field: "x" })
}`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const registry = createIndexTypeRegistry();
    for (const entry of paradedbIndexTypes.entries) {
      registry.register(entry);
    }

    expect(() =>
      validateContract<Contract<SqlStorage>>(result.value, emptyCodecLookup, {
        indexTypeRegistry: registry,
      }),
    ).toThrow(/key_field|bm25/);
  });

  it('the registry rejects a PSL-authored index whose type is not registered', () => {
    const result = interpret(`model Doc {
  id Int @id
  body String
  @@index([body], type: "made-up")
}`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.storage).toMatchObject({
      tables: { doc: { indexes: [{ columns: ['body'], type: 'made-up' }] } },
    });

    const registry = createIndexTypeRegistry();
    for (const entry of paradedbIndexTypes.entries) {
      registry.register(entry);
    }

    expect(() =>
      validateContract<Contract<SqlStorage>>(result.value, emptyCodecLookup, {
        indexTypeRegistry: registry,
      }),
    ).toThrow(/unregistered index type "made-up"/);
  });

  it('lowers an empty options literal to {} and the registry rejects it for bm25 (missing key_field)', () => {
    const result = interpret(`model Doc {
  id Int @id
  body String
  @@index([body], type: "bm25", options: {})
}`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.storage).toMatchObject({
      tables: { doc: { indexes: [{ columns: ['body'], type: 'bm25', options: {} }] } },
    });

    const registry = createIndexTypeRegistry();
    for (const entry of paradedbIndexTypes.entries) {
      registry.register(entry);
    }

    expect(() =>
      validateContract<Contract<SqlStorage>>(result.value, emptyCodecLookup, {
        indexTypeRegistry: registry,
      }),
    ).toThrow(/key_field/);
  });
});
