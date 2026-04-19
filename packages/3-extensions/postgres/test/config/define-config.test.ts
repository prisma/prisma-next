import postgresAdapter from '@prisma-next/adapter-postgres/control';
import { defineConfig as coreDefineConfig } from '@prisma-next/config/config-types';
import postgresDriver from '@prisma-next/driver-postgres/control';
import sql from '@prisma-next/family-sql/control';
import { prismaContract } from '@prisma-next/sql-contract-psl/provider';
import postgres from '@prisma-next/target-postgres/control';
import { describe, expect, it } from 'vitest';
import { defineConfig } from '../../src/config/define-config';

describe('defineConfig facade', () => {
  it('produces config equivalent to manual wiring for .prisma contracts', () => {
    const contractPath = './prisma/contract.prisma';

    const facadeConfig = defineConfig({ contract: contractPath });

    const extensionPacks: [] = [];

    const manualConfig = coreDefineConfig({
      family: sql,
      target: postgres,
      adapter: postgresAdapter,
      driver: postgresDriver,
      extensionPacks,
      contract: prismaContract(contractPath, {
        output: './prisma/contract.json',
        target: postgres,
      }),
    });

    expect(facadeConfig.family).toBe(manualConfig.family);
    expect(facadeConfig.target).toBe(manualConfig.target);
    expect(facadeConfig.adapter).toBe(manualConfig.adapter);
    expect(facadeConfig.driver).toBe(manualConfig.driver);
    expect(facadeConfig.extensionPacks).toEqual(manualConfig.extensionPacks);
    expect(facadeConfig.contract?.output).toBe(manualConfig.contract?.output);
    expect(facadeConfig.contract?.watchInputs).toEqual(manualConfig.contract?.watchInputs);
    expect(typeof facadeConfig.contract?.source).toBe('function');
  });

  it('derives output path by swapping .prisma to .json', () => {
    const config = defineConfig({ contract: './foo/bar.prisma' });

    expect(config.contract?.output).toBe('./foo/bar.json');
  });

  it('derives output path by swapping .ts to .json', () => {
    const config = defineConfig({ contract: './foo/bar.ts' });

    expect(config.contract?.output).toBe('./foo/bar.json');
  });

  it('selects TypeScript contract provider for .ts files (distinct from PSL provider)', () => {
    const tsConfig = defineConfig({ contract: './prisma/contract.ts' });
    const pslConfig = defineConfig({ contract: './prisma/contract.prisma' });

    expect(typeof tsConfig.contract?.source).toBe('function');
    expect(tsConfig.contract?.output).toBe('./prisma/contract.json');
    expect(tsConfig.contract?.watchInputs).toEqual(['./prisma/contract.ts']);
    expect(tsConfig.contract?.watchStrategy).toBe('moduleGraph');
    expect(tsConfig.contract?.source).not.toBe(pslConfig.contract?.source);
  });

  it('passes db config through', () => {
    const config = defineConfig({
      contract: './prisma/contract.prisma',
      db: { connection: 'postgres://localhost:5432/db' },
    });

    expect(config.db?.connection).toBe('postgres://localhost:5432/db');
  });

  it('passes migrations config through', () => {
    const config = defineConfig({
      contract: './prisma/contract.prisma',
      migrations: { dir: 'custom-migrations' },
    });

    expect(config.migrations?.dir).toBe('custom-migrations');
  });

  it('passes extensions through to config', () => {
    const mockExtension = {
      kind: 'extension' as const,
      familyId: 'sql' as const,
      targetId: 'postgres' as const,
      id: 'test-extension',
      version: '1.0.0',
      create: () => ({
        familyId: 'sql' as const,
        targetId: 'postgres' as const,
      }),
    };

    const config = defineConfig({
      contract: './prisma/contract.prisma',
      extensions: [mockExtension],
    });

    expect(config.extensionPacks).toContain(mockExtension);
  });
});
