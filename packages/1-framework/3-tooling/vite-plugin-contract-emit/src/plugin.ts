import { dirname, extname, resolve } from 'node:path';
import { loadConfigWithMetadata } from '@prisma-next/cli/config-loader';
import type { ContractEmitResult } from '@prisma-next/cli/control-api';
import { executeContractEmit } from '@prisma-next/cli/control-api';
import type { Plugin, ViteDevServer } from 'vite';
import type { PrismaVitePluginOptions } from './types';

const PLUGIN_NAME = 'prisma-vite-plugin-contract-emit';
const DEFAULT_DEBOUNCE_MS = 150;
const DEFAULT_CONFIG_PATH = 'prisma-next.config.ts';
const DEFAULT_CONTRACT_OUTPUT = 'src/prisma/contract.json';
const MODULE_GRAPH_EXTENSIONS = new Set([
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
]);

/**
 * Creates a Vite plugin that automatically emits Prisma Next contract artifacts.
 *
 * The plugin watches the config file and its transitive dependencies, re-emitting
 * contract artifacts on changes with debounce and "last change wins" semantics.
 *
 * @param configPath - Path to prisma-next.config.ts (relative or absolute). Defaults to 'prisma-next.config.ts'
 * @param options - Optional plugin configuration
 * @returns Vite plugin
 *
 * @example
 * ```ts
 * import { defineConfig } from 'vite';
 * import { prismaVitePlugin } from '@prisma-next/vite-plugin-contract-emit';
 *
 * // Use default config path
 * export default defineConfig({
 *   plugins: [prismaVitePlugin()],
 * });
 *
 * // Or specify a custom path
 * export default defineConfig({
 *   plugins: [prismaVitePlugin('custom/prisma-next.config.ts')],
 * });
 * ```
 */
export function prismaVitePlugin(
  configPath: string = DEFAULT_CONFIG_PATH,
  options?: PrismaVitePluginOptions,
): Plugin {
  const debounceMs = options?.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const logLevel = options?.logLevel ?? 'info';

  let absoluteConfigPath: string;
  const watchedFiles = new Set<string>();
  const ignoredOutputFiles = new Set<string>();
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let currentAbortController: AbortController | null = null;
  let server: ViteDevServer | null = null;
  let emitRequestId = 0;

  function log(message: string, level: 'info' | 'debug' = 'info') {
    if (logLevel === 'silent') return;
    if (level === 'debug' && logLevel !== 'debug') return;
    console.log(`[${PLUGIN_NAME}] ${message}`);
  }

  function logError(message: string, error?: unknown) {
    if (logLevel === 'silent') return;
    const errorMessage = error instanceof Error ? error.message : error ? String(error) : '';
    console.error(`[${PLUGIN_NAME}] ${message}${errorMessage ? ` ${errorMessage}` : ''}`);
    if (error instanceof Error && error.stack && logLevel === 'debug') {
      console.error(error.stack);
    }
  }

  function handleTrackedFileChange(file: string) {
    if (ignoredOutputFiles.has(file)) {
      log(`Ignoring emitted artifact update: ${file}`, 'debug');
      return;
    }

    if (watchedFiles.has(file)) {
      log(`Detected change: ${file}`, 'debug');
      scheduleEmit();
    }
  }

  function resolveContractOutputFiles(
    outputPath: string | undefined,
    resolvedConfigPath: string,
  ): Set<string> {
    const configDir = dirname(resolvedConfigPath);
    const outputJsonPath = resolve(configDir, outputPath ?? DEFAULT_CONTRACT_OUTPUT);
    const outputFiles = new Set<string>([outputJsonPath]);

    if (outputJsonPath.endsWith('.json')) {
      outputFiles.add(`${outputJsonPath.slice(0, -5)}.d.ts`);
    }

    return outputFiles;
  }

  function isModuleGraphRoot(filePath: string): boolean {
    return MODULE_GRAPH_EXTENSIONS.has(extname(filePath));
  }

  async function emitContract(): Promise<ContractEmitResult | null> {
    const requestId = ++emitRequestId;

    // Cancel any in-flight emit
    if (currentAbortController) {
      currentAbortController.abort();
    }
    currentAbortController = new AbortController();
    const signal = currentAbortController.signal;

    try {
      if (server) {
        await updateWatchedFiles(server);
      }

      const result = await executeContractEmit({
        configPath: absoluteConfigPath,
        signal,
      });

      // Check if this emit is still the latest request
      if (requestId !== emitRequestId) {
        log('Emit superseded by newer request', 'debug');
        return null;
      }

      log(`Emitted contract (storageHash: ${result.storageHash.slice(0, 8)}...)`);
      log(`  → ${result.files.json}`, 'debug');
      log(`  → ${result.files.dts}`, 'debug');

      if (server) {
        server.ws.send({ type: 'full-reload' });
      }

      return result;
    } catch (error) {
      // Ignore cancellation - check signal first, then error name
      if (signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
        log('Emit cancelled', 'debug');
        return null;
      }

      // Check if this emit is still the latest request
      if (requestId !== emitRequestId) {
        return null;
      }

      logError('Contract emit failed:', error);

      // Send error to Vite overlay
      if (server) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        server.ws.send({
          type: 'error',
          err: {
            message: `[prisma-next] ${errorMessage}`,
            stack: errorStack ?? '',
            plugin: PLUGIN_NAME,
          },
        });
      }

      return null;
    }
  }

  function scheduleEmit() {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void emitContract();
    }, debounceMs);
  }

  async function collectWatchedFiles(viteServer: ViteDevServer): Promise<Set<string>> {
    const files = new Set<string>();
    const moduleGraphRoots = new Set<string>([absoluteConfigPath]);

    try {
      const { config, metadata } = await loadConfigWithMetadata(absoluteConfigPath);

      for (const outputFile of resolveContractOutputFiles(
        config.contract?.output,
        metadata.resolvedConfigPath,
      )) {
        ignoredOutputFiles.add(outputFile);
      }

      files.add(metadata.resolvedConfigPath);

      for (const warning of metadata.contractWatch?.warnings ?? []) {
        log(warning.message, 'debug');
      }

      for (const input of metadata.contractWatch?.inputs ?? []) {
        if (!ignoredOutputFiles.has(input)) {
          files.add(input);
        }
      }

      if (config.contract?.watchStrategy === 'moduleGraph') {
        for (const input of metadata.contractWatch?.inputs ?? []) {
          if (isModuleGraphRoot(input)) {
            moduleGraphRoots.add(input);
          }
        }
      }
    } catch {
      ignoredOutputFiles.clear();
    }

    try {
      // Load the config module and any declared module-graph roots through Vite's SSR loader
      // so they appear in the module graph before we crawl their dependencies.
      for (const root of moduleGraphRoots) {
        try {
          await viteServer.ssrLoadModule(root);
        } catch (error) {
          if (root === absoluteConfigPath) {
            throw error;
          }
          log(`Skipped module-graph root after load failure: ${root}`, 'debug');
        }
      }

      // Crawl the module graph starting from the config file and any authoritative TS roots
      const visited = new Set<string>();
      const queue = [...moduleGraphRoots];

      while (queue.length > 0) {
        const current = queue.shift();
        if (current === undefined || visited.has(current)) continue;
        visited.add(current);

        const mod = viteServer.moduleGraph.getModuleById(current);
        if (!mod) continue;

        // Add file to watched set if it's a file path
        if (mod.file) {
          files.add(mod.file);
        }

        // Add imported modules to queue
        for (const imported of mod.importedModules) {
          if (imported.id && !visited.has(imported.id)) {
            queue.push(imported.id);
          }
        }
      }
    } catch (error) {
      logError('Failed to collect watched files:', error);
      // At minimum, watch the config file itself
      files.add(absoluteConfigPath);
    }

    for (const ignoredFile of ignoredOutputFiles) {
      files.delete(ignoredFile);
    }

    return files;
  }

  async function updateWatchedFiles(viteServer: ViteDevServer): Promise<void> {
    ignoredOutputFiles.clear();
    const newWatchedFiles = await collectWatchedFiles(viteServer);

    // Find files to add and remove
    const toAdd: string[] = [];
    const toRemove: string[] = [];

    for (const file of newWatchedFiles) {
      if (!watchedFiles.has(file)) {
        toAdd.push(file);
      }
    }

    for (const file of watchedFiles) {
      if (!newWatchedFiles.has(file)) {
        toRemove.push(file);
      }
    }

    // Update the watcher
    for (const file of toAdd) {
      viteServer.watcher.add(file);
    }
    for (const file of toRemove) {
      viteServer.watcher.unwatch(file);
    }

    // Replace the watched files set
    watchedFiles.clear();
    for (const file of newWatchedFiles) {
      watchedFiles.add(file);
    }

    if (toAdd.length > 0 || toRemove.length > 0) {
      log(`Updated watched files: +${toAdd.length} -${toRemove.length}`, 'debug');
    }
  }

  return {
    name: PLUGIN_NAME,

    configResolved(config) {
      // Resolve config path to absolute path based on Vite root
      absoluteConfigPath = resolve(config.root, configPath);
      log(`Config path: ${absoluteConfigPath}`, 'debug');
    },

    async configureServer(viteServer) {
      server = viteServer;
      const onTrackedWatcherEvent = (file: string) => {
        handleTrackedFileChange(file);
      };

      // Register close hook to clean up timers and abort in-flight work
      const cleanup = () => {
        if (debounceTimer) {
          clearTimeout(debounceTimer);
          debounceTimer = null;
        }
        if (currentAbortController) {
          currentAbortController.abort();
          currentAbortController = null;
        }
        viteServer.watcher.off?.('change', onTrackedWatcherEvent);
        viteServer.watcher.off?.('add', onTrackedWatcherEvent);
        viteServer.watcher.off?.('unlink', onTrackedWatcherEvent);
        server = null;
        watchedFiles.clear();
        ignoredOutputFiles.clear();
        log('Server closed, cleaned up resources', 'debug');
      };

      // Register cleanup on server close via httpServer or watcher
      viteServer.httpServer?.on('close', cleanup);
      viteServer.watcher?.on?.('close', cleanup);
      viteServer.watcher.on('change', onTrackedWatcherEvent);
      viteServer.watcher.on('add', onTrackedWatcherEvent);
      viteServer.watcher.on('unlink', onTrackedWatcherEvent);

      // Collect files to watch from the module graph
      for (const file of await collectWatchedFiles(viteServer)) {
        watchedFiles.add(file);
      }

      // Add all dependency files to Vite's watcher
      for (const file of watchedFiles) {
        viteServer.watcher.add(file);
      }

      // Error if no files are being watched - this indicates a configuration problem
      if (watchedFiles.size === 0) {
        const errorMessage =
          `No files are being watched. The config file "${absoluteConfigPath}" could not be loaded ` +
          'or has no dependencies. HMR for contract changes will not work.';
        logError(errorMessage);
        viteServer.ws.send({
          type: 'error',
          err: {
            message: `[prisma-next] ${errorMessage}`,
            stack: '',
            plugin: PLUGIN_NAME,
          },
        });
      } else {
        log(`Watching ${watchedFiles.size} files`, 'debug');
        if (logLevel === 'debug') {
          for (const file of watchedFiles) {
            log(`  ${file}`, 'debug');
          }
        }
      }

      // Initial emit on server start
      await emitContract();
    },

    handleHotUpdate(ctx) {
      handleTrackedFileChange(ctx.file);
    },
  };
}
