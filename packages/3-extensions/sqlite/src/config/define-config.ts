import sqliteAdapter from '@prisma-next/adapter-sqlite/control';
import type { PrismaNextConfig } from '@prisma-next/config/config-types';
import { defineConfig as coreDefineConfig } from '@prisma-next/config/config-types';
import sqliteDriver from '@prisma-next/driver-sqlite/control';
import sql from '@prisma-next/family-sql/control';
import type { ControlExtensionDescriptor } from '@prisma-next/framework-components/control';
import { prismaContract } from '@prisma-next/sql-contract-psl/provider';
import { typescriptContractFromPath } from '@prisma-next/sql-contract-ts/config-types';
import {
  SQLITE_INTEGER_CODEC_ID,
  SQLITE_TEXT_CODEC_ID,
} from '@prisma-next/target-sqlite/codec-ids';
import sqlite, { sqliteCreateNamespace } from '@prisma-next/target-sqlite/control';
import sqlitePackRef from '@prisma-next/target-sqlite/pack';
import { ifDefined } from '@prisma-next/utils/defined';
import { extname, join } from 'pathe';

export interface SqliteConfigOptions {
  readonly contract: string;
  readonly output?: string;
  readonly db?: {
    readonly connection?: string;
  };
  readonly extensions?: readonly ControlExtensionDescriptor<'sql', 'sqlite'>[];
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

export function defineConfig(options: SqliteConfigOptions): PrismaNextConfig<'sql', 'sqlite'> {
  const extensions = options.extensions ?? [];
  const output =
    options.output !== undefined
      ? join(options.output, 'contract.json')
      : deriveOutputPath(options.contract);
  const ext = extname(options.contract);

  const contractConfig =
    ext === '.ts'
      ? typescriptContractFromPath(options.contract, output)
      : prismaContract(options.contract, {
          output,
          target: sqlitePackRef,
          createNamespace: sqliteCreateNamespace,
          enumInferenceCodecs: { text: SQLITE_TEXT_CODEC_ID, int: SQLITE_INTEGER_CODEC_ID },
        });

  return coreDefineConfig({
    family: sql,
    target: sqlite,
    adapter: sqliteAdapter,
    driver: sqliteDriver,
    extensions,
    contract: contractConfig,
    ...ifDefined('db', options.db),
    ...ifDefined('migrations', options.migrations),
  });
}
