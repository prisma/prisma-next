import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prismaVitePlugin } from '../src/plugin';

vi.mock('@prisma-next/cli/control-api', () => ({
  executeContractEmit: vi.fn(),
}));

vi.mock('@prisma-next/cli/config-loader', () => ({
  loadConfig: vi.fn(),
}));

async function mockLoadedConfig(
  authoritativeInputs:
    | { kind: 'moduleGraph' }
    | { kind: 'configPathOnly' }
    | { kind: 'paths'; paths: string[] } = { kind: 'moduleGraph' },
  output = 'src/prisma/contract.json',
) {
  const { loadConfig } = await import('@prisma-next/cli/config-loader');
  vi.mocked(loadConfig).mockResolvedValue({
    contract: {
      source: {
        authoritativeInputs,
        load: async () => ({ ok: true, value: {} }),
      },
      output,
    },
  } as never);
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
  beforeEach(async () => {
    vi.useFakeTimers();
    await mockLoadedConfig();
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
      const { executeContractEmit } = await import('@prisma-next/cli/control-api');
      const mockExecute = vi.mocked(executeContractEmit);
      mockExecute.mockResolvedValue({
        storageHash: 'abc123',
        profileHash: 'def456',
        files: { json: '/out/contract.json', dts: '/out/contract.d.ts' },
      });

      const plugin = prismaVitePlugin('prisma-next.config.ts', { logLevel: 'silent' });
      const mockServer = createMockServer();

      const configResolved = plugin.configResolved as unknown as (config: { root: string }) => void;
      configResolved({ root: '/project' });

      const configureServer = plugin.configureServer as unknown as (
        server: ReturnType<typeof createMockServer>,
      ) => Promise<void>;
      await configureServer(mockServer);

      expect(mockExecute).toHaveBeenCalledWith(
        expect.objectContaining({
          configPath: '/project/prisma-next.config.ts',
        }),
      );
    });

    it('preserves absolute config path', async () => {
      const { executeContractEmit } = await import('@prisma-next/cli/control-api');
      const mockExecute = vi.mocked(executeContractEmit);
      mockExecute.mockResolvedValue({
        storageHash: 'abc123',
        profileHash: 'def456',
        files: { json: '/out/contract.json', dts: '/out/contract.d.ts' },
      });

      const plugin = prismaVitePlugin('/absolute/prisma-next.config.ts', { logLevel: 'silent' });
      const mockServer = createMockServer();

      const configResolved = plugin.configResolved as unknown as (config: { root: string }) => void;
      configResolved({ root: '/project' });

      const configureServer = plugin.configureServer as unknown as (
        server: ReturnType<typeof createMockServer>,
      ) => Promise<void>;
      await configureServer(mockServer);

      expect(mockExecute).toHaveBeenCalledWith(
        expect.objectContaining({
          configPath: '/absolute/prisma-next.config.ts',
        }),
      );
    });
  });

  describe('configureServer', () => {
    it('registers file watchers from the module graph when provider declares moduleGraph', async () => {
      const { executeContractEmit } = await import('@prisma-next/cli/control-api');
      const mockExecute = vi.mocked(executeContractEmit);
      mockExecute.mockResolvedValue({
        storageHash: 'abc123',
        profileHash: 'def456',
        files: { json: '/out/contract.json', dts: '/out/contract.d.ts' },
      });
      await mockLoadedConfig({ kind: 'moduleGraph' });

      const plugin = prismaVitePlugin('prisma-next.config.ts', { logLevel: 'silent' });
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

      expect(mockServer.ssrLoadModule).toHaveBeenCalled();
    });

    it('registers explicit provider paths and filters emitted artifacts', async () => {
      const { executeContractEmit } = await import('@prisma-next/cli/control-api');
      const mockExecute = vi.mocked(executeContractEmit);
      mockExecute.mockResolvedValue({
        storageHash: 'abc123',
        profileHash: 'def456',
        files: { json: '/out/contract.json', dts: '/out/contract.d.ts' },
      });
      await mockLoadedConfig(
        {
          kind: 'paths',
          paths: [
            './prisma/schema.prisma',
            './src/prisma/contract.json',
            './src/prisma/contract.d.ts',
          ],
        },
        'src/prisma/contract.json',
      );

      const plugin = prismaVitePlugin('prisma-next.config.ts', { logLevel: 'silent' });
      const mockServer = createMockServer();

      const configResolved = plugin.configResolved as unknown as (config: { root: string }) => void;
      configResolved({ root: '/project' });

      const configureServer = plugin.configureServer as unknown as (
        server: ReturnType<typeof createMockServer>,
      ) => Promise<void>;
      await configureServer(mockServer);

      expect(mockServer.watcher.add).toHaveBeenCalledWith('/project/prisma-next.config.ts');
      expect(mockServer.watcher.add).toHaveBeenCalledWith('/project/prisma/schema.prisma');
      expect(mockServer.watcher.add).not.toHaveBeenCalledWith('/project/src/prisma/contract.json');
      expect(mockServer.watcher.add).not.toHaveBeenCalledWith('/project/src/prisma/contract.d.ts');
      expect(mockServer.ssrLoadModule).not.toHaveBeenCalled();
    });

    it('triggers initial emit on server start', async () => {
      const { executeContractEmit } = await import('@prisma-next/cli/control-api');
      const mockExecute = vi.mocked(executeContractEmit);
      mockExecute.mockResolvedValue({
        storageHash: 'abc123',
        profileHash: 'def456',
        files: { json: '/out/contract.json', dts: '/out/contract.d.ts' },
      });

      const plugin = prismaVitePlugin('prisma-next.config.ts', { logLevel: 'silent' });
      const mockServer = createMockServer();

      const configResolved = plugin.configResolved as unknown as (config: { root: string }) => void;
      configResolved({ root: '/project' });

      const configureServer = plugin.configureServer as unknown as (
        server: ReturnType<typeof createMockServer>,
      ) => Promise<void>;
      await configureServer(mockServer);

      expect(mockExecute).toHaveBeenCalledWith(
        expect.objectContaining({
          configPath: expect.stringContaining('prisma-next.config.ts'),
        }),
      );
    });

    it('registers cleanup hooks for server close', async () => {
      const { executeContractEmit } = await import('@prisma-next/cli/control-api');
      const mockExecute = vi.mocked(executeContractEmit);
      mockExecute.mockResolvedValue({
        storageHash: 'abc123',
        profileHash: 'def456',
        files: { json: '/out/contract.json', dts: '/out/contract.d.ts' },
      });

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

    it('warns when provider declares configPathOnly', async () => {
      const { executeContractEmit } = await import('@prisma-next/cli/control-api');
      const mockExecute = vi.mocked(executeContractEmit);
      mockExecute.mockResolvedValue({
        storageHash: 'abc123',
        profileHash: 'def456',
        files: { json: '/out/contract.json', dts: '/out/contract.d.ts' },
      });
      await mockLoadedConfig({ kind: 'configPathOnly' });

      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const plugin = prismaVitePlugin('prisma-next.config.ts', { logLevel: 'info' });
      const mockServer = createMockServer();

      const configResolved = plugin.configResolved as unknown as (config: { root: string }) => void;
      configResolved({ root: '/project' });

      const configureServer = plugin.configureServer as unknown as (
        server: ReturnType<typeof createMockServer>,
      ) => Promise<void>;
      await configureServer(mockServer);

      expect(mockServer.watcher.add).toHaveBeenCalledWith('/project/prisma-next.config.ts');
      expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('configPathOnly'));
    });

    it('shows error overlay when no files are being watched', async () => {
      const { executeContractEmit } = await import('@prisma-next/cli/control-api');
      const mockExecute = vi.mocked(executeContractEmit);
      mockExecute.mockResolvedValue({
        storageHash: 'abc123',
        profileHash: 'def456',
        files: { json: '/out/contract.json', dts: '/out/contract.d.ts' },
      });
      await mockLoadedConfig({ kind: 'moduleGraph' });

      vi.spyOn(console, 'error').mockImplementation(() => {});

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
      const { executeContractEmit } = await import('@prisma-next/cli/control-api');
      const mockExecute = vi.mocked(executeContractEmit);
      mockExecute.mockResolvedValue({
        storageHash: 'abc123',
        profileHash: 'def456',
        files: { json: '/out/contract.json', dts: '/out/contract.d.ts' },
      });

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

      mockExecute.mockClear();

      const handleHotUpdate = plugin.handleHotUpdate as unknown as (ctx: { file: string }) => void;
      handleHotUpdate({ file: '/project/prisma-next.config.ts' });

      expect(mockExecute).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(100);

      expect(mockExecute).toHaveBeenCalled();
    });

    it('debounces rapid successive changes', async () => {
      const { executeContractEmit } = await import('@prisma-next/cli/control-api');
      const mockExecute = vi.mocked(executeContractEmit);
      mockExecute.mockResolvedValue({
        storageHash: 'abc123',
        profileHash: 'def456',
        files: { json: '/out/contract.json', dts: '/out/contract.d.ts' },
      });

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

      mockExecute.mockClear();

      const handleHotUpdate = plugin.handleHotUpdate as unknown as (ctx: { file: string }) => void;

      handleHotUpdate({ file: '/project/prisma-next.config.ts' });
      await vi.advanceTimersByTimeAsync(50);
      handleHotUpdate({ file: '/project/prisma-next.config.ts' });
      await vi.advanceTimersByTimeAsync(50);
      handleHotUpdate({ file: '/project/prisma-next.config.ts' });
      await vi.advanceTimersByTimeAsync(100);

      expect(mockExecute).toHaveBeenCalledTimes(1);
    });
  });

  describe('error handling', () => {
    it('logs error when emit fails', async () => {
      const { executeContractEmit } = await import('@prisma-next/cli/control-api');
      const mockExecute = vi.mocked(executeContractEmit);
      mockExecute.mockRejectedValue(new Error('Emit failed'));

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
      const { executeContractEmit } = await import('@prisma-next/cli/control-api');
      const mockExecute = vi.mocked(executeContractEmit);
      mockExecute.mockRejectedValue(new Error('Something broke'));

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
      const { executeContractEmit } = await import('@prisma-next/cli/control-api');
      const mockExecute = vi.mocked(executeContractEmit);
      // Use standard AbortError (DOMException with name 'AbortError')
      mockExecute.mockRejectedValue(new DOMException('The operation was aborted', 'AbortError'));

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
