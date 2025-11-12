import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadExtensionPackManifest } from '@prisma-next/cli/pack-loading';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('pgvector manifest', () => {
  it('loads and validates manifest structure', () => {
    const packPath = join(__dirname, '..');
    const manifest = loadExtensionPackManifest(packPath);

    expect(manifest.id).toBe('pgvector');
    expect(manifest.version).toBe('1.0.0');
    expect(manifest.targets?.['postgres']?.minVersion).toBe('12');
    const postgresCapabilities = manifest.capabilities?.['postgres'] as
      | Record<string, unknown>
      | undefined;
    expect(postgresCapabilities?.['pgvector/cosine']).toBe(true);
  });

  it('has codec types import', () => {
    const packPath = join(__dirname, '..');
    const manifest = loadExtensionPackManifest(packPath);

    expect(manifest.types?.codecTypes?.import).toEqual({
      package: '@prisma-next/extension-pgvector/codec-types',
      named: 'CodecTypes',
      alias: 'PgVectorTypes',
    });
  });

  it('has operation types import', () => {
    const packPath = join(__dirname, '..');
    const manifest = loadExtensionPackManifest(packPath);

    expect(manifest.types?.operationTypes?.import).toEqual({
      package: '@prisma-next/extension-pgvector/operation-types',
      named: 'OperationTypes',
      alias: 'PgVectorOperationTypes',
    });
  });

  it('has cosineDistance operation', () => {
    const packPath = join(__dirname, '..');
    const manifest = loadExtensionPackManifest(packPath);

    expect(manifest.operations).toBeDefined();
    expect(manifest.operations?.length).toBeGreaterThan(0);

    const cosineDistanceOp = manifest.operations?.find(
      (op: { for: string; method: string }) =>
        op.for === 'pg/vector@1' && op.method === 'cosineDistance',
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
});
