import type { Contract } from '@prisma-next/contract/types';
import { generateContractDts } from '@prisma-next/emitter';
import type { CodecLookup } from '@prisma-next/framework-components/codec';
import { describe, expect, it } from 'vitest';
import { sqlEmission } from '../src/index';

// Phase A integration test (F01 from Phase A review): exercise the real
// SQL emitter walk end-to-end for the typeRef-resolver path. Confirms that
// `sqlEmission.resolveFieldTypeParams` walks `storage.fields → storage.tables[t]
// .columns[c] → storage.types[ref].typeParams` and that the framework emit
// path (`generateContractDts`) consults the resolver via the
// `EmissionSpi.resolveFieldTypeParams` hook plumbed in TA.1-TA.2.

function createContract(overrides: Partial<Contract>): Contract {
  return {
    targetFamily: 'sql',
    target: 'test-db',
    models: {},
    roots: {},
    storage: { tables: {} },
    extensionPacks: {},
    capabilities: {},
    meta: {},
    profileHash: 'sha256:test',
    ...overrides,
  };
}

const testHashes = { storageHash: 'sha256:test', profileHash: 'sha256:test' };

function vectorCodecLookup(): CodecLookup {
  return {
    get: (id) =>
      id === 'pg/vector@1'
        ? ({
            id: 'pg/vector@1',
            targetTypes: ['vector'],
            renderOutputType: (params) => `Vector<${params['length']}>`,
            encode: async (v: unknown) => v,
            decode: async (w: unknown) => w,
            encodeJson: (v: unknown) => v as never,
            decodeJson: (j: unknown) => j as never,
            // The framework `Codec` shape narrows `traits` etc.; the
            // structural narrow here is enough for the emit-path test.
          } as unknown as ReturnType<CodecLookup['get']>)
        : undefined,
  };
}

describe('sqlEmission.resolveFieldTypeParams (integration via generateContractDts)', () => {
  it('renders typeRef-shaped parameterized columns via the codec descriptor', () => {
    // Two columns share a named storage.types entry. The SQL emitter's
    // resolveFieldTypeParams walk finds `Embedding1536`'s typeParams via
    // `storage.fields[embedding].column → storage.tables.post.columns
    // .embedding.typeRef → storage.types.Embedding1536.typeParams`, then
    // the framework emit path renders the codec's output expression.
    const contract = createContract({
      models: {
        Post: {
          storage: {
            table: 'post',
            fields: {
              id: { column: 'id' },
              embedding: { column: 'embedding' },
            },
          },
          fields: {
            id: { nullable: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
            embedding: {
              nullable: true,
              type: { kind: 'scalar', codecId: 'pg/vector@1' },
            },
          },
          relations: {},
        },
      },
      storage: {
        tables: {
          post: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
              embedding: {
                nativeType: 'vector',
                codecId: 'pg/vector@1',
                nullable: true,
                typeRef: 'Embedding1536',
              },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
        types: {
          Embedding1536: {
            codecId: 'pg/vector@1',
            nativeType: 'vector',
            typeParams: { length: 1536 },
          },
        },
      },
    });

    const dts = generateContractDts(
      contract,
      sqlEmission,
      [],
      [],
      testHashes,
      undefined,
      vectorCodecLookup(),
    );

    expect(dts).toContain('readonly embedding: Vector<1536> | null');
    expect(dts).not.toContain("CodecTypes['pg/vector@1']['output']");
  });

  it('inline column typeParams continue to win over the resolver', () => {
    // Inline `field.type.typeParams` takes precedence: even though the
    // SQL resolver could find `Embedding1536`, the inline 768 wins.
    const contract = createContract({
      models: {
        Post: {
          storage: {
            table: 'post',
            fields: { embedding: { column: 'embedding' } },
          },
          fields: {
            embedding: {
              nullable: false,
              type: {
                kind: 'scalar',
                codecId: 'pg/vector@1',
                typeParams: { length: 768 },
              },
            },
          },
          relations: {},
        },
      },
      storage: {
        tables: {
          post: {
            columns: {
              embedding: {
                nativeType: 'vector',
                codecId: 'pg/vector@1',
                nullable: false,
                typeRef: 'Embedding1536',
              },
            },
            primaryKey: { columns: ['embedding'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
        types: {
          Embedding1536: {
            codecId: 'pg/vector@1',
            nativeType: 'vector',
            typeParams: { length: 1536 },
          },
        },
      },
    });

    const dts = generateContractDts(
      contract,
      sqlEmission,
      [],
      [],
      testHashes,
      undefined,
      vectorCodecLookup(),
    );

    expect(dts).toContain('readonly embedding: Vector<768>');
    expect(dts).not.toContain('Vector<1536>');
  });
});
