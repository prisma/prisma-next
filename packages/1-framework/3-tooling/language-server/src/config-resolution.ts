import { loadConfig } from '@prisma-next/config-loader';
import { resolveSchemaInputs, type SchemaInputSet } from './schema-inputs';

export const CONFIG_FILENAME = 'prisma-next.config.ts';

export interface ConfigResolution {
  readonly inputs: SchemaInputSet;
}

export async function resolveConfigInputs(configPath: string): Promise<ConfigResolution> {
  const config = await loadConfig(configPath);
  return { inputs: resolveSchemaInputs(config) };
}
