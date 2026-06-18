import { join } from 'node:path';
import { loadConfig } from '@prisma-next/config-loader';
import { CliStructuredError } from '@prisma-next/errors/control';
import { emptySchemaInputSet, resolveSchemaInputs, type SchemaInputSet } from './schema-inputs';

// Exported so the watcher glob and the resolution load from the same path.
export const CONFIG_FILENAME = 'prisma-next.config.ts';

// Stable structured-error codes the loader raises for the two degradable
// config failures (see `@prisma-next/errors/control`): 4001 = config file not
// found, 4009 = config validation. Any other code is a genuine failure.
const CODE_CONFIG_FILE_NOT_FOUND = '4001';
const CODE_CONFIG_VALIDATION = '4009';

export interface ConfigResolution {
  readonly inputs: SchemaInputSet;
  readonly degradedReason?: string;
}

// `loadConfig` raises a structured `CliStructuredError`; a missing or invalid
// config degrades gracefully to an empty input set with a `degradedReason` the
// caller can log. Any other structured code (or non-structured error) re-throws.
export async function resolveConfigInputs(
  rootPath: string,
  configPath?: string,
): Promise<ConfigResolution> {
  const resolvedConfigPath = configPath ?? join(rootPath, CONFIG_FILENAME);
  try {
    const config = await loadConfig(resolvedConfigPath);
    return { inputs: resolveSchemaInputs(config) };
  } catch (error) {
    if (error instanceof CliStructuredError) {
      if (error.code === CODE_CONFIG_FILE_NOT_FOUND) {
        return {
          inputs: emptySchemaInputSet,
          degradedReason: `No Prisma Next config found (${error.where?.path ?? resolvedConfigPath}); no schema inputs are diagnosed.`,
        };
      }
      if (error.code === CODE_CONFIG_VALIDATION) {
        return {
          inputs: emptySchemaInputSet,
          degradedReason: `Prisma Next config is invalid (${error.why ?? 'unknown reason'}); no schema inputs are diagnosed.`,
        };
      }
    }
    throw error;
  }
}
