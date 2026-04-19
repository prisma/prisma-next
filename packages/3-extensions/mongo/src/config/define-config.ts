import { pathToFileURL } from 'node:url';
import mongoAdapter from '@prisma-next/adapter-mongo/control';
import type { ContractSourceContext, PrismaNextConfig } from '@prisma-next/config/config-types';
import { defineConfig as coreDefineConfig } from '@prisma-next/config/config-types';
import mongoDriver from '@prisma-next/driver-mongo/control';
import { mongoFamilyDescriptor, mongoTargetDescriptor } from '@prisma-next/family-mongo/control';
import { mongoContract } from '@prisma-next/mongo-contract-psl/provider';
import { extname, isAbsolute, resolve } from 'pathe';

export interface MongoConfigOptions {
  readonly contract: string;
  readonly db?: {
    readonly connection?: string;
  };
}

function deriveOutputPath(contractPath: string): string {
  const ext = extname(contractPath);
  if (ext.length === 0) {
    return `${contractPath}.json`;
  }
  return `${contractPath.slice(0, -ext.length)}.json`;
}

export function defineConfig(options: MongoConfigOptions): PrismaNextConfig<'mongo', 'mongo'> {
  const output = deriveOutputPath(options.contract);
  const ext = extname(options.contract);

  const absoluteContractPath = isAbsolute(options.contract)
    ? options.contract
    : resolve(process.cwd(), options.contract);

  const contractConfig =
    ext === '.ts'
      ? {
          source: async (context: ContractSourceContext) => {
            const { typescriptContract } = await import(
              '@prisma-next/mongo-contract-ts/config-types'
            );
            const mod = await import(pathToFileURL(absoluteContractPath).href);
            const contract = mod.default ?? mod.contract;
            return typescriptContract(contract, output).source(context);
          },
          output,
          watchInputs: [options.contract],
          watchStrategy: 'moduleGraph' as const,
        }
      : mongoContract(options.contract, { output });

  return coreDefineConfig({
    family: mongoFamilyDescriptor,
    target: mongoTargetDescriptor,
    adapter: mongoAdapter,
    driver: mongoDriver,
    contract: contractConfig,
    ...(options.db !== undefined ? { db: options.db } : {}),
  });
}
