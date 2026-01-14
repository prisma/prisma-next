import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prismaVitePlugin } from '../src/plugin';

vi.mock('@prisma-next/cli/control-api', () => ({
  ContractEmitCancelledError: class ContractEmitCancelledError extends Error {
    override readonly name = 'ContractEmitCancelledError' as const;
    constructor() {
      super('Contract emit was cancelled');
    }
  },
  executeContractEmit: vi.fn(),
}));

function createMockServer() {
  return {
    watcher: {
      add: vi.fn(),
      unwatch: vi.fn(),
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
    it('resolves config path relative to vite root', () => {
      const plugin = prismaVitePlugin('prisma-next.config.ts', { logLevel: 'silent' });
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const configResolved = plugin.configResolved as unknown as (config: { root: string }) => void;
      configResolved({ root: '/project' });

      consoleSpy.mockRestore();
    });

    it('resolves absolute config path correctly', () => {
      const plugin = prismaVitePlugin('/absolute/prisma-next.config.ts', { logLevel: 'silent' });

      const configResolved = plugin.configResolved as unknown as (config: { root: string }) => void;
      configResolved({ root: '/project' });
    });
  });

  describe('configureServer', () => {
    it('registers file watchers on server', async () => {
      const { executeContractEmit } = await import('@prisma-next/cli/control-api');
      const mockExecute = vi.mocked(executeContractEmit);
      mockExecute.mockResolvedValue({
        coreHash: 'abc123',
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

      expect(mockServer.ssrLoadModule).toHaveBeenCalled();
    });

    it('triggers initial emit on server start', async () => {
      const { executeContractEmit } = await import('@prisma-next/cli/control-api');
      const mockExecute = vi.mocked(executeContractEmit);
      mockExecute.mockResolvedValue({
        coreHash: 'abc123',
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
        coreHash: 'abc123',
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
        coreHash: 'abc123',
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
      const { executeContractEmit, ContractEmitCancelledError } = await import(
        '@prisma-next/cli/control-api'
      );
      const mockExecute = vi.mocked(executeContractEmit);
      const CancelledError = ContractEmitCancelledError as unknown as new () => Error;
      mockExecute.mockRejectedValue(new CancelledError());

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
