import { resolve } from 'node:path';
import { loadConfig as loadConfigC12 } from 'c12';
import type { PrismaNextConfig } from './config-types';

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

    const result = await loadConfigC12<PrismaNextConfig>({
      name: 'prisma-next',
      ...(configPath ? { configFile: configPath } : {}),
      cwd,
    });

    if (!result.config) {
      const expectedPath = configPath || resolve(cwd, 'prisma-next.config.ts');
      throw new Error(
        `Config file not found at ${expectedPath}. Please create prisma-next.config.ts or specify a path with --config.`,
      );
    }

    // Validate config structure
    validateConfig(result.config);

    return result.config;
  } catch (error) {
    if (error instanceof Error) {
      // Preserve c12's error messages but provide context
      const cwd = process.cwd();
      const expectedPath = configPath || resolve(cwd, 'prisma-next.config.ts');
      // Check for file not found errors
      if (
        error.message.includes('not found') ||
        error.message.includes('Cannot find') ||
        error.message.includes('ENOENT')
      ) {
        throw new Error(
          `Config file not found at ${expectedPath}. Please create prisma-next.config.ts or specify a path with --config.`,
        );
      }
      // For other errors, include the original error message for debugging
      throw new Error(`Failed to load config: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Validates that the config has the required structure for emit command.
 */
function validateConfig(config: unknown): asserts config is PrismaNextConfig {
  if (!config || typeof config !== 'object') {
    throw new Error('Config must be an object');
  }

  const configObj = config as Record<string, unknown>;

  if (!configObj['family']) {
    throw new Error('Config must have a "family" field');
  }

  if (!configObj['target']) {
    throw new Error('Config must have a "target" field');
  }

  if (!configObj['adapter']) {
    throw new Error('Config must have an "adapter" field');
  }

  // Validate family descriptor
  const family = configObj['family'] as Record<string, unknown>;
  if (family['kind'] !== 'family') {
    throw new Error('Config.family must have kind: "family"');
  }
  if (typeof family['id'] !== 'string') {
    throw new Error('Config.family must have id: string');
  }
  if (!family['hook'] || typeof family['hook'] !== 'object') {
    throw new Error('Config.family must have hook: TargetFamilyHook');
  }
  if (typeof family['convertOperationManifest'] !== 'function') {
    throw new Error('Config.family must have convertOperationManifest: function');
  }
  if (typeof family['validateContractIR'] !== 'function') {
    throw new Error('Config.family must have validateContractIR: function');
  }

  // Validate target descriptor
  const target = configObj['target'] as Record<string, unknown>;
  if (target['kind'] !== 'target') {
    throw new Error('Config.target must have kind: "target"');
  }
  if (typeof target['id'] !== 'string') {
    throw new Error('Config.target must have id: string');
  }
  if (typeof target['family'] !== 'string') {
    throw new Error('Config.target must have family: string');
  }
  if (!target['manifest'] || typeof target['manifest'] !== 'object') {
    throw new Error('Config.target must have manifest: ExtensionPackManifest');
  }

  // Validate adapter descriptor
  const adapter = configObj['adapter'] as Record<string, unknown>;
  if (adapter['kind'] !== 'adapter') {
    throw new Error('Config.adapter must have kind: "adapter"');
  }
  if (typeof adapter['id'] !== 'string') {
    throw new Error('Config.adapter must have id: string');
  }
  if (typeof adapter['family'] !== 'string') {
    throw new Error('Config.adapter must have family: string');
  }
  if (!adapter['manifest'] || typeof adapter['manifest'] !== 'object') {
    throw new Error('Config.adapter must have manifest: ExtensionPackManifest');
  }

  // Validate extensions array if present
  if (configObj['extensions'] !== undefined) {
    if (!Array.isArray(configObj['extensions'])) {
      throw new Error('Config.extensions must be an array');
    }
    for (const ext of configObj['extensions']) {
      if (!ext || typeof ext !== 'object') {
        throw new Error('Config.extensions must contain ExtensionDescriptor objects');
      }
      const extObj = ext as Record<string, unknown>;
      if (extObj['kind'] !== 'extension') {
        throw new Error('Config.extensions items must have kind: "extension"');
      }
      if (typeof extObj['id'] !== 'string') {
        throw new Error('Config.extensions items must have id: string');
      }
      if (typeof extObj['family'] !== 'string') {
        throw new Error('Config.extensions items must have family: string');
      }
      if (!extObj['manifest'] || typeof extObj['manifest'] !== 'object') {
        throw new Error('Config.extensions items must have manifest: ExtensionPackManifest');
      }
    }
  }

  // Validate contract config if present (structure validation - defineConfig() handles normalization)
  if (configObj['contract'] !== undefined) {
    const contract = configObj['contract'] as Record<string, unknown>;
    if (!contract || typeof contract !== 'object') {
      throw new Error('Config.contract must be an object');
    }
    if (!('source' in contract)) {
      throw new Error('Config.contract.source is required when contract is provided');
    }
    if (contract['output'] !== undefined && typeof contract['output'] !== 'string') {
      throw new Error('Config.contract.output must be a string when provided');
    }
    if (contract['types'] !== undefined && typeof contract['types'] !== 'string') {
      throw new Error('Config.contract.types must be a string when provided');
    }
  }
}
