import { dirname, resolve } from 'node:path';
import type { PrismaNextConfig } from '@prisma-next/config/config-types';
import { ConfigValidationError, validateConfig } from '@prisma-next/config/config-validation';
import {
  errorConfigFileNotFound,
  errorConfigValidation,
  errorUnexpected,
} from '@prisma-next/core-control-plane/errors';
import { loadConfig as loadConfigC12 } from 'c12';

/**
 * Loads the Prisma Next config from a TypeScript file.
 * Supports both default export and named export.
 * Uses c12 to automatically handle TypeScript compilation and config file discovery.
 *
 * @param configPath - Optional path to config file. Defaults to `./prisma-next.config.ts` in current directory.
 * @returns The loaded config object.
 * @throws Error if config file doesn't exist or is invalid.
 */
export async function loadConfig(configPath?: string): Promise<PrismaNextConfig> {
  try {
    const cwd = process.cwd();
    // Resolve config path to absolute path and set cwd to config directory when path is provided
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

    return result.config;
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
