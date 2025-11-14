import { dirname, resolve } from 'node:path';
import { loadConfig as loadConfigC12 } from 'c12';
import type { PrismaNextConfig } from './config-types';
import {
  errorConfigFileNotFound,
  errorConfigValidation,
  errorUnexpected,
} from './utils/cli-errors';

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
 * Validates that the config has the required structure for emit command.
 */
function validateConfig(config: unknown): asserts config is PrismaNextConfig {
  if (!config || typeof config !== 'object') {
    throw errorConfigValidation('object', {
      why: 'Config must be an object',
    });
  }

  const configObj = config as Record<string, unknown>;

  if (!configObj['family']) {
    throw errorConfigValidation('family');
  }

  if (!configObj['target']) {
    throw errorConfigValidation('target');
  }

  if (!configObj['adapter']) {
    throw errorConfigValidation('adapter');
  }

  // Validate family descriptor
  const family = configObj['family'] as Record<string, unknown>;
  if (family['kind'] !== 'family') {
    throw errorConfigValidation('family.kind', {
      why: 'Config.family must have kind: "family"',
    });
  }
  if (typeof family['id'] !== 'string') {
    throw errorConfigValidation('family.id', {
      why: 'Config.family must have id: string',
    });
  }
  if (!family['hook'] || typeof family['hook'] !== 'object') {
    throw errorConfigValidation('family.hook', {
      why: 'Config.family must have hook: TargetFamilyHook',
    });
  }
  if (typeof family['convertOperationManifest'] !== 'function') {
    throw errorConfigValidation('family.convertOperationManifest', {
      why: 'Config.family must have convertOperationManifest: function',
    });
  }
  if (typeof family['validateContractIR'] !== 'function') {
    throw errorConfigValidation('family.validateContractIR', {
      why: 'Config.family must have validateContractIR: function',
    });
  }

  // Validate target descriptor
  const target = configObj['target'] as Record<string, unknown>;
  if (target['kind'] !== 'target') {
    throw errorConfigValidation('target.kind', {
      why: 'Config.target must have kind: "target"',
    });
  }
  if (typeof target['id'] !== 'string') {
    throw errorConfigValidation('target.id', {
      why: 'Config.target must have id: string',
    });
  }
  if (typeof target['family'] !== 'string') {
    throw errorConfigValidation('target.family', {
      why: 'Config.target must have family: string',
    });
  }
  if (!target['manifest'] || typeof target['manifest'] !== 'object') {
    throw errorConfigValidation('target.manifest', {
      why: 'Config.target must have manifest: ExtensionPackManifest',
    });
  }

  // Validate adapter descriptor
  const adapter = configObj['adapter'] as Record<string, unknown>;
  if (adapter['kind'] !== 'adapter') {
    throw errorConfigValidation('adapter.kind', {
      why: 'Config.adapter must have kind: "adapter"',
    });
  }
  if (typeof adapter['id'] !== 'string') {
    throw errorConfigValidation('adapter.id', {
      why: 'Config.adapter must have id: string',
    });
  }
  if (typeof adapter['family'] !== 'string') {
    throw errorConfigValidation('adapter.family', {
      why: 'Config.adapter must have family: string',
    });
  }
  if (!adapter['manifest'] || typeof adapter['manifest'] !== 'object') {
    throw errorConfigValidation('adapter.manifest', {
      why: 'Config.adapter must have manifest: ExtensionPackManifest',
    });
  }

  // Validate extensions array if present
  if (configObj['extensions'] !== undefined) {
    if (!Array.isArray(configObj['extensions'])) {
      throw errorConfigValidation('extensions', {
        why: 'Config.extensions must be an array',
      });
    }
    for (const ext of configObj['extensions']) {
      if (!ext || typeof ext !== 'object') {
        throw errorConfigValidation('extensions[]', {
          why: 'Config.extensions must contain ExtensionDescriptor objects',
        });
      }
      const extObj = ext as Record<string, unknown>;
      if (extObj['kind'] !== 'extension') {
        throw errorConfigValidation('extensions[].kind', {
          why: 'Config.extensions items must have kind: "extension"',
        });
      }
      if (typeof extObj['id'] !== 'string') {
        throw errorConfigValidation('extensions[].id', {
          why: 'Config.extensions items must have id: string',
        });
      }
      if (typeof extObj['family'] !== 'string') {
        throw errorConfigValidation('extensions[].family', {
          why: 'Config.extensions items must have family: string',
        });
      }
      if (!extObj['manifest'] || typeof extObj['manifest'] !== 'object') {
        throw errorConfigValidation('extensions[].manifest', {
          why: 'Config.extensions items must have manifest: ExtensionPackManifest',
        });
      }
    }
  }

  // Validate driver descriptor if present
  if (configObj['driver'] !== undefined) {
    const driver = configObj['driver'] as Record<string, unknown>;
    if (driver['kind'] !== 'driver') {
      throw errorConfigValidation('driver.kind', {
        why: 'Config.driver must have kind: "driver"',
      });
    }
    if (typeof driver['id'] !== 'string') {
      throw errorConfigValidation('driver.id', {
        why: 'Config.driver must have id: string',
      });
    }
    if (typeof driver['family'] !== 'string') {
      throw errorConfigValidation('driver.family', {
        why: 'Config.driver must have family: string',
      });
    }
    if (!driver['manifest'] || typeof driver['manifest'] !== 'object') {
      throw errorConfigValidation('driver.manifest', {
        why: 'Config.driver must have manifest: ExtensionPackManifest',
      });
    }
    if (typeof driver['create'] !== 'function') {
      throw errorConfigValidation('driver.create', {
        why: 'Config.driver must have create: function',
      });
    }
  }

  // Validate contract config if present (structure validation - defineConfig() handles normalization)
  if (configObj['contract'] !== undefined) {
    const contract = configObj['contract'] as Record<string, unknown>;
    if (!contract || typeof contract !== 'object') {
      throw errorConfigValidation('contract', {
        why: 'Config.contract must be an object',
      });
    }
    if (!('source' in contract)) {
      throw errorConfigValidation('contract.source', {
        why: 'Config.contract.source is required when contract is provided',
      });
    }
    if (contract['output'] !== undefined && typeof contract['output'] !== 'string') {
      throw errorConfigValidation('contract.output', {
        why: 'Config.contract.output must be a string when provided',
      });
    }
    if (contract['types'] !== undefined && typeof contract['types'] !== 'string') {
      throw errorConfigValidation('contract.types', {
        why: 'Config.contract.types must be a string when provided',
      });
    }
  }
}
