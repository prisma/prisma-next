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
    expect(postgresCapabilities?.['pgvector/cosine']).toBe(true);
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

  it('has cosineDistance operation via operationSignatures()', () => {
    const operations = pgvectorExtensionDescriptor.operationSignatures();
    expect(operations.length).toBeGreaterThan(0);

    const cosineDistanceOp = operations.find(
      (op) => op.forTypeId === 'pg/vector@1' && op.method === 'cosineDistance',
    );

    expect(cosineDistanceOp).toBeDefined();
    expect(cosineDistanceOp?.args).toEqual([{ kind: 'param' }]);
    expect(cosineDistanceOp?.returns).toEqual({ kind: 'builtin', type: 'number' });
    expect(cosineDistanceOp?.lowering).toEqual({
      targetFamily: 'sql',
      strategy: 'function',
      template: '1 - ({{self}} <=> {{arg0}})',
    });
  });

  it('codec types are importable', async () => {
    // Verify the codec types module can be imported (type-only export)
    // Type-only exports don't exist at runtime, so we just verify the import succeeds
    await expect(import('../src/exports/codec-types')).resolves.toBeDefined();
  });

  it('operation types are importable', async () => {
    // Verify the operation types module can be imported (type-only export)
    // Type-only exports don't exist at runtime, so we just verify the import succeeds
    await expect(import('../src/exports/operation-types')).resolves.toBeDefined();
  });

  describe('parameterized codec renderers', () => {
    it('has parameterized renderers in codecTypes', () => {
      const parameterized = pgvectorExtensionDescriptor.types?.codecTypes?.parameterized;
      expect(parameterized).toHaveProperty('pg/vector@1');
    });

    it('vector codec has template renderer', () => {
      const vectorRenderer =
        pgvectorExtensionDescriptor.types?.codecTypes?.parameterized?.['pg/vector@1'];
      expect(vectorRenderer).toBe('Vector<{{length}}>');
    });
  });
});
