import type { Contract } from '@prisma-next/contract/types';
import { coreHash, profileHash } from '@prisma-next/contract/types';
import type { TargetBoundComponentDescriptor } from '@prisma-next/framework-components/components';
import { describe, expect, it } from 'vitest';
import { enrichContract } from '../../src/control-api/contract-enrichment';

function makeIR(overrides?: Partial<Contract>): Contract {
  return {
    targetFamily: 'sql',
    target: 'postgres',
    roots: {},
    models: {},
    storage: { storageHash: coreHash('sha256:test') },
    extensionPacks: {},
    capabilities: {},
    profileHash: profileHash('sha256:test'),
    meta: {},
    ...overrides,
  };
}

function makeAdapter(
  overrides?: Partial<TargetBoundComponentDescriptor<'sql', 'postgres'>>,
): TargetBoundComponentDescriptor<'sql', 'postgres'> {
  return {
    kind: 'adapter',
    id: 'postgres',
    familyId: 'sql',
    targetId: 'postgres',
    version: '0.0.1',
    ...overrides,
  } as TargetBoundComponentDescriptor<'sql', 'postgres'>;
}

function makeExtension(
  overrides?: Partial<TargetBoundComponentDescriptor<'sql', 'postgres'>>,
): TargetBoundComponentDescriptor<'sql', 'postgres'> {
  return {
    kind: 'extension',
    id: 'pgvector',
    familyId: 'sql',
    targetId: 'postgres',
    version: '0.0.1',
    ...overrides,
  } as TargetBoundComponentDescriptor<'sql', 'postgres'>;
}

describe('enrichContract', () => {
  it('returns IR unchanged when no components are provided', () => {
    const ir = makeIR();
    const result = enrichContract(ir, []);
    expect(result).toEqual(ir);
  });

  it('merges adapter capabilities into IR', () => {
    const ir = makeIR();
    const adapter = makeAdapter({
      capabilities: {
        postgres: { lateral: true, returning: true },
      },
    });

    const result = enrichContract(ir, [adapter]);

    expect(result.capabilities).toEqual({
      postgres: { lateral: true, returning: true },
    });
  });

  it('merges capabilities from multiple components', () => {
    const ir = makeIR();
    const adapter = makeAdapter({
      capabilities: {
        postgres: { lateral: true, returning: true },
      },
    });
    const extension = makeExtension({
      capabilities: {
        postgres: { 'pgvector/cosine': true },
      },
    });

    const result = enrichContract(ir, [adapter, extension]);

    expect(result.capabilities).toEqual({
      postgres: {
        lateral: true,
        returning: true,
        'pgvector/cosine': true,
      },
    });
  });

  it('merges framework capabilities with IR baseline capabilities', () => {
    const ir = makeIR({
      capabilities: { sql: { select: true } },
    });
    const adapter = makeAdapter({
      capabilities: { postgres: { returning: true } },
    });

    const result = enrichContract(ir, [adapter]);

    expect(result.capabilities).toEqual({
      sql: { select: true },
      postgres: { returning: true },
    });
  });

  it('extracts extension pack metadata from extension descriptors', () => {
    const extension = makeExtension({
      id: 'pgvector',
      version: '0.0.2',
      capabilities: { postgres: { 'pgvector/cosine': true } },
    });

    const result = enrichContract(makeIR(), [extension]);

    expect(result.extensionPacks).toEqual({
      pgvector: {
        kind: 'extension',
        id: 'pgvector',
        familyId: 'sql',
        targetId: 'postgres',
        version: '0.0.2',
        capabilities: { postgres: { 'pgvector/cosine': true } },
      },
    });
  });

  it('replaces runtime-only extension pack fields with normalized metadata', () => {
    const extension = makeExtension({
      capabilities: { postgres: { 'pgvector/cosine': true } },
      types: {
        codecTypes: {
          import: {
            package: '@prisma-next/extension-pgvector/codec-types',
            named: 'CodecTypes',
            alias: 'PgVectorTypes',
          },
        },
      },
    });

    const result = enrichContract(
      makeIR({
        extensionPacks: {
          pgvector: {
            kind: 'extension',
            id: 'pgvector',
            familyId: 'sql',
            targetId: 'postgres',
            version: '0.0.1',
            create: () => ({ familyId: 'sql', targetId: 'postgres' }),
            authoring: { type: { pgvector: {} } },
          },
        },
      }),
      [extension],
    );

    expect(result.extensionPacks).toEqual({
      pgvector: {
        kind: 'extension',
        id: 'pgvector',
        familyId: 'sql',
        targetId: 'postgres',
        version: '0.0.1',
        capabilities: { postgres: { 'pgvector/cosine': true } },
        types: {
          codecTypes: {
            import: {
              package: '@prisma-next/extension-pgvector/codec-types',
              named: 'CodecTypes',
              alias: 'PgVectorTypes',
            },
          },
        },
      },
    });
  });

  it('strips controlPlaneHooks and codecInstances from extension pack metadata', () => {
    const extension = makeExtension({
      types: {
        codecTypes: {
          controlPlaneHooks: { 'pg/vector@1': { expandNativeType: () => 'vector' } },
          codecInstances: [
            {
              id: 'pg/vector@1',
              targetTypes: ['vector'],
              encode: (v: unknown) => v,
              decode: (v: unknown) => v,
              encodeJson: () => null,
              decodeJson: () => null,
            },
          ],
          import: {
            package: '@ext/pgvector',
            named: 'PgvectorCodecTypes',
            alias: 'PgvectorCodecTypes',
          },
        },
      },
    });

    const result = enrichContract(makeIR(), [extension]);
    const packMeta = result.extensionPacks['pgvector'] as Record<string, unknown>;
    const types = packMeta['types'] as Record<string, unknown>;
    const codecTypes = types['codecTypes'] as Record<string, unknown>;

    expect(codecTypes).not.toHaveProperty('controlPlaneHooks');
    expect(codecTypes).not.toHaveProperty('codecInstances');
    expect(codecTypes['import']).toBeDefined();
  });

  it('does not create extension pack entries for non-extension components', () => {
    const adapter = makeAdapter({
      capabilities: { postgres: { returning: true } },
    });

    const result = enrichContract(makeIR(), [adapter]);

    expect(result.extensionPacks).toEqual({});
  });

  it('ignores non-boolean values in capabilities', () => {
    const adapter = makeAdapter({
      capabilities: {
        postgres: { lateral: true, notABool: 'yes' as unknown },
      },
    });

    const result = enrichContract(makeIR(), [adapter]);

    expect(result.capabilities).toEqual({
      postgres: { lateral: true },
    });
  });

  it('produces deterministically sorted output', () => {
    const ir = makeIR({
      capabilities: { zebra: { z: true }, alpha: { a: true } },
    });
    const adapter = makeAdapter({
      capabilities: { mid: { m: true } },
    });

    const result = enrichContract(ir, [adapter]);

    const capKeys = Object.keys(result.capabilities);
    expect(capKeys).toEqual(['alpha', 'mid', 'zebra']);
  });
});
