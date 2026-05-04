import { timeouts } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import { VECTOR_CODEC_ID } from '../src/core/constants';
import { pgvectorExtensionDescriptor } from '../src/exports/control';
import pgvectorRuntimeDescriptor from '../src/exports/runtime';

describe('pgvector descriptor', () => {
  it('has correct metadata', () => {
    expect(pgvectorExtensionDescriptor.id).toBe('pgvector');
    expect(pgvectorExtensionDescriptor.version).toBe('0.0.1');
    expect(pgvectorExtensionDescriptor.familyId).toBe('sql');
    expect(pgvectorExtensionDescriptor.targetId).toBe('postgres');
    const postgresCapabilities = pgvectorExtensionDescriptor.capabilities?.['postgres'] as
      | Record<string, unknown>
      | undefined;
    expect(postgresCapabilities?.['pgvector.cosine']).toBe(true);
  });

  it('has codec types import', () => {
    expect(pgvectorExtensionDescriptor.types?.codecTypes?.import).toEqual({
      package: '@prisma-next/extension-pgvector/codec-types',
      named: 'CodecTypes',
      alias: 'PgVectorTypes',
    });
  });

  it('has operation types import', () => {
    expect(pgvectorExtensionDescriptor.types?.operationTypes?.import).toEqual({
      package: '@prisma-next/extension-pgvector/operation-types',
      named: 'OperationTypes',
      alias: 'PgVectorOperationTypes',
    });
  });

  it(
    'codec types are importable',
    async () => {
      // Verify the codec types module can be imported (type-only export)
      // Type-only exports don't exist at runtime, so we just verify the import succeeds
      await expect(import('../src/exports/codec-types')).resolves.toBeDefined();
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'operation types are importable',
    async () => {
      // Verify the operation types module can be imported (type-only export)
      // Type-only exports don't exist at runtime, so we just verify the import succeeds
      await expect(import('../src/exports/operation-types')).resolves.toBeDefined();
    },
    timeouts.typeScriptCompilation,
  );

  // The pgvector parameterized descriptor declares
  // `encodeIsParamsIndependent: true` so the runtime registry tolerates
  // multiple `vector(N)` columns of different lengths sharing the same
  // codec id without rejecting `forCodecId('pg/vector@1')` as ambiguous.
  // The wire format `[v1,v2,...]` is dimension-independent — every
  // resolved instance encodes equivalently. Pinning the flag here keeps
  // the invariant load-bearing if anyone refactors `vectorFactory` to
  // close over `params` (which would otherwise produce reference-distinct
  // instances and trip the registry's ambiguity guard).
  it('parameterized vector descriptor declares encodeIsParamsIndependent', () => {
    const parameterizedCodecs = pgvectorRuntimeDescriptor.parameterizedCodecs();
    const vectorDescriptor = parameterizedCodecs.find((d) => d.codecId === VECTOR_CODEC_ID);
    expect(vectorDescriptor).toBeDefined();
    expect(vectorDescriptor?.encodeIsParamsIndependent).toBe(true);
  });
});
