import { MONGO_INT32_CODEC_ID, MONGO_STRING_CODEC_ID } from '@prisma-next/adapter-mongo/codec-ids';
import mongoAdapter from '@prisma-next/adapter-mongo/control';
import type { PrismaNextConfig } from '@prisma-next/config/config-types';
import { defineConfig as coreDefineConfig } from '@prisma-next/config/config-types';
import mongoDriver from '@prisma-next/driver-mongo/control';
import { mongoFamilyDescriptor } from '@prisma-next/family-mongo/control';
import type { ControlExtensionDescriptor } from '@prisma-next/framework-components/control';
import { mongoContract } from '@prisma-next/mongo-contract-psl/provider';
import { typescriptContractFromPath } from '@prisma-next/mongo-contract-ts/config-types';
import { mongoTargetDescriptor } from '@prisma-next/target-mongo/control';
import { ifDefined } from '@prisma-next/utils/defined';
import { extname, join } from 'pathe';

export interface MongoConfigOptions {
  readonly contract: string;
  readonly output?: string;
  readonly db?: {
    readonly connection?: string;
  };
  readonly extensions?: readonly ControlExtensionDescriptor<'mongo', 'mongo'>[];
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

export function defineConfig(options: MongoConfigOptions): PrismaNextConfig<'mongo', 'mongo'> {
  const extensions = options.extensions ?? [];
  const output =
    options.output !== undefined
      ? join(options.output, 'contract.json')
      : deriveOutputPath(options.contract);
  const ext = extname(options.contract);

  const contractConfig =
    ext === '.ts'
      ? typescriptContractFromPath(options.contract, output)
      : mongoContract(options.contract, {
          output,
          enumInferenceCodecs: { text: MONGO_STRING_CODEC_ID, int: MONGO_INT32_CODEC_ID },
        });

  return coreDefineConfig({
    family: mongoFamilyDescriptor,
    target: mongoTargetDescriptor,
    adapter: mongoAdapter,
    driver: mongoDriver,
    extensions,
    contract: contractConfig,
    ...ifDefined('db', options.db),
    ...ifDefined('migrations', options.migrations),
  });
}
