import mongoAdapter from '@prisma-next/adapter-mongo/control';
import { defineConfig as coreDefineConfig } from '@prisma-next/config/config-types';
import mongoDriver from '@prisma-next/driver-mongo/control';
import { mongoFamilyDescriptor, mongoTargetDescriptor } from '@prisma-next/family-mongo/control';
import { mongoContract } from '@prisma-next/mongo-contract-psl/provider';
import { describe, expect, it } from 'vitest';
import { defineConfig } from '../../src/config/define-config';

describe('defineConfig facade', () => {
  it('produces config equivalent to manual wiring for .prisma contracts', () => {
    const contractPath = './prisma/contract.prisma';

    const facadeConfig = defineConfig({ contract: contractPath });

    const manualConfig = coreDefineConfig({
      family: mongoFamilyDescriptor,
      target: mongoTargetDescriptor,
      adapter: mongoAdapter,
      driver: mongoDriver,
      contract: mongoContract(contractPath, {
        output: './prisma/contract.json',
      }),
    });

    expect(facadeConfig.family).toBe(manualConfig.family);
    expect(facadeConfig.target).toBe(manualConfig.target);
    expect(facadeConfig.adapter).toBe(manualConfig.adapter);
    expect(facadeConfig.driver).toBe(manualConfig.driver);
    expect(facadeConfig.contract?.output).toBe(manualConfig.contract?.output);
    expect(facadeConfig.contract?.source.inputs).toEqual(manualConfig.contract?.source.inputs);
    expect(typeof facadeConfig.contract?.source.load).toBe('function');
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

    expect(typeof tsConfig.contract?.source.load).toBe('function');
    expect(tsConfig.contract?.output).toBe('./prisma/contract.json');
    expect(tsConfig.contract?.source.inputs).toEqual(['./prisma/contract.ts']);
    expect(tsConfig.contract?.source).not.toBe(pslConfig.contract?.source);
  });

  it('passes db config through', () => {
    const config = defineConfig({
      contract: './prisma/contract.prisma',
      db: { connection: 'mongodb://localhost:27017/mydb' },
    });

    expect(config.db?.connection).toBe('mongodb://localhost:27017/mydb');
  });
});
