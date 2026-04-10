import { timeouts } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import { pgvectorExtensionDescriptor } from '../src/exports/control';

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
});
