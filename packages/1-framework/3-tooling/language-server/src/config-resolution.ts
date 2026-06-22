import { loadConfig } from '@prisma-next/config-loader';
import type { FormatOptions } from '@prisma-next/psl-parser/format';
import { resolveSchemaInputs, type SchemaInputSet } from './schema-inputs';

export const CONFIG_FILENAME = 'prisma-next.config.ts';

export interface ConfigResolution {
  readonly inputs: SchemaInputSet;
  readonly formatter?: FormatOptions;
}

export async function resolveConfigInputs(configPath: string): Promise<ConfigResolution> {
  const config = await loadConfig(configPath);
  const inputs = resolveSchemaInputs(config);
  return config.formatter === undefined ? { inputs } : { inputs, formatter: config.formatter };
}
