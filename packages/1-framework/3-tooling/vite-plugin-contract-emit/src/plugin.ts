import { resolve } from 'node:path';
import type { ContractEmitResult } from '@prisma-next/cli/control-api';
import { ContractEmitCancelledError, executeContractEmit } from '@prisma-next/cli/control-api';
import type { Plugin, ViteDevServer } from 'vite';
import type { PrismaVitePluginOptions } from './types';

const PLUGIN_NAME = 'prisma-vite-plugin-contract-emit';
const DEFAULT_DEBOUNCE_MS = 150;
const DEFAULT_CONFIG_PATH = 'prisma-next.config.ts';

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
  let watchedFiles = new Set<string>();
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

  async function emitContract(): Promise<ContractEmitResult | null> {
    const requestId = ++emitRequestId;

    // Cancel any in-flight emit
    if (currentAbortController) {
      currentAbortController.abort();
    }
    currentAbortController = new AbortController();
    const signal = currentAbortController.signal;

    try {
      const result = await executeContractEmit({
        configPath: absoluteConfigPath,
        signal,
      });

      // Check if this emit is still the latest request
      if (requestId !== emitRequestId) {
        log('Emit superseded by newer request', 'debug');
        return null;
      }

      log(`Emitted contract (coreHash: ${result.coreHash.slice(0, 8)}...)`);
      log(`  → ${result.files.json}`, 'debug');
      log(`  → ${result.files.dts}`, 'debug');

      // Update watched files to include any new transitive dependencies
      if (server) {
        await updateWatchedFiles(server);
        server.ws.send({ type: 'full-reload' });
      }

      return result;
    } catch (error) {
      // Ignore cancellation - check signal first, then error types
      if (
        signal.aborted ||
        error instanceof ContractEmitCancelledError ||
        (error instanceof Error && error.name === 'AbortError')
      ) {
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

    try {
      // Load the config module through Vite's SSR loader to populate the module graph
      await viteServer.ssrLoadModule(absoluteConfigPath);

      // Crawl the module graph starting from the config file
      const visited = new Set<string>();
      const queue = [absoluteConfigPath];

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

    return files;
  }

  async function updateWatchedFiles(viteServer: ViteDevServer): Promise<void> {
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
    watchedFiles = newWatchedFiles;

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
        server = null;
        watchedFiles = new Set<string>();
        log('Server closed, cleaned up resources', 'debug');
      };

      // Register cleanup on server close via httpServer or watcher
      viteServer.httpServer?.on('close', cleanup);
      viteServer.watcher?.on?.('close', cleanup);

      // Collect files to watch from the module graph
      watchedFiles = await collectWatchedFiles(viteServer);

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
      // Check if the changed file is one we're watching
      if (watchedFiles.has(ctx.file)) {
        log(`Detected change: ${ctx.file}`, 'debug');
        scheduleEmit();
      }
    },
  };
}
