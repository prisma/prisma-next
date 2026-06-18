import type { PrismaNextConfig } from '@prisma-next/config/config-types';
import { validateConfig } from '@prisma-next/config/config-validation';
import {
  ConfigFileNotFoundError,
  ConfigValidationError,
  finalizeConfig,
} from '@prisma-next/config/load-helpers';
import { getEmittedArtifactPaths } from '@prisma-next/emitter';
import {
  errorConfigFileNotFound,
  errorConfigValidation,
  errorUnexpected,
} from '@prisma-next/errors/control';
import { ifDefined } from '@prisma-next/utils/defined';
import { loadConfig as loadConfigC12 } from 'c12';
import { dirname, resolve } from 'pathe';

// The emitter-derived collision check lives in the same tooling layer as this
// package, so the loader always supplies it — consumers never pass a hook.
async function discoverAndFinalizeConfig(configPath?: string): Promise<PrismaNextConfig> {
  const cwd = process.cwd();
  const resolvedConfigPath = configPath ? resolve(cwd, configPath) : undefined;
  const configCwd = resolvedConfigPath ? dirname(resolvedConfigPath) : cwd;

  const result = await loadConfigC12<PrismaNextConfig>({
    name: 'prisma-next',
    ...ifDefined('configFile', resolvedConfigPath),
    cwd: configCwd,
  });

  // c12 silently falls back to name-based discovery when the requested file is
  // absent; reject that so an explicit path that doesn't exist is an error.
  if (resolvedConfigPath && result.configFile !== resolvedConfigPath) {
    throw new ConfigFileNotFoundError(resolvedConfigPath);
  }

  if (!result.config || Object.keys(result.config).length === 0) {
    /* v8 ignore next -- @preserve c12 always populates `result.configFile` (with its discovery fallback string even when nothing is found), so the `resolvedConfigPath`/`configPath` fallbacks are defensive only. */
    const displayPath = result.configFile || resolvedConfigPath || configPath;
    throw new ConfigFileNotFoundError(displayPath);
  }

  validateConfig(result.config);

  /* v8 ignore next -- @preserve a successfully-loaded config always carries a truthy `result.configFile`, so the `configCwd` fallback is defensive only. */
  const loadedConfigDir = result.configFile ? dirname(result.configFile) : configCwd;
  return finalizeConfig(result.config, loadedConfigDir, getEmittedArtifactPaths);
}

function hasStringCode(error: Error): error is Error & { readonly code: string } {
  return 'code' in error && typeof error.code === 'string';
}

// Maps the loader's plain typed errors (and any incidental failure) to the
// structured `@prisma-next/errors/control` errors. Extracted from `loadConfig`
// so the full mapping is unit-testable without driving every branch through
// c12 file I/O. Not part of the package's public surface — exported only so the
// mapping has a direct unit test.
export function toStructuredConfigError(error: unknown, configPath?: string): Error {
  if (error instanceof ConfigValidationError) {
    return errorConfigValidation(error.field, {
      why: error.why,
    });
  }

  if (error instanceof ConfigFileNotFoundError) {
    return errorConfigFileNotFound(error.configPath);
  }

  // Re-throw structured errors as-is
  if (error instanceof Error && hasStringCode(error)) {
    return error;
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
      return errorConfigFileNotFound(displayPath, {
        why: error.message,
      });
    }
    // For other errors, wrap in unexpected error
    return errorUnexpected(error.message, {
      why: `Failed to load config: ${error.message}`,
    });
  }
  return errorUnexpected(String(error));
}

/**
 * Loads, validates, and finalizes the Prisma Next config, mapping every failure
 * to a structured `@prisma-next/errors/control` error (`CliStructuredError`).
 * This is the sole public entry point: callers that need to degrade gracefully
 * (e.g. the language server) branch on the structured error's stable `.code`.
 */
export async function loadConfig(configPath?: string): Promise<PrismaNextConfig> {
  try {
    return await discoverAndFinalizeConfig(configPath);
  } catch (error) {
    throw toStructuredConfigError(error, configPath);
  }
}
