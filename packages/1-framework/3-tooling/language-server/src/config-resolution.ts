import { access } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { loadConfig } from '@prisma-next/config-loader';
import { CliStructuredError } from '@prisma-next/errors/control';
import { emptySchemaInputSet, resolveSchemaInputs, type SchemaInputSet } from './schema-inputs';

// Exported so the watcher glob and the resolution load from the same path.
export const CONFIG_FILENAME = 'prisma-next.config.ts';

const CODE_CONFIG_FILE_NOT_FOUND = '4001';
const CODE_CONFIG_VALIDATION = '4009';

export interface ConfigResolution {
  readonly inputs: SchemaInputSet;
  readonly degradedReason?: string;
}

export async function resolveConfigInputs(
  rootPath: string,
  configPath?: string,
): Promise<ConfigResolution> {
  return loadResolvedConfigInputs(configPath ?? join(rootPath, CONFIG_FILENAME));
}

export async function resolveConfigInputsForFile(
  rootPath: string,
  filePath: string,
  configPath?: string,
): Promise<ConfigResolution> {
  const resolvedConfigPath =
    configPath ??
    (await findNearestConfigPath(rootPath, filePath)) ??
    join(rootPath, CONFIG_FILENAME);
  return loadResolvedConfigInputs(resolvedConfigPath);
}

async function loadResolvedConfigInputs(resolvedConfigPath: string): Promise<ConfigResolution> {
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

async function findNearestConfigPath(
  rootPath: string,
  filePath: string,
): Promise<string | undefined> {
  const root = resolve(rootPath);
  let current = dirname(resolve(filePath));

  while (isWithinRoot(root, current)) {
    const candidate = join(current, CONFIG_FILENAME);
    if (await fileExists(candidate)) {
      return candidate;
    }
    if (current === root) {
      break;
    }
    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return undefined;
}

function isWithinRoot(root: string, path: string): boolean {
  const relativePath = relative(root, path);
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
