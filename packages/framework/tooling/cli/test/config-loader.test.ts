import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config-loader';

describe('config loader', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `prisma-next-config-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('loads config with default export', async () => {
    const configPath = join(testDir, 'prisma-next.config.ts');
    writeFileSync(
      configPath,
      `const mockHook = {
        id: 'sql',
        validateTypes: () => {},
        validateStructure: () => {},
        generateContractTypes: () => '',
      };
      export default {
        family: {
          kind: 'family',
          id: 'sql',
          hook: mockHook,
          assembleOperationRegistry: () => ({ register: () => {} }),
          extractCodecTypeImports: () => [],
          extractOperationTypeImports: () => [],
        },
        target: { kind: 'target', id: 'postgres', family: 'sql', manifest: { id: 'postgres', version: '1.0.0' } },
        adapter: { kind: 'adapter', id: 'postgres', family: 'sql', manifest: { id: 'postgres', version: '1.0.0' } },
        extensions: [],
      };`,
      'utf-8',
    );

    const config = await loadConfig(configPath);
    expect(config).toBeDefined();
    expect(config.family).toBeDefined();
    expect(config.family.id).toBe('sql');
  });

  it('loads config with named export', async () => {
    const configPath = join(testDir, 'prisma-next.config.ts');
    writeFileSync(
      configPath,
      `const mockHook = {
        id: 'sql',
        validateTypes: () => {},
        validateStructure: () => {},
        generateContractTypes: () => '',
      };
      export const config = {
        family: {
          kind: 'family',
          id: 'sql',
          hook: mockHook,
          assembleOperationRegistry: () => ({ register: () => {} }),
          extractCodecTypeImports: () => [],
          extractOperationTypeImports: () => [],
        },
        target: { kind: 'target', id: 'postgres', family: 'sql', manifest: { id: 'postgres', version: '1.0.0' } },
        adapter: { kind: 'adapter', id: 'postgres', family: 'sql', manifest: { id: 'postgres', version: '1.0.0' } },
        extensions: [],
      };
      export default config;`,
      'utf-8',
    );

    const config = await loadConfig(configPath);
    expect(config).toBeDefined();
    expect(config.family).toBeDefined();
    expect(config.family.id).toBe('sql');
  });

  it('throws error for missing config file', async () => {
    const configPath = join(testDir, 'nonexistent.config.ts');
    await expect(loadConfig(configPath)).rejects.toThrow();
  });

  it('throws error for invalid config structure', async () => {
    const configPath = join(testDir, 'prisma-next.config.ts');
    writeFileSync(
      configPath,
      `export default {
      // Missing required fields
    };`,
      'utf-8',
    );

    await expect(loadConfig(configPath)).rejects.toThrow();
  });

  it('loads config with default path when path not provided', async () => {
    const configPath = join(testDir, 'prisma-next.config.ts');
    writeFileSync(
      configPath,
      `const mockHook = {
        id: 'sql',
        validateTypes: () => {},
        validateStructure: () => {},
        generateContractTypes: () => '',
      };
      export default {
        family: {
          kind: 'family',
          id: 'sql',
          hook: mockHook,
          assembleOperationRegistry: () => ({ register: () => {} }),
          extractCodecTypeImports: () => [],
          extractOperationTypeImports: () => [],
        },
        target: { kind: 'target', id: 'postgres', family: 'sql', manifest: { id: 'postgres', version: '1.0.0' } },
        adapter: { kind: 'adapter', id: 'postgres', family: 'sql', manifest: { id: 'postgres', version: '1.0.0' } },
        extensions: [],
      };`,
      'utf-8',
    );

    // Change to testDir so default path resolves correctly
    const originalCwd = process.cwd();
    try {
      process.chdir(testDir);
      const config = await loadConfig();
      expect(config).toBeDefined();
      expect(config.family.id).toBe('sql');
    } finally {
      process.chdir(originalCwd);
    }
  });
});
