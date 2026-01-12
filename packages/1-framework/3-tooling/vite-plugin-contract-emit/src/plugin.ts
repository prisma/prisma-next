import { resolve } from 'node:path';
import type { ContractEmitResult } from '@prisma-next/cli/control-api';
import { executeContractEmit } from '@prisma-next/cli/control-api';
import type { Plugin, ViteDevServer } from 'vite';
import type { PrismaVitePluginOptions } from './types';

const PLUGIN_NAME = 'prisma-vite-plugin-contract-emit';
const DEFAULT_DEBOUNCE_MS = 150;

/**
 * Creates a Vite plugin that automatically emits Prisma Next contract artifacts.
 *
 * The plugin watches the config file and its transitive dependencies, re-emitting
 * contract artifacts on changes with debounce and "last change wins" semantics.
 *
 * @param configPath - Path to prisma-next.config.ts (relative or absolute)
 * @param options - Optional plugin configuration
 * @returns Vite plugin
 *
 * @example
 * ```ts
 * import { defineConfig } from 'vite';
 * import { prismaVitePlugin } from '@prisma-next/vite-plugin-contract-emit';
 *
 * export default defineConfig({
 *   plugins: [prismaVitePlugin('prisma-next.config.ts')],
 * });
 * ```
 */
export function prismaVitePlugin(configPath: string, options?: PrismaVitePluginOptions): Plugin {
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

      // Clear any error overlay on success
      if (server) {
        server.ws.send({ type: 'full-reload' });
      }

      return result;
    } catch (error) {
      // Ignore cancellation errors
      if (error instanceof Error && error.message.includes('cancelled')) {
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

  return {
    name: PLUGIN_NAME,

    configResolved(config) {
      // Resolve config path to absolute path based on Vite root
      absoluteConfigPath = resolve(config.root, configPath);
      log(`Config path: ${absoluteConfigPath}`, 'debug');
    },

    async configureServer(viteServer) {
      server = viteServer;

      // Collect files to watch from the module graph
      watchedFiles = await collectWatchedFiles(viteServer);

      // Add all dependency files to Vite's watcher
      for (const file of watchedFiles) {
        viteServer.watcher.add(file);
      }

      log(`Watching ${watchedFiles.size} files`, 'debug');
      if (logLevel === 'debug') {
        for (const file of watchedFiles) {
          log(`  ${file}`, 'debug');
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
