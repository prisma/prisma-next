import { loadConfig } from '@prisma-next/config-loader';
import { resolveSchemaInputs, type SchemaInputSet } from './schema-inputs';

export const CONFIG_FILENAME = 'prisma-next.config.ts';

export interface ConfigResolution {
  readonly inputs: SchemaInputSet;
}

export async function resolveConfigInputs(configPath: string): Promise<ConfigResolution> {
  return loadResolvedConfigInputs(configPath);
}

async function loadResolvedConfigInputs(resolvedConfigPath: string): Promise<ConfigResolution> {
  const config = await loadConfig(resolvedConfigPath);
  return { inputs: resolveSchemaInputs(config) };
}
