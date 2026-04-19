import { type LoadedConfigResult, loadConfigWithMetadata } from '@prisma-next/cli/config-loader';
import { executeContractEmit } from '@prisma-next/cli/control-api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prismaVitePlugin } from '../src/plugin';

vi.mock('@prisma-next/cli/control-api', () => ({
  executeContractEmit: vi.fn(),
}));

vi.mock('@prisma-next/cli/config-loader', () => ({
  loadConfigWithMetadata: vi.fn(),
}));

const mockedExecuteContractEmit = vi.mocked(executeContractEmit);
const mockedLoadConfigWithMetadata = vi.mocked(loadConfigWithMetadata);

interface MockModuleNode {
  readonly id: string;
  readonly file: string;
  readonly importedModules: Set<MockModuleNode>;
}

type LoadedContractConfig = NonNullable<LoadedConfigResult['config']['contract']>;

const unusedContractSource: LoadedContractConfig['source'] = async () => {
  throw new Error('unused in tests');
};

function createLoadedConfigResult({
  output = 'output/contract.json',
  watchInputs = [],
}: {
  output?: string;
  watchInputs?: readonly string[];
} = {}): LoadedConfigResult {
  return {
    config: {
      family: {} as LoadedConfigResult['config']['family'],
      target: {} as LoadedConfigResult['config']['target'],
      adapter: {} as LoadedConfigResult['config']['adapter'],
      contract: {
        source: unusedContractSource,
        output,
      },
    },
    metadata: {
      resolvedConfigPath: '/project/prisma-next.config.ts',
      contractWatch: {
        inputs: [...watchInputs],
        warnings: [],
      },
    },
  };
}

function applyModuleGraph(
  server: ReturnType<typeof createMockServer>,
  definitions: Record<string, { file?: string; imports?: readonly string[] }>,
) {
  const modules = new Map<string, MockModuleNode>();

  for (const [id, definition] of Object.entries(definitions)) {
    modules.set(id, {
      id,
      file: definition.file ?? id,
      importedModules: new Set(),
    });
  }

  for (const [id, definition] of Object.entries(definitions)) {
    const module = modules.get(id);
    if (!module) continue;
    for (const importedId of definition.imports ?? []) {
      const importedModule = modules.get(importedId);
      if (importedModule) {
        module.importedModules.add(importedModule);
      }
    }
  }

  server.moduleGraph.getModuleById.mockImplementation((id: string) => modules.get(id) ?? null);
}

function createMockServer() {
  return {
    httpServer: {
      on: vi.fn(),
    },
    watcher: {
      add: vi.fn(),
      unwatch: vi.fn(),
      on: vi.fn(),
    },
    ws: {
      send: vi.fn(),
    },
    ssrLoadModule: vi.fn().mockResolvedValue({}),
    moduleGraph: {
      getModuleById: vi.fn().mockReturnValue(null),
    },
  };
}

describe('prismaVitePlugin', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockedExecuteContractEmit.mockReset();
    mockedExecuteContractEmit.mockResolvedValue({
      storageHash: 'abc123',
      profileHash: 'def456',
      files: { json: '/out/contract.json', dts: '/out/contract.d.ts' },
    });
    mockedLoadConfigWithMetadata.mockReset();
    mockedLoadConfigWithMetadata.mockResolvedValue(createLoadedConfigResult());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns a Vite plugin with the correct name', () => {
    const plugin = prismaVitePlugin('prisma-next.config.ts');

    expect(plugin.name).toBe('prisma-vite-plugin-contract-emit');
  });

  it('accepts optional configuration', () => {
    const plugin = prismaVitePlugin('prisma-next.config.ts', {
      debounceMs: 500,
      logLevel: 'silent',
    });

    expect(plugin.name).toBe('prisma-vite-plugin-contract-emit');
  });

  it('has configResolved hook', () => {
    const plugin = prismaVitePlugin('prisma-next.config.ts');

    expect(typeof plugin.configResolved).toBe('function');
  });

  it('has configureServer hook', () => {
    const plugin = prismaVitePlugin('prisma-next.config.ts');

    expect(typeof plugin.configureServer).toBe('function');
  });

  it('has handleHotUpdate hook', () => {
    const plugin = prismaVitePlugin('prisma-next.config.ts');

    expect(typeof plugin.handleHotUpdate).toBe('function');
  });

  describe('configResolved', () => {
    it('resolves config path relative to vite root', async () => {
      const plugin = prismaVitePlugin('prisma-next.config.ts', { logLevel: 'silent' });
      const mockServer = createMockServer();

      const configResolved = plugin.configResolved as unknown as (config: { root: string }) => void;
      configResolved({ root: '/project' });

      const configureServer = plugin.configureServer as unknown as (
        server: ReturnType<typeof createMockServer>,
      ) => Promise<void>;
      await configureServer(mockServer);

      expect(mockedExecuteContractEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          configPath: '/project/prisma-next.config.ts',
        }),
      );
    });

    it('preserves absolute config path', async () => {
      const plugin = prismaVitePlugin('/absolute/prisma-next.config.ts', { logLevel: 'silent' });
      const mockServer = createMockServer();

      const configResolved = plugin.configResolved as unknown as (config: { root: string }) => void;
      configResolved({ root: '/project' });

      const configureServer = plugin.configureServer as unknown as (
        server: ReturnType<typeof createMockServer>,
      ) => Promise<void>;
      await configureServer(mockServer);

      expect(mockedExecuteContractEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          configPath: '/absolute/prisma-next.config.ts',
        }),
      );
    });
  });

  describe('configureServer', () => {
    it('registers file watchers on server', async () => {
      const plugin = prismaVitePlugin('prisma-next.config.ts', { logLevel: 'silent' });
      const mockServer = createMockServer();

      const configResolved = plugin.configResolved as unknown as (config: { root: string }) => void;
      configResolved({ root: '/project' });

      const configureServer = plugin.configureServer as unknown as (
        server: ReturnType<typeof createMockServer>,
      ) => Promise<void>;
      await configureServer(mockServer);

      expect(mockServer.ssrLoadModule).toHaveBeenCalled();
    });

    it('merges authoritative watch inputs with config module dependencies', async () => {
      mockedLoadConfigWithMetadata.mockResolvedValue(
        createLoadedConfigResult({
          watchInputs: ['/project/prisma/contract.prisma'],
        }),
      );

      const plugin = prismaVitePlugin('prisma-next.config.ts', { logLevel: 'silent' });
      const mockServer = createMockServer();

      applyModuleGraph(mockServer, {
        '/project/prisma-next.config.ts': {
          imports: ['/project/config-shared.ts'],
        },
        '/project/config-shared.ts': {},
      });

      const configResolved = plugin.configResolved as unknown as (config: { root: string }) => void;
      configResolved({ root: '/project' });

      const configureServer = plugin.configureServer as unknown as (
        server: ReturnType<typeof createMockServer>,
      ) => Promise<void>;
      await configureServer(mockServer);

      expect(mockServer.watcher.add).toHaveBeenCalledWith('/project/prisma-next.config.ts');
      expect(mockServer.watcher.add).toHaveBeenCalledWith('/project/config-shared.ts');
      expect(mockServer.watcher.add).toHaveBeenCalledWith('/project/prisma/contract.prisma');
      expect(mockServer.watcher.add).not.toHaveBeenCalledWith('/project/output/contract.json');
      expect(mockServer.watcher.add).not.toHaveBeenCalledWith('/project/output/contract.d.ts');
    });

    it('triggers initial emit on server start', async () => {
      const plugin = prismaVitePlugin('prisma-next.config.ts', { logLevel: 'silent' });
      const mockServer = createMockServer();

      const configResolved = plugin.configResolved as unknown as (config: { root: string }) => void;
      configResolved({ root: '/project' });

      const configureServer = plugin.configureServer as unknown as (
        server: ReturnType<typeof createMockServer>,
      ) => Promise<void>;
      await configureServer(mockServer);

      expect(mockedExecuteContractEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          configPath: expect.stringContaining('prisma-next.config.ts'),
        }),
      );
    });

    it('registers cleanup hooks for server close', async () => {
      const plugin = prismaVitePlugin('prisma-next.config.ts', { logLevel: 'silent' });
      const mockServer = createMockServer();

      const configResolved = plugin.configResolved as unknown as (config: { root: string }) => void;
      configResolved({ root: '/project' });

      const configureServer = plugin.configureServer as unknown as (
        server: ReturnType<typeof createMockServer>,
      ) => Promise<void>;
      await configureServer(mockServer);

      // Verify cleanup hooks were registered
      expect(mockServer.httpServer.on).toHaveBeenCalledWith('close', expect.any(Function));
      expect(mockServer.watcher.on).toHaveBeenCalledWith('close', expect.any(Function));
    });

    it('shows error overlay when no files are being watched', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      mockedLoadConfigWithMetadata.mockRejectedValue(new Error('config load failed'));

      const plugin = prismaVitePlugin('prisma-next.config.ts', { logLevel: 'info' });
      const mockServer = createMockServer();

      // Module graph returns null, so no files will be collected
      mockServer.moduleGraph.getModuleById.mockReturnValue(null);

      const configResolved = plugin.configResolved as unknown as (config: { root: string }) => void;
      configResolved({ root: '/project' });

      const configureServer = plugin.configureServer as unknown as (
        server: ReturnType<typeof createMockServer>,
      ) => Promise<void>;
      await configureServer(mockServer);

      // Should send error to Vite overlay
      expect(mockServer.ws.send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
          err: expect.objectContaining({
            message: expect.stringContaining('No files are being watched'),
          }),
        }),
      );
    });
  });

  describe('handleHotUpdate', () => {
    it('does not throw when called with untracked file', () => {
      const plugin = prismaVitePlugin('prisma-next.config.ts', { logLevel: 'silent' });

      const configResolved = plugin.configResolved as unknown as (config: { root: string }) => void;
      configResolved({ root: '/project' });

      const handleHotUpdate = plugin.handleHotUpdate as unknown as (ctx: { file: string }) => void;
      expect(() => handleHotUpdate({ file: '/unrelated/file.ts' })).not.toThrow();
    });

    it('triggers debounced emit for tracked file changes', async () => {
      const plugin = prismaVitePlugin('prisma-next.config.ts', {
        logLevel: 'silent',
        debounceMs: 100,
      });
      const mockServer = createMockServer();

      mockServer.moduleGraph.getModuleById.mockReturnValue({
        file: '/project/prisma-next.config.ts',
        importedModules: [],
      });

      const configResolved = plugin.configResolved as unknown as (config: { root: string }) => void;
      configResolved({ root: '/project' });

      const configureServer = plugin.configureServer as unknown as (
        server: ReturnType<typeof createMockServer>,
      ) => Promise<void>;
      await configureServer(mockServer);

      mockedExecuteContractEmit.mockClear();

      const handleHotUpdate = plugin.handleHotUpdate as unknown as (ctx: { file: string }) => void;
      handleHotUpdate({ file: '/project/prisma-next.config.ts' });

      expect(mockedExecuteContractEmit).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(100);

      expect(mockedExecuteContractEmit).toHaveBeenCalled();
    });

    it('debounces rapid successive changes', async () => {
      const plugin = prismaVitePlugin('prisma-next.config.ts', {
        logLevel: 'silent',
        debounceMs: 100,
      });
      const mockServer = createMockServer();

      mockServer.moduleGraph.getModuleById.mockReturnValue({
        file: '/project/prisma-next.config.ts',
        importedModules: [],
      });

      const configResolved = plugin.configResolved as unknown as (config: { root: string }) => void;
      configResolved({ root: '/project' });

      const configureServer = plugin.configureServer as unknown as (
        server: ReturnType<typeof createMockServer>,
      ) => Promise<void>;
      await configureServer(mockServer);

      mockedExecuteContractEmit.mockClear();

      const handleHotUpdate = plugin.handleHotUpdate as unknown as (ctx: { file: string }) => void;

      handleHotUpdate({ file: '/project/prisma-next.config.ts' });
      await vi.advanceTimersByTimeAsync(50);
      handleHotUpdate({ file: '/project/prisma-next.config.ts' });
      await vi.advanceTimersByTimeAsync(50);
      handleHotUpdate({ file: '/project/prisma-next.config.ts' });
      await vi.advanceTimersByTimeAsync(100);

      expect(mockedExecuteContractEmit).toHaveBeenCalledTimes(1);
    });

    it('refreshes watched files when config dependencies and authoritative inputs change', async () => {
      let currentConfig = createLoadedConfigResult({
        watchInputs: ['/project/prisma/contract.prisma'],
      });
      mockedLoadConfigWithMetadata.mockImplementation(async () => currentConfig);

      const plugin = prismaVitePlugin('prisma-next.config.ts', {
        logLevel: 'silent',
        debounceMs: 100,
      });
      const mockServer = createMockServer();

      applyModuleGraph(mockServer, {
        '/project/prisma-next.config.ts': {
          imports: ['/project/config-shared-a.ts'],
        },
        '/project/config-shared-a.ts': {},
      });

      const configResolved = plugin.configResolved as unknown as (config: { root: string }) => void;
      configResolved({ root: '/project' });

      const configureServer = plugin.configureServer as unknown as (
        server: ReturnType<typeof createMockServer>,
      ) => Promise<void>;
      await configureServer(mockServer);

      mockedExecuteContractEmit.mockClear();
      mockServer.watcher.add.mockClear();
      mockServer.watcher.unwatch.mockClear();

      currentConfig = createLoadedConfigResult({
        watchInputs: ['/project/prisma/contract-alt.prisma'],
      });
      applyModuleGraph(mockServer, {
        '/project/prisma-next.config.ts': {
          imports: ['/project/config-shared-b.ts'],
        },
        '/project/config-shared-b.ts': {},
      });

      const handleHotUpdate = plugin.handleHotUpdate as unknown as (ctx: { file: string }) => void;
      handleHotUpdate({ file: '/project/prisma-next.config.ts' });
      await vi.advanceTimersByTimeAsync(100);

      expect(mockedExecuteContractEmit).toHaveBeenCalledTimes(1);
      expect(mockServer.watcher.add).toHaveBeenCalledWith('/project/config-shared-b.ts');
      expect(mockServer.watcher.add).toHaveBeenCalledWith('/project/prisma/contract-alt.prisma');
      expect(mockServer.watcher.unwatch).toHaveBeenCalledWith('/project/config-shared-a.ts');
      expect(mockServer.watcher.unwatch).toHaveBeenCalledWith('/project/prisma/contract.prisma');
    });

    it('ignores emitted artifact updates', async () => {
      mockedLoadConfigWithMetadata.mockResolvedValue(
        createLoadedConfigResult({
          watchInputs: ['/project/prisma/contract.prisma'],
        }),
      );

      const plugin = prismaVitePlugin('prisma-next.config.ts', {
        logLevel: 'silent',
        debounceMs: 100,
      });
      const mockServer = createMockServer();

      applyModuleGraph(mockServer, {
        '/project/prisma-next.config.ts': {},
      });

      const configResolved = plugin.configResolved as unknown as (config: { root: string }) => void;
      configResolved({ root: '/project' });

      const configureServer = plugin.configureServer as unknown as (
        server: ReturnType<typeof createMockServer>,
      ) => Promise<void>;
      await configureServer(mockServer);

      mockedExecuteContractEmit.mockClear();

      const handleHotUpdate = plugin.handleHotUpdate as unknown as (ctx: { file: string }) => void;
      handleHotUpdate({ file: '/project/output/contract.json' });
      handleHotUpdate({ file: '/project/output/contract.d.ts' });
      await vi.advanceTimersByTimeAsync(100);

      expect(mockedExecuteContractEmit).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('logs error when emit fails', async () => {
      mockedExecuteContractEmit.mockRejectedValue(new Error('Emit failed'));

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const plugin = prismaVitePlugin('prisma-next.config.ts', { logLevel: 'info' });
      const mockServer = createMockServer();

      const configResolved = plugin.configResolved as unknown as (config: { root: string }) => void;
      configResolved({ root: '/project' });

      const configureServer = plugin.configureServer as unknown as (
        server: ReturnType<typeof createMockServer>,
      ) => Promise<void>;
      await configureServer(mockServer);

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Contract emit failed'));

      consoleErrorSpy.mockRestore();
    });

    it('sends error to Vite overlay on failure', async () => {
      mockedExecuteContractEmit.mockRejectedValue(new Error('Something broke'));

      vi.spyOn(console, 'error').mockImplementation(() => {});

      const plugin = prismaVitePlugin('prisma-next.config.ts', { logLevel: 'silent' });
      const mockServer = createMockServer();

      const configResolved = plugin.configResolved as unknown as (config: { root: string }) => void;
      configResolved({ root: '/project' });

      const configureServer = plugin.configureServer as unknown as (
        server: ReturnType<typeof createMockServer>,
      ) => Promise<void>;
      await configureServer(mockServer);

      expect(mockServer.ws.send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
          err: expect.objectContaining({
            message: expect.stringContaining('Something broke'),
          }),
        }),
      );
    });

    it('silently ignores cancellation errors', async () => {
      // Use standard AbortError (DOMException with name 'AbortError')
      mockedExecuteContractEmit.mockRejectedValue(
        new DOMException('The operation was aborted', 'AbortError'),
      );

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const plugin = prismaVitePlugin('prisma-next.config.ts', { logLevel: 'info' });
      const mockServer = createMockServer();

      const configResolved = plugin.configResolved as unknown as (config: { root: string }) => void;
      configResolved({ root: '/project' });

      const configureServer = plugin.configureServer as unknown as (
        server: ReturnType<typeof createMockServer>,
      ) => Promise<void>;
      await configureServer(mockServer);

      expect(consoleErrorSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('Contract emit failed'),
      );

      consoleErrorSpy.mockRestore();
    });
  });
});
