import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Plugin } from 'esbuild';
import { build } from 'esbuild';
import type { PrismaNextConfig } from './config-types';

/**
 * Loads the Prisma Next config from a TypeScript file.
 * Supports both default export and named export.
 * Uses esbuild to bundle and compile TypeScript files.
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

  const fileName = resolvedPath.split('/').pop() || '';
  const isPrismaNextConfig = fileName.startsWith('prisma-next.config.');
  if (!configPath && !isPrismaNextConfig) {
    throw new Error('Config file must be named prisma-next.config.ts (or .js/.mjs)');
  }

  // If the file is already a .js or .mjs file, import it directly
  if (resolvedPath.endsWith('.js') || resolvedPath.endsWith('.mjs')) {
    try {
      const configUrl = pathToFileURL(resolvedPath).href;
      const configModule = await import(configUrl);
      const config = configModule.default ?? configModule.config ?? configModule;
      if (!config) {
        throw new Error(
          `Config file at ${resolvedPath} must export a default export or named export 'config'.`,
        );
      }
      validateConfig(config);
      return config as PrismaNextConfig;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to load config from ${resolvedPath}: ${error.message}`);
      }
      throw error;
    }
  }

  // For TypeScript files, use esbuild to bundle and compile
  const tempFile = join(
    tmpdir(),
    `prisma-next-config-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`,
  );

  // Plugin to mark absolute file paths as external (but not the entry point)
  const externalAbsolutePathsPlugin: Plugin = {
    name: 'external-absolute-paths',
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        // Don't mark the entry point as external
        if (args.kind === 'entry-point') {
          return undefined;
        }
        // Mark absolute paths (starting with /) as external
        if (args.path.startsWith('/')) {
          return {
            path: args.path,
            external: true,
          };
        }
        return undefined;
      });
    },
  };

  try {
    const result = await build({
      entryPoints: [resolvedPath],
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'es2022',
      outfile: tempFile,
      write: false,
      logLevel: 'error',
      // Keep package imports external - they'll be resolved at runtime
      packages: 'external',
      plugins: [externalAbsolutePathsPlugin],
    });

    if (result.errors.length > 0) {
      const errorMessages = result.errors.map((e: { text: string }) => e.text).join('\n');
      throw new Error(`Failed to bundle config file: ${errorMessages}`);
    }

    if (!result.outputFiles || result.outputFiles.length === 0) {
      throw new Error('No output files generated from bundling');
    }

    const bundleContent = result.outputFiles[0]?.text;
    if (bundleContent === undefined) {
      throw new Error('Bundle content is undefined');
    }
    writeFileSync(tempFile, bundleContent, 'utf-8');

    const configUrl = pathToFileURL(tempFile).href;
    const configModule = await import(configUrl);
    unlinkSync(tempFile);

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
    // Clean up temp file on error
    if (existsSync(tempFile)) {
      try {
        unlinkSync(tempFile);
      } catch {
        // Ignore cleanup errors
      }
    }
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
