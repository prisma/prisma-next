import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { PrismaNextConfig } from './config-types';

/**
 * Loads the Prisma Next config from a TypeScript file.
 * Supports both default export and named export.
 *
 * @param configPath - Optional path to config file. Defaults to `./prisma-next.config.ts` in current directory.
 * @returns The loaded config object.
 * @throws Error if config file doesn't exist or is invalid.
 */
export async function loadConfig(configPath?: string): Promise<PrismaNextConfig> {
  const resolvedPath = configPath
    ? resolve(configPath)
    : resolve(process.cwd(), 'prisma-next.config.ts');

  if (!existsSync(resolvedPath)) {
    throw new Error(
      `Config file not found at ${resolvedPath}. Please create prisma-next.config.ts or specify a path with --config.`,
    );
  }

  try {
    // Use file:// URL for ESM import
    const configUrl = pathToFileURL(resolvedPath).href;
    const configModule = await import(configUrl);

    // Support both default export and named export
    const config = configModule.default ?? configModule.config ?? configModule;

    if (!config) {
      throw new Error(
        `Config file at ${resolvedPath} must export a default export or named export 'config'.`,
      );
    }

    // Validate config structure
    validateConfig(config);

    return config as PrismaNextConfig;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to load config from ${resolvedPath}: ${error.message}`);
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
  if (typeof family['assembleOperationRegistry'] !== 'function') {
    throw new Error('Config.family must have assembleOperationRegistry: function');
  }
  if (typeof family['extractCodecTypeImports'] !== 'function') {
    throw new Error('Config.family must have extractCodecTypeImports: function');
  }
  if (typeof family['extractOperationTypeImports'] !== 'function') {
    throw new Error('Config.family must have extractOperationTypeImports: function');
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
}
