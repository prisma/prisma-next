import { pathToFileURL } from 'node:url';
import postgresAdapter from '@prisma-next/adapter-postgres/control';
import type {
  ContractSourceContext,
  ContractSourceEnvironment,
  PrismaNextConfig,
} from '@prisma-next/config/config-types';
import { defineConfig as coreDefineConfig } from '@prisma-next/config/config-types';
import postgresDriver from '@prisma-next/driver-postgres/control';
import sql from '@prisma-next/family-sql/control';
import type { ControlExtensionDescriptor } from '@prisma-next/framework-components/control';
import { prismaContract } from '@prisma-next/sql-contract-psl/provider';
import postgres from '@prisma-next/target-postgres/control';
import { extname, isAbsolute, resolve } from 'pathe';

export interface PostgresConfigOptions {
  readonly contract: string;
  readonly db?: {
    readonly connection?: string;
  };
  readonly extensions?: readonly ControlExtensionDescriptor<'sql', 'postgres'>[];
  readonly migrations?: {
    readonly dir?: string;
  };
}

function deriveOutputPath(contractPath: string): string {
  const ext = extname(contractPath);
  if (ext.length === 0) {
    return `${contractPath}.json`;
  }
  return `${contractPath.slice(0, -ext.length)}.json`;
}

export function defineConfig(options: PostgresConfigOptions): PrismaNextConfig<'sql', 'postgres'> {
  const extensions = options.extensions ?? [];
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
                '@prisma-next/sql-contract-ts/config-types'
              );
              const mod = await import(pathToFileURL(absolutePath).href);
              const contract = mod.default ?? mod.contract;
              return typescriptContract(contract, output).source.load(context, environment);
            },
          },
          output,
        }
      : prismaContract(options.contract, {
          output,
          target: postgres,
        });

  return coreDefineConfig({
    family: sql,
    target: postgres,
    adapter: postgresAdapter,
    driver: postgresDriver,
    extensionPacks: extensions,
    contract: contractConfig,
    ...(options.db !== undefined ? { db: options.db } : {}),
    ...(options.migrations !== undefined ? { migrations: options.migrations } : {}),
  });
}
