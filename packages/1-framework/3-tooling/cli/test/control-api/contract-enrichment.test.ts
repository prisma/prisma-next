import type { TargetBoundComponentDescriptor } from '@prisma-next/contract/framework-components';
import type { ContractIR } from '@prisma-next/contract/ir';
import { describe, expect, it } from 'vitest';
import { enrichContractIR } from '../../src/control-api/contract-enrichment';

function makeIR(overrides?: Partial<ContractIR>): ContractIR {
  return {
    schemaVersion: '1',
    targetFamily: 'sql',
    target: 'postgres',
    models: {},
    relations: {},
    storage: {},
    extensionPacks: {},
    capabilities: {},
    meta: {},
    sources: {},
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

describe('enrichContractIR', () => {
  it('returns IR unchanged when no components are provided', () => {
    const ir = makeIR();
    const result = enrichContractIR(ir, []);
    expect(result).toEqual(ir);
  });

  it('merges adapter capabilities into IR', () => {
    const ir = makeIR();
    const adapter = makeAdapter({
      capabilities: {
        postgres: { lateral: true, returning: true },
      },
    });

    const result = enrichContractIR(ir, [adapter]);

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

    const result = enrichContractIR(ir, [adapter, extension]);

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

    const result = enrichContractIR(ir, [adapter]);

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

    const result = enrichContractIR(makeIR(), [extension]);

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

  it('strips controlPlaneHooks from extension pack metadata', () => {
    const extension = makeExtension({
      types: {
        codecTypes: {
          controlPlaneHooks: { 'pg/vector@1': { expandNativeType: () => 'vector' } },
          parameterized: { 'pg/vector@1': () => 'Vector' },
        },
      },
    });

    const result = enrichContractIR(makeIR(), [extension]);
    const packMeta = result.extensionPacks['pgvector'] as Record<string, unknown>;
    const types = packMeta['types'] as Record<string, unknown>;
    const codecTypes = types['codecTypes'] as Record<string, unknown>;

    expect(codecTypes['controlPlaneHooks']).toBeUndefined();
    expect(codecTypes['parameterized']).toBeDefined();
  });

  it('does not create extension pack entries for non-extension components', () => {
    const adapter = makeAdapter({
      capabilities: { postgres: { returning: true } },
    });

    const result = enrichContractIR(makeIR(), [adapter]);

    expect(result.extensionPacks).toEqual({});
  });

  it('ignores non-boolean values in capabilities', () => {
    const adapter = makeAdapter({
      capabilities: {
        postgres: { lateral: true, notABool: 'yes' as unknown },
      },
    });

    const result = enrichContractIR(makeIR(), [adapter]);

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

    const result = enrichContractIR(ir, [adapter]);

    const capKeys = Object.keys(result.capabilities);
    expect(capKeys).toEqual(['alpha', 'mid', 'zebra']);
  });
});
