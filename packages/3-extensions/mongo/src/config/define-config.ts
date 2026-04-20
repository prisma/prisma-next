import { pathToFileURL } from 'node:url';
import mongoAdapter from '@prisma-next/adapter-mongo/control';
import type {
  ContractSourceContext,
  ContractSourceEnvironment,
  PrismaNextConfig,
} from '@prisma-next/config/config-types';
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

  const contractConfig =
    ext === '.ts'
      ? {
          source: {
            inputs: [options.contract],
            load: async (
              context: ContractSourceContext,
              environment: ContractSourceEnvironment,
            ) => {
              const absolutePath = isAbsolute(options.contract)
                ? options.contract
                : resolve(environment.configDir, options.contract);
              const { typescriptContract } = await import(
                '@prisma-next/mongo-contract-ts/config-types'
              );
              const mod = await import(pathToFileURL(absolutePath).href);
              const contract = mod.default ?? mod.contract;
              return typescriptContract(contract, output).source.load(context, environment);
            },
          },
          output,
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
