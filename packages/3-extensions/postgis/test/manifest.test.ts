import { timeouts } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import { postgisExtensionDescriptor } from '../src/exports/control';

describe('postgis descriptor', () => {
  it('has correct metadata', () => {
    expect(postgisExtensionDescriptor.id).toBe('postgis');
    expect(postgisExtensionDescriptor.version).toBe('0.0.1');
    expect(postgisExtensionDescriptor.familyId).toBe('sql');
    expect(postgisExtensionDescriptor.targetId).toBe('postgres');
    const postgresCapabilities = postgisExtensionDescriptor.capabilities?.['postgres'] as
      | Record<string, unknown>
      | undefined;
    expect(postgresCapabilities?.['postgis.geometry']).toBe(true);
  });

  it('has codec types import', () => {
    expect(postgisExtensionDescriptor.types?.codecTypes?.import).toEqual({
      package: '@prisma-next/extension-postgis/codec-types',
      named: 'CodecTypes',
      alias: 'PostgisTypes',
    });
  });

  it('has operation types import', () => {
    expect(postgisExtensionDescriptor.types?.operationTypes?.import).toEqual({
      package: '@prisma-next/extension-postgis/operation-types',
      named: 'OperationTypes',
      alias: 'PostgisOperationTypes',
    });
  });

  it('declares postgis as a database init dependency', () => {
    const init = postgisExtensionDescriptor.databaseDependencies?.init;
    expect(init).toBeDefined();
    expect(init?.[0]?.id).toBe('postgres.extension.postgis');
    expect(init?.[0]?.install?.[0]?.execute?.[0]?.sql).toContain(
      'CREATE EXTENSION IF NOT EXISTS postgis',
    );
  });

  it(
    'codec types are importable',
    async () => {
      await expect(import('../src/exports/codec-types')).resolves.toBeDefined();
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'operation types are importable',
    async () => {
      await expect(import('../src/exports/operation-types')).resolves.toBeDefined();
    },
    timeouts.typeScriptCompilation,
  );
});
