import { dirname, resolve } from 'node:path';
import type { ContractConfig, PrismaNextConfig } from '@prisma-next/config/config-types';
import { ConfigValidationError, validateConfig } from '@prisma-next/config/config-validation';
import {
  errorConfigFileNotFound,
  errorConfigValidation,
  errorUnexpected,
} from '@prisma-next/errors/control';
import { loadConfig as loadConfigC12 } from 'c12';

const DEFAULT_CONFIG_FILE = 'prisma-next.config.ts';
const DEFAULT_CONTRACT_OUTPUT = 'src/prisma/contract.json';

export interface ContractWatchWarning {
  readonly code: 'CONTRACT_WATCH_INPUTS_PARTIAL';
  readonly message: string;
}

export interface LoadedContractWatchMetadata {
  readonly inputs: readonly string[];
  readonly warnings: readonly ContractWatchWarning[];
}

export interface LoadedConfigMetadata {
  readonly resolvedConfigPath: string;
  readonly contractWatch: LoadedContractWatchMetadata | null;
}

export interface LoadedConfigResult {
  readonly config: PrismaNextConfig;
  readonly metadata: LoadedConfigMetadata;
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function buildContractWatchMetadata(
  contract: ContractConfig | undefined,
  resolvedConfigPath: string,
): LoadedContractWatchMetadata | null {
  if (!contract) {
    return null;
  }

  const configDir = dirname(resolvedConfigPath);
  const outputJsonPath = resolve(configDir, contract.output ?? DEFAULT_CONTRACT_OUTPUT);
  const outputDtsPath = outputJsonPath?.endsWith('.json')
    ? `${outputJsonPath.slice(0, -5)}.d.ts`
    : undefined;
  const resolvedInputs = uniqueStrings(
    (contract.watchInputs ?? []).map((input) => resolve(configDir, input)),
  ).filter((input) => input !== outputJsonPath && input !== outputDtsPath);

  if (contract.watchInputs !== undefined || contract.watchStrategy === 'moduleGraph') {
    return {
      inputs: resolvedInputs,
      warnings: [],
    };
  }

  return {
    inputs: [resolvedConfigPath],
    warnings: [
      {
        code: 'CONTRACT_WATCH_INPUTS_PARTIAL',
        message:
          'Contract source provider did not declare watch inputs. Falling back to the config file only; dev watch coverage is partial until contract.watchInputs or contract.watchStrategy is set.',
      },
    ],
  };
}

async function loadValidatedConfig(
  configPath?: string,
): Promise<{ config: PrismaNextConfig; resolvedConfigPath: string }> {
  const cwd = process.cwd();
  const resolvedConfigPath = configPath ? resolve(cwd, configPath) : undefined;
  const configCwd = resolvedConfigPath ? dirname(resolvedConfigPath) : cwd;

  const result = await loadConfigC12<PrismaNextConfig>({
    name: 'prisma-next',
    ...(resolvedConfigPath ? { configFile: resolvedConfigPath } : {}),
    cwd: configCwd,
  });

  // When a specific config file was requested, verify it was actually loaded
  // (c12 falls back to searching by name if the specified file doesn't exist)
  if (resolvedConfigPath && result.configFile !== resolvedConfigPath) {
    throw errorConfigFileNotFound(resolvedConfigPath);
  }

  // Check if config is missing or empty (c12 may return empty object when file doesn't exist)
  if (!result.config || Object.keys(result.config).length === 0) {
    // Use c12's configFile if available, otherwise use explicit configPath, otherwise omit path
    const displayPath = result.configFile || resolvedConfigPath || configPath;
    throw errorConfigFileNotFound(displayPath);
  }

  // Validate config structure
  validateConfig(result.config);

  return {
    config: result.config,
    resolvedConfigPath: result.configFile
      ? resolve(result.configFile)
      : (resolvedConfigPath ?? resolve(configCwd, DEFAULT_CONFIG_FILE)),
  };
}

/**
 * Loads the Prisma Next config from a TypeScript file.
 * Supports both default export and named export.
 * Uses c12 to automatically handle TypeScript compilation and config file discovery.
 *
 * @param configPath - Optional path to config file. Defaults to `./prisma-next.config.ts` in current directory.
 * @returns The loaded config object plus resolved dev-watch metadata.
 * @throws Error if config file doesn't exist or is invalid.
 */
export async function loadConfigWithMetadata(configPath?: string): Promise<LoadedConfigResult> {
  try {
    const loaded = await loadValidatedConfig(configPath);
    return {
      config: loaded.config,
      metadata: {
        resolvedConfigPath: loaded.resolvedConfigPath,
        contractWatch: buildContractWatchMetadata(
          loaded.config.contract,
          loaded.resolvedConfigPath,
        ),
      },
    };
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      throw errorConfigValidation(error.field, {
        why: error.why,
      });
    }

    // Re-throw structured errors as-is
    if (
      error instanceof Error &&
      'code' in error &&
      typeof (error as { code: string }).code === 'string'
    ) {
      throw error;
    }

    if (error instanceof Error) {
      // Check for file not found errors
      if (
        error.message.includes('not found') ||
        error.message.includes('Cannot find') ||
        error.message.includes('ENOENT')
      ) {
        // Use resolved path if available, otherwise use original configPath
        const displayPath = configPath ? resolve(process.cwd(), configPath) : undefined;
        throw errorConfigFileNotFound(displayPath, {
          why: error.message,
        });
      }
      // For other errors, wrap in unexpected error
      throw errorUnexpected(error.message, {
        why: `Failed to load config: ${error.message}`,
      });
    }
    throw errorUnexpected(String(error));
  }
}

/**
 * Loads only the normalized config object.
 */
export async function loadConfig(configPath?: string): Promise<PrismaNextConfig> {
  return (await loadConfigWithMetadata(configPath)).config;
}
