import { describe, expect, it, vi } from 'vitest';
import { prismaVitePlugin } from '../src/plugin';

describe('prismaVitePlugin', () => {
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
      const plugin = prismaVitePlugin('prisma-next.config.ts');
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      // Call configResolved with a mock config
      const configResolved = plugin.configResolved as (config: { root: string }) => void;
      configResolved({ root: '/project' });

      consoleSpy.mockRestore();
    });
  });

  describe('handleHotUpdate', () => {
    it('does not throw when called with untracked file', () => {
      const plugin = prismaVitePlugin('prisma-next.config.ts', { logLevel: 'silent' });

      // Initialize the plugin
      const configResolved = plugin.configResolved as (config: { root: string }) => void;
      configResolved({ root: '/project' });

      // Call handleHotUpdate with an unrelated file
      const handleHotUpdate = plugin.handleHotUpdate as (ctx: { file: string }) => void;
      expect(() => handleHotUpdate({ file: '/unrelated/file.ts' })).not.toThrow();
    });
  });
});
