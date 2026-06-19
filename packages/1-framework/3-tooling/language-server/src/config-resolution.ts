import { join } from 'node:path';
import { loadConfig } from '@prisma-next/config-loader';
import { resolveSchemaInputs, type SchemaInputSet } from './schema-inputs';

// Exported so the watcher glob and the resolution load from the same path.
export const CONFIG_FILENAME = 'prisma-next.config.ts';

export interface ConfigResolution {
  readonly inputs: SchemaInputSet;
}

export async function resolveConfigInputs(
  rootPath: string,
  configPath?: string,
): Promise<ConfigResolution> {
  return loadResolvedConfigInputs(configPath ?? join(rootPath, CONFIG_FILENAME));
}

async function loadResolvedConfigInputs(resolvedConfigPath: string): Promise<ConfigResolution> {
  const config = await loadConfig(resolvedConfigPath);
  return { inputs: resolveSchemaInputs(config) };
}
