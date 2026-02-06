import { describe, expect, it } from 'vitest';
import { sqliteVectorExtensionDescriptor } from '../src/exports/control';

describe('sqlite-vector descriptor', () => {
  it('has correct metadata', () => {
    expect(sqliteVectorExtensionDescriptor.id).toBe('sqlitevector');
    expect(sqliteVectorExtensionDescriptor.version).toBe('0.0.1');
    expect(sqliteVectorExtensionDescriptor.familyId).toBe('sql');
    expect(sqliteVectorExtensionDescriptor.targetId).toBe('sqlite');
    const sqliteCapabilities = sqliteVectorExtensionDescriptor.capabilities?.['sqlite'] as
      | Record<string, unknown>
      | undefined;
    expect(sqliteCapabilities?.['sqlitevector/cosine']).toBe(true);
  });

  it('has codec types import', () => {
    expect(sqliteVectorExtensionDescriptor.types?.codecTypes?.import).toEqual({
      package: '@prisma-next/extension-sqlite-vector/codec-types',
      named: 'CodecTypes',
      alias: 'SqliteVectorTypes',
    });
  });

  it('has operation types import', () => {
    expect(sqliteVectorExtensionDescriptor.types?.operationTypes?.import).toEqual({
      package: '@prisma-next/extension-sqlite-vector/operation-types',
      named: 'OperationTypes',
      alias: 'SqliteVectorOperationTypes',
    });
  });

  it('has cosineDistance operation', () => {
    const operations = sqliteVectorExtensionDescriptor.operations;
    expect(operations).toBeDefined();
    expect(operations?.length).toBeGreaterThan(0);

    const cosineDistanceOp = operations?.find(
      (op: { for: string; method: string }) =>
        op.for === 'sqlite/vector@1' && op.method === 'cosineDistance',
    );

    expect(cosineDistanceOp).toBeDefined();
    expect(cosineDistanceOp?.args).toEqual([{ kind: 'param' }]);
    expect(cosineDistanceOp?.returns).toEqual({ kind: 'builtin', type: 'number' });
    expect(cosineDistanceOp?.lowering.targetFamily).toBe('sql');
    expect(cosineDistanceOp?.lowering.strategy).toBe('function');
    expect(cosineDistanceOp?.lowering.template).toContain('json_each');
    expect(cosineDistanceOp?.lowering.template).toContain('SQRT');
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

  // Note: sqlite-vector doesn't currently ship parameterized type renderers.
});
