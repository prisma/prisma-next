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
          convertOperationManifest: () => ({ forTypeId: '', method: '', args: [], returns: { kind: 'builtin', type: 'string' } }),
          validateContractIR: (contract: unknown) => contract,
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
          convertOperationManifest: () => ({ forTypeId: '', method: '', args: [], returns: { kind: 'builtin', type: 'string' } }),
          validateContractIR: (contract: unknown) => contract,
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
          convertOperationManifest: () => ({ forTypeId: '', method: '', args: [], returns: { kind: 'builtin', type: 'string' } }),
          validateContractIR: (contract: unknown) => contract,
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

  it('throws error when config is not an object', async () => {
    const configPath = join(testDir, 'prisma-next.config.ts');
    writeFileSync(configPath, 'export default null;', 'utf-8');
    await expect(loadConfig(configPath)).rejects.toThrow();
  });

  it('throws error when config is a string', async () => {
    const configPath = join(testDir, 'prisma-next.config.ts');
    writeFileSync(configPath, `export default 'invalid';`, 'utf-8');
    await expect(loadConfig(configPath)).rejects.toThrow();
  });

  it('throws error when family is missing', async () => {
    const configPath = join(testDir, 'prisma-next.config.ts');
    writeFileSync(
      configPath,
      `export default {
        target: { kind: 'target', id: 'postgres', family: 'sql', manifest: { id: 'postgres', version: '1.0.0' } },
        adapter: { kind: 'adapter', id: 'postgres', family: 'sql', manifest: { id: 'postgres', version: '1.0.0' } },
      };`,
      'utf-8',
    );
    await expect(loadConfig(configPath)).rejects.toThrow('Config must have a "family" field');
  });

  it('throws error when target is missing', async () => {
    const configPath = join(testDir, 'prisma-next.config.ts');
    const mockHook = {
      id: 'sql',
      validateTypes: () => {},
      validateStructure: () => {},
      generateContractTypes: () => '',
    };
    writeFileSync(
      configPath,
      `const mockHook = ${JSON.stringify(mockHook)};
      export default {
        family: {
          kind: 'family',
          id: 'sql',
          hook: mockHook,
          convertOperationManifest: () => ({ forTypeId: '', method: '', args: [], returns: { kind: 'builtin', type: 'string' } }),
          validateContractIR: (contract: unknown) => contract,
        },
        adapter: { kind: 'adapter', id: 'postgres', family: 'sql', manifest: { id: 'postgres', version: '1.0.0' } },
      };`,
      'utf-8',
    );
    await expect(loadConfig(configPath)).rejects.toThrow('Config must have a "target" field');
  });

  it('throws error when adapter is missing', async () => {
    const configPath = join(testDir, 'prisma-next.config.ts');
    const mockHook = {
      id: 'sql',
      validateTypes: () => {},
      validateStructure: () => {},
      generateContractTypes: () => '',
    };
    writeFileSync(
      configPath,
      `const mockHook = ${JSON.stringify(mockHook)};
      export default {
        family: {
          kind: 'family',
          id: 'sql',
          hook: mockHook,
          convertOperationManifest: () => ({ forTypeId: '', method: '', args: [], returns: { kind: 'builtin', type: 'string' } }),
          validateContractIR: (contract: unknown) => contract,
        },
        target: { kind: 'target', id: 'postgres', family: 'sql', manifest: { id: 'postgres', version: '1.0.0' } },
      };`,
      'utf-8',
    );
    await expect(loadConfig(configPath)).rejects.toThrow('Config must have an "adapter" field');
  });

  it('throws error when family kind is invalid', async () => {
    const configPath = join(testDir, 'prisma-next.config.ts');
    const mockHook = {
      id: 'sql',
      validateTypes: () => {},
      validateStructure: () => {},
      generateContractTypes: () => '',
    };
    writeFileSync(
      configPath,
      `const mockHook = ${JSON.stringify(mockHook)};
      export default {
        family: {
          kind: 'invalid',
          id: 'sql',
          hook: mockHook,
          convertOperationManifest: () => ({ forTypeId: '', method: '', args: [], returns: { kind: 'builtin', type: 'string' } }),
          validateContractIR: (contract: unknown) => contract,
        },
        target: { kind: 'target', id: 'postgres', family: 'sql', manifest: { id: 'postgres', version: '1.0.0' } },
        adapter: { kind: 'adapter', id: 'postgres', family: 'sql', manifest: { id: 'postgres', version: '1.0.0' } },
      };`,
      'utf-8',
    );
    await expect(loadConfig(configPath)).rejects.toThrow('Config.family must have kind: "family"');
  });

  it('throws error when family id is not a string', async () => {
    const configPath = join(testDir, 'prisma-next.config.ts');
    const mockHook = {
      id: 'sql',
      validateTypes: () => {},
      validateStructure: () => {},
      generateContractTypes: () => '',
    };
    writeFileSync(
      configPath,
      `const mockHook = ${JSON.stringify(mockHook)};
      export default {
        family: {
          kind: 'family',
          id: 123,
          hook: mockHook,
          convertOperationManifest: () => ({ forTypeId: '', method: '', args: [], returns: { kind: 'builtin', type: 'string' } }),
          validateContractIR: (contract: unknown) => contract,
        },
        target: { kind: 'target', id: 'postgres', family: 'sql', manifest: { id: 'postgres', version: '1.0.0' } },
        adapter: { kind: 'adapter', id: 'postgres', family: 'sql', manifest: { id: 'postgres', version: '1.0.0' } },
      };`,
      'utf-8',
    );
    await expect(loadConfig(configPath)).rejects.toThrow('Config.family must have id: string');
  });

  it('throws error when family hook is missing', async () => {
    const configPath = join(testDir, 'prisma-next.config.ts');
    writeFileSync(
      configPath,
      `export default {
        family: {
          kind: 'family',
          id: 'sql',
          convertOperationManifest: () => ({ forTypeId: '', method: '', args: [], returns: { kind: 'builtin', type: 'string' } }),
          validateContractIR: (contract: unknown) => contract,
        },
        target: { kind: 'target', id: 'postgres', family: 'sql', manifest: { id: 'postgres', version: '1.0.0' } },
        adapter: { kind: 'adapter', id: 'postgres', family: 'sql', manifest: { id: 'postgres', version: '1.0.0' } },
      };`,
      'utf-8',
    );
    await expect(loadConfig(configPath)).rejects.toThrow(
      'Config.family must have hook: TargetFamilyHook',
    );
  });

  it('throws error when family convertOperationManifest is not a function', async () => {
    const configPath = join(testDir, 'prisma-next.config.ts');
    const mockHook = {
      id: 'sql',
      validateTypes: () => {},
      validateStructure: () => {},
      generateContractTypes: () => '',
    };
    writeFileSync(
      configPath,
      `const mockHook = ${JSON.stringify(mockHook)};
      export default {
        family: {
          kind: 'family',
          id: 'sql',
          hook: mockHook,
          convertOperationManifest: 'not a function',
          validateContractIR: (contract: unknown) => contract,
        },
        target: { kind: 'target', id: 'postgres', family: 'sql', manifest: { id: 'postgres', version: '1.0.0' } },
        adapter: { kind: 'adapter', id: 'postgres', family: 'sql', manifest: { id: 'postgres', version: '1.0.0' } },
      };`,
      'utf-8',
    );
    await expect(loadConfig(configPath)).rejects.toThrow(
      'Config.family must have convertOperationManifest: function',
    );
  });

  it('throws error when family validateContractIR is not a function', async () => {
    const configPath = join(testDir, 'prisma-next.config.ts');
    const mockHook = {
      id: 'sql',
      validateTypes: () => {},
      validateStructure: () => {},
      generateContractTypes: () => '',
    };
    writeFileSync(
      configPath,
      `const mockHook = ${JSON.stringify(mockHook)};
      export default {
        family: {
          kind: 'family',
          id: 'sql',
          hook: mockHook,
          convertOperationManifest: () => ({ forTypeId: '', method: '', args: [], returns: { kind: 'builtin', type: 'string' } }),
          validateContractIR: 'not a function',
        },
        target: { kind: 'target', id: 'postgres', family: 'sql', manifest: { id: 'postgres', version: '1.0.0' } },
        adapter: { kind: 'adapter', id: 'postgres', family: 'sql', manifest: { id: 'postgres', version: '1.0.0' } },
      };`,
      'utf-8',
    );
    await expect(loadConfig(configPath)).rejects.toThrow(
      'Config.family must have validateContractIR: function',
    );
  });

  it('throws error when target kind is invalid', async () => {
    const configPath = join(testDir, 'prisma-next.config.ts');
    const mockHook = {
      id: 'sql',
      validateTypes: () => {},
      validateStructure: () => {},
      generateContractTypes: () => '',
    };
    writeFileSync(
      configPath,
      `const mockHook = ${JSON.stringify(mockHook)};
      export default {
        family: {
          kind: 'family',
          id: 'sql',
          hook: mockHook,
          convertOperationManifest: () => ({ forTypeId: '', method: '', args: [], returns: { kind: 'builtin', type: 'string' } }),
          validateContractIR: (contract: unknown) => contract,
        },
        target: { kind: 'invalid', id: 'postgres', family: 'sql', manifest: { id: 'postgres', version: '1.0.0' } },
        adapter: { kind: 'adapter', id: 'postgres', family: 'sql', manifest: { id: 'postgres', version: '1.0.0' } },
      };`,
      'utf-8',
    );
    await expect(loadConfig(configPath)).rejects.toThrow('Config.target must have kind: "target"');
  });

  it('throws error when target id is not a string', async () => {
    const configPath = join(testDir, 'prisma-next.config.ts');
    const mockHook = {
      id: 'sql',
      validateTypes: () => {},
      validateStructure: () => {},
      generateContractTypes: () => '',
    };
    writeFileSync(
      configPath,
      `const mockHook = ${JSON.stringify(mockHook)};
      export default {
        family: {
          kind: 'family',
          id: 'sql',
          hook: mockHook,
          convertOperationManifest: () => ({ forTypeId: '', method: '', args: [], returns: { kind: 'builtin', type: 'string' } }),
          validateContractIR: (contract: unknown) => contract,
        },
        target: { kind: 'target', id: 123, family: 'sql', manifest: { id: 'postgres', version: '1.0.0' } },
        adapter: { kind: 'adapter', id: 'postgres', family: 'sql', manifest: { id: 'postgres', version: '1.0.0' } },
      };`,
      'utf-8',
    );
    await expect(loadConfig(configPath)).rejects.toThrow('Config.target must have id: string');
  });

  it('throws error when target family is not a string', async () => {
    const configPath = join(testDir, 'prisma-next.config.ts');
    const mockHook = {
      id: 'sql',
      validateTypes: () => {},
      validateStructure: () => {},
      generateContractTypes: () => '',
    };
    writeFileSync(
      configPath,
      `const mockHook = ${JSON.stringify(mockHook)};
      export default {
        family: {
          kind: 'family',
          id: 'sql',
          hook: mockHook,
          convertOperationManifest: () => ({ forTypeId: '', method: '', args: [], returns: { kind: 'builtin', type: 'string' } }),
          validateContractIR: (contract: unknown) => contract,
        },
        target: { kind: 'target', id: 'postgres', family: 123, manifest: { id: 'postgres', version: '1.0.0' } },
        adapter: { kind: 'adapter', id: 'postgres', family: 'sql', manifest: { id: 'postgres', version: '1.0.0' } },
      };`,
      'utf-8',
    );
    await expect(loadConfig(configPath)).rejects.toThrow('Config.target must have family: string');
  });

  it('throws error when target manifest is missing', async () => {
    const configPath = join(testDir, 'prisma-next.config.ts');
    const mockHook = {
      id: 'sql',
      validateTypes: () => {},
      validateStructure: () => {},
      generateContractTypes: () => '',
    };
    writeFileSync(
      configPath,
      `const mockHook = ${JSON.stringify(mockHook)};
      export default {
        family: {
          kind: 'family',
          id: 'sql',
          hook: mockHook,
          convertOperationManifest: () => ({ forTypeId: '', method: '', args: [], returns: { kind: 'builtin', type: 'string' } }),
          validateContractIR: (contract: unknown) => contract,
        },
        target: { kind: 'target', id: 'postgres', family: 'sql' },
        adapter: { kind: 'adapter', id: 'postgres', family: 'sql', manifest: { id: 'postgres', version: '1.0.0' } },
      };`,
      'utf-8',
    );
    await expect(loadConfig(configPath)).rejects.toThrow(
      'Config.target must have manifest: ExtensionPackManifest',
    );
  });

  it('throws error when adapter kind is invalid', async () => {
    const configPath = join(testDir, 'prisma-next.config.ts');
    const mockHook = {
      id: 'sql',
      validateTypes: () => {},
      validateStructure: () => {},
      generateContractTypes: () => '',
    };
    writeFileSync(
      configPath,
      `const mockHook = ${JSON.stringify(mockHook)};
      export default {
        family: {
          kind: 'family',
          id: 'sql',
          hook: mockHook,
          convertOperationManifest: () => ({ forTypeId: '', method: '', args: [], returns: { kind: 'builtin', type: 'string' } }),
          validateContractIR: (contract: unknown) => contract,
        },
        target: { kind: 'target', id: 'postgres', family: 'sql', manifest: { id: 'postgres', version: '1.0.0' } },
        adapter: { kind: 'invalid', id: 'postgres', family: 'sql', manifest: { id: 'postgres', version: '1.0.0' } },
      };`,
      'utf-8',
    );
    await expect(loadConfig(configPath)).rejects.toThrow(
      'Config.adapter must have kind: "adapter"',
    );
  });

  it('throws error when adapter id is not a string', async () => {
    const configPath = join(testDir, 'prisma-next.config.ts');
    const mockHook = {
      id: 'sql',
      validateTypes: () => {},
      validateStructure: () => {},
      generateContractTypes: () => '',
    };
    writeFileSync(
      configPath,
      `const mockHook = ${JSON.stringify(mockHook)};
      export default {
        family: {
          kind: 'family',
          id: 'sql',
          hook: mockHook,
          convertOperationManifest: () => ({ forTypeId: '', method: '', args: [], returns: { kind: 'builtin', type: 'string' } }),
          validateContractIR: (contract: unknown) => contract,
        },
        target: { kind: 'target', id: 'postgres', family: 'sql', manifest: { id: 'postgres', version: '1.0.0' } },
        adapter: { kind: 'adapter', id: 123, family: 'sql', manifest: { id: 'postgres', version: '1.0.0' } },
      };`,
      'utf-8',
    );
    await expect(loadConfig(configPath)).rejects.toThrow('Config.adapter must have id: string');
  });

  it('throws error when adapter family is not a string', async () => {
    const configPath = join(testDir, 'prisma-next.config.ts');
    const mockHook = {
      id: 'sql',
      validateTypes: () => {},
      validateStructure: () => {},
      generateContractTypes: () => '',
    };
    writeFileSync(
      configPath,
      `const mockHook = ${JSON.stringify(mockHook)};
      export default {
        family: {
          kind: 'family',
          id: 'sql',
          hook: mockHook,
          convertOperationManifest: () => ({ forTypeId: '', method: '', args: [], returns: { kind: 'builtin', type: 'string' } }),
          validateContractIR: (contract: unknown) => contract,
        },
        target: { kind: 'target', id: 'postgres', family: 'sql', manifest: { id: 'postgres', version: '1.0.0' } },
        adapter: { kind: 'adapter', id: 'postgres', family: 123, manifest: { id: 'postgres', version: '1.0.0' } },
      };`,
      'utf-8',
    );
    await expect(loadConfig(configPath)).rejects.toThrow('Config.adapter must have family: string');
  });

  it('throws error when adapter manifest is missing', async () => {
    const configPath = join(testDir, 'prisma-next.config.ts');
    const mockHook = {
      id: 'sql',
      validateTypes: () => {},
      validateStructure: () => {},
      generateContractTypes: () => '',
    };
    writeFileSync(
      configPath,
      `const mockHook = ${JSON.stringify(mockHook)};
      export default {
        family: {
          kind: 'family',
          id: 'sql',
          hook: mockHook,
          convertOperationManifest: () => ({ forTypeId: '', method: '', args: [], returns: { kind: 'builtin', type: 'string' } }),
          validateContractIR: (contract: unknown) => contract,
        },
        target: { kind: 'target', id: 'postgres', family: 'sql', manifest: { id: 'postgres', version: '1.0.0' } },
        adapter: { kind: 'adapter', id: 'postgres', family: 'sql' },
      };`,
      'utf-8',
    );
    await expect(loadConfig(configPath)).rejects.toThrow(
      'Config.adapter must have manifest: ExtensionPackManifest',
    );
  });

  it('throws error when extensions is not an array', async () => {
    const configPath = join(testDir, 'prisma-next.config.ts');
    const mockHook = {
      id: 'sql',
      validateTypes: () => {},
      validateStructure: () => {},
      generateContractTypes: () => '',
    };
    writeFileSync(
      configPath,
      `const mockHook = ${JSON.stringify(mockHook)};
      export default {
        family: {
          kind: 'family',
          id: 'sql',
          hook: mockHook,
          convertOperationManifest: () => ({ forTypeId: '', method: '', args: [], returns: { kind: 'builtin', type: 'string' } }),
          validateContractIR: (contract: unknown) => contract,
        },
        target: { kind: 'target', id: 'postgres', family: 'sql', manifest: { id: 'postgres', version: '1.0.0' } },
        adapter: { kind: 'adapter', id: 'postgres', family: 'sql', manifest: { id: 'postgres', version: '1.0.0' } },
        extensions: 'not an array',
      };`,
      'utf-8',
    );
    await expect(loadConfig(configPath)).rejects.toThrow('Config.extensions must be an array');
  });

  it('throws error when extension item is not an object', async () => {
    const configPath = join(testDir, 'prisma-next.config.ts');
    const mockHook = {
      id: 'sql',
      validateTypes: () => {},
      validateStructure: () => {},
      generateContractTypes: () => '',
    };
    writeFileSync(
      configPath,
      `const mockHook = ${JSON.stringify(mockHook)};
      export default {
        family: {
          kind: 'family',
          id: 'sql',
          hook: mockHook,
          convertOperationManifest: () => ({ forTypeId: '', method: '', args: [], returns: { kind: 'builtin', type: 'string' } }),
          validateContractIR: (contract: unknown) => contract,
        },
        target: { kind: 'target', id: 'postgres', family: 'sql', manifest: { id: 'postgres', version: '1.0.0' } },
        adapter: { kind: 'adapter', id: 'postgres', family: 'sql', manifest: { id: 'postgres', version: '1.0.0' } },
        extensions: [null],
      };`,
      'utf-8',
    );
    await expect(loadConfig(configPath)).rejects.toThrow(
      'Config.extensions must contain ExtensionDescriptor objects',
    );
  });

  it('throws error when extension kind is invalid', async () => {
    const configPath = join(testDir, 'prisma-next.config.ts');
    const mockHook = {
      id: 'sql',
      validateTypes: () => {},
      validateStructure: () => {},
      generateContractTypes: () => '',
    };
    writeFileSync(
      configPath,
      `const mockHook = ${JSON.stringify(mockHook)};
      export default {
        family: {
          kind: 'family',
          id: 'sql',
          hook: mockHook,
          convertOperationManifest: () => ({ forTypeId: '', method: '', args: [], returns: { kind: 'builtin', type: 'string' } }),
          validateContractIR: (contract: unknown) => contract,
        },
        target: { kind: 'target', id: 'postgres', family: 'sql', manifest: { id: 'postgres', version: '1.0.0' } },
        adapter: { kind: 'adapter', id: 'postgres', family: 'sql', manifest: { id: 'postgres', version: '1.0.0' } },
        extensions: [{ kind: 'invalid', id: 'test', family: 'sql', manifest: { id: 'test', version: '1.0.0' } }],
      };`,
      'utf-8',
    );
    await expect(loadConfig(configPath)).rejects.toThrow(
      'Config.extensions items must have kind: "extension"',
    );
  });

  it('throws error when extension id is not a string', async () => {
    const configPath = join(testDir, 'prisma-next.config.ts');
    const mockHook = {
      id: 'sql',
      validateTypes: () => {},
      validateStructure: () => {},
      generateContractTypes: () => '',
    };
    writeFileSync(
      configPath,
      `const mockHook = ${JSON.stringify(mockHook)};
      export default {
        family: {
          kind: 'family',
          id: 'sql',
          hook: mockHook,
          convertOperationManifest: () => ({ forTypeId: '', method: '', args: [], returns: { kind: 'builtin', type: 'string' } }),
          validateContractIR: (contract: unknown) => contract,
        },
        target: { kind: 'target', id: 'postgres', family: 'sql', manifest: { id: 'postgres', version: '1.0.0' } },
        adapter: { kind: 'adapter', id: 'postgres', family: 'sql', manifest: { id: 'postgres', version: '1.0.0' } },
        extensions: [{ kind: 'extension', id: 123, family: 'sql', manifest: { id: 'test', version: '1.0.0' } }],
      };`,
      'utf-8',
    );
    await expect(loadConfig(configPath)).rejects.toThrow(
      'Config.extensions items must have id: string',
    );
  });

  it('throws error when extension family is not a string', async () => {
    const configPath = join(testDir, 'prisma-next.config.ts');
    const mockHook = {
      id: 'sql',
      validateTypes: () => {},
      validateStructure: () => {},
      generateContractTypes: () => '',
    };
    writeFileSync(
      configPath,
      `const mockHook = ${JSON.stringify(mockHook)};
      export default {
        family: {
          kind: 'family',
          id: 'sql',
          hook: mockHook,
          convertOperationManifest: () => ({ forTypeId: '', method: '', args: [], returns: { kind: 'builtin', type: 'string' } }),
          validateContractIR: (contract: unknown) => contract,
        },
        target: { kind: 'target', id: 'postgres', family: 'sql', manifest: { id: 'postgres', version: '1.0.0' } },
        adapter: { kind: 'adapter', id: 'postgres', family: 'sql', manifest: { id: 'postgres', version: '1.0.0' } },
        extensions: [{ kind: 'extension', id: 'test', family: 123, manifest: { id: 'test', version: '1.0.0' } }],
      };`,
      'utf-8',
    );
    await expect(loadConfig(configPath)).rejects.toThrow(
      'Config.extensions items must have family: string',
    );
  });

  it('throws error when extension manifest is missing', async () => {
    const configPath = join(testDir, 'prisma-next.config.ts');
    const mockHook = {
      id: 'sql',
      validateTypes: () => {},
      validateStructure: () => {},
      generateContractTypes: () => '',
    };
    writeFileSync(
      configPath,
      `const mockHook = ${JSON.stringify(mockHook)};
      export default {
        family: {
          kind: 'family',
          id: 'sql',
          hook: mockHook,
          convertOperationManifest: () => ({ forTypeId: '', method: '', args: [], returns: { kind: 'builtin', type: 'string' } }),
          validateContractIR: (contract: unknown) => contract,
        },
        target: { kind: 'target', id: 'postgres', family: 'sql', manifest: { id: 'postgres', version: '1.0.0' } },
        adapter: { kind: 'adapter', id: 'postgres', family: 'sql', manifest: { id: 'postgres', version: '1.0.0' } },
        extensions: [{ kind: 'extension', id: 'test', family: 'sql' }],
      };`,
      'utf-8',
    );
    await expect(loadConfig(configPath)).rejects.toThrow(
      'Config.extensions items must have manifest: ExtensionPackManifest',
    );
  });

  it('handles non-Error exceptions', async () => {
    const configPath = join(testDir, 'prisma-next.config.ts');
    // This test verifies the catch block handles non-Error exceptions
    // We can't easily trigger this in practice, but the code path exists
    writeFileSync(configPath, `throw 'string error';`, 'utf-8');
    await expect(loadConfig(configPath)).rejects.toBeDefined();
  });

  it('handles error messages with "Cannot find"', async () => {
    const configPath = join(testDir, 'nonexistent.config.ts');
    await expect(loadConfig(configPath)).rejects.toThrow();
  });

  it('handles error messages with "ENOENT"', async () => {
    const configPath = join(testDir, 'nonexistent.config.ts');
    await expect(loadConfig(configPath)).rejects.toThrow();
  });

  it('handles other error types from c12', async () => {
    const configPath = join(testDir, 'prisma-next.config.ts');
    // Create a file that will cause a compilation error
    writeFileSync(configPath, 'export default { invalid syntax }', 'utf-8');
    await expect(loadConfig(configPath)).rejects.toThrow('Failed to load config');
  });
});
